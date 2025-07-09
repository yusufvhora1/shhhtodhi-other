// features/keywordTrigger.js

const KeywordTrigger = require('../models/KeywordTrigger');
const { sendLog } = require('../utils/logger');
const { parseMessageContent } = require('./welcomeSystem'); // Import the new parser

async function addKeyword(bot, chatId, keyword, response) {
    try {
        const { text: cleanedResponse, options } = parseMessageContent(response);
        
        // You might want to store parse_mode and reply_markup separately in KeywordTrigger model
        // For simplicity, let's store the entire original response string and parse it on retrieval,
        // similar to custom commands' previous logic, or update the model to store structured data.
        // For consistency with custom commands, it's better to store cleaned text and parse_mode.
        // Let's modify KeywordTrigger schema if not already. Assuming it's just 'response' string.
        // If 'response' just holds the text, then `parseMessageContent` should extract buttons dynamically.

        const newTrigger = await KeywordTrigger.findOneAndUpdate(
            { chatId, keyword: keyword.toLowerCase() },
            { response: cleanedResponse }, // Store cleaned text only
            { upsert: true, new: true }
        );
        bot.sendMessage(chatId, `Keyword trigger for \`${keyword}\` ${newTrigger.isNew ? 'added' : 'updated'} successfully.`);
        await sendLog(bot, `[${chatId}] Keyword trigger for "${keyword}" ${newTrigger.isNew ? 'added' : 'updated'}.`);
    } catch (error) {
        console.error('Error adding/editing keyword trigger:', error);
        if (error.code === 11000) {
            bot.sendMessage(chatId, `Keyword \`${keyword}\` already has a trigger.`);
        } else {
            bot.sendMessage(chatId, 'Failed to add/edit keyword trigger.');
        }
    }
}

async function deleteKeyword(bot, chatId, keyword) {
    try {
        const result = await KeywordTrigger.deleteOne({ chatId, keyword: keyword.toLowerCase() });
        if (result.deletedCount > 0) {
            bot.sendMessage(chatId, `Keyword trigger for \`${keyword}\` deleted successfully.`);
            await sendLog(bot, `[${chatId}] Keyword trigger for "${keyword}" deleted.`);
        } else {
            bot.sendMessage(chatId, `Keyword trigger for \`${keyword}\` not found.`);
        }
    } catch (error) {
        console.error('Error deleting keyword trigger:', error);
        bot.sendMessage(chatId, 'Failed to delete keyword trigger.');
    }
}

async function listKeywords(bot, chatId) {
    try {
        const triggers = await KeywordTrigger.find({ chatId });
        if (triggers.length === 0) {
            return bot.sendMessage(chatId, 'No keyword triggers set for this group.');
        }
        let message = 'Active Keyword Triggers:\n\n';
        triggers.forEach((trigger, index) => {
            message += `${index + 1}. Keyword: \`${trigger.keyword}\`\n   Response: \`${trigger.response.substring(0, 50)}${trigger.response.length > 50 ? '...' : ''}\`\n\n`;
        });
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error listing keyword triggers:', error);
        bot.sendMessage(chatId, 'Failed to list keyword triggers.');
    }
}

async function handleKeywordTrigger(bot, msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    try {
        const triggers = await KeywordTrigger.find({ chatId });
        for (const trigger of triggers) {
            if (text.toLowerCase().includes(trigger.keyword.toLowerCase())) {
                const { text: responseText, options: replyOptions } = parseMessageContent(trigger.response);
                
                await bot.sendMessage(chatId, responseText, replyOptions);
                break; // Respond to the first matching keyword
            }
        }
    } catch (error) {
        console.error('Error handling keyword trigger:', error);
    }
}

module.exports = { addKeyword, deleteKeyword, listKeywords, handleKeywordTrigger };