// features/customCommands.js

const CustomCommand = require('../models/CustomCommand');
const { sendLog } = require('../utils/logger');
const { parseMessageContent } = require('./welcomeSystem'); // Import the new parser

async function addCommand(bot, chatId, name, response) {
    try {
        // Use the new centralized parser to get text and options
        const { text: cleanedResponse, options } = parseMessageContent(response);
        
        // Store the parse_mode determined by the parser
        const parseModeToStore = options.parse_mode;

        const newCommand = await CustomCommand.findOneAndUpdate(
            { chatId, name: name.toLowerCase() },
            { response: cleanedResponse, parseMode: parseModeToStore }, // Store cleaned response and parseMode
            { upsert: true, new: true }
        );
        bot.sendMessage(chatId, `Custom command \`/${name}\` ${newCommand.isNew ? 'added' : 'updated'} successfully.`);
        await sendLog(bot, `[${chatId}] Custom command /${name} ${newCommand.isNew ? 'added' : 'updated'}.`);
    } catch (error) {
        console.error('Error adding/editing custom command:', error);
        if (error.code === 11000) {
            bot.sendMessage(chatId, `Command \`/${name}\` already exists.`);
        } else {
            bot.sendMessage(chatId, 'Failed to add/edit custom command.');
        }
    }
}

async function editCommand(bot, chatId, name, newResponse) {
    try {
        await addCommand(bot, chatId, name, newResponse); // Re-use addCommand for update logic
    } catch (error) {
        console.error('Error editing custom command:', error);
        bot.sendMessage(chatId, 'Failed to edit custom command.');
    }
}

async function deleteCommand(bot, chatId, name) {
    try {
        const result = await CustomCommand.deleteOne({ chatId, name: name.toLowerCase() });
        if (result.deletedCount > 0) {
            bot.sendMessage(chatId, `Custom command \`/${name}\` deleted successfully.`);
            await sendLog(bot, `[${chatId}] Custom command /${name} deleted.`);
        } else {
            bot.sendMessage(chatId, `Custom command \`/${name}\` not found.`);
        }
    } catch (error) {
        console.error('Error deleting custom command:', error);
        bot.sendMessage(chatId, 'Failed to delete custom command.');
    }
}

async function handleCustomCommand(bot, msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || !text.startsWith('/')) return;

    const commandName = text.split(' ')[0].substring(1).toLowerCase(); // Remove / and get command name

    try {
        const customCommand = await CustomCommand.findOne({ chatId, name: commandName });
        if (customCommand) {
            // When retrieving from DB, apply parseMessageContent if you stored raw text including JSON block
            // OR if you stored cleaned text and parse_mode separately, then just use them.
            // My current `addCommand` stores cleaned text and `parseMode` separately.
            // So, reconstruct options including reply_markup for the message.
            let replyOptions = { parse_mode: customCommand.parseMode || 'Markdown' };
            const { options } = parseMessageContent(customCommand.response); // Try to extract buttons again on retrieval
            if (options.reply_markup) {
                replyOptions.reply_markup = options.reply_markup;
            }

            await bot.sendMessage(chatId, customCommand.response, replyOptions);
        }
    } catch (error) {
        console.error('Error handling custom command:', error);
    }
}

module.exports = { addCommand, editCommand, deleteCommand, handleCustomCommand };