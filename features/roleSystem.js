// features/roleSystem.js

const UserRole = require('../models/UserRole');
const { sendLog } = require('../utils/logger');
const { getUserFromMessageOrArg } = require('./groupModeration'); // Import helper


async function setRole(bot, msg, targetIdentifier, role) {
    const chatId = msg.chat.id;

    // Use the helper to resolve the user
    const targetUser = await getUserFromMessageOrArg(bot, chatId, msg, targetIdentifier);

    if (!targetUser) {
        return bot.sendMessage(chatId, 'Please reply to a user\'s message or provide a valid user ID or @username (if bot has seen them before) to set their role.');
    }

    try {
        const updatedRole = await UserRole.findOneAndUpdate(
            { chatId, userId: targetUser.id },
            { role, username: targetUser.username, firstName: targetUser.first_name, lastName: targetUser.last_name },
            { upsert: true, new: true }
        );
        bot.sendMessage(chatId, `Set role for ${targetUser.first_name || targetUser.username} to \`${role}\`.`);
        await sendLog(bot, `[${chatId}] Set role for ${targetUser.first_name || targetUser.username} (${targetUser.id}) to "${role}" by ${msg.from.first_name} (${msg.from.id}).`);
    } catch (error) {
        console.error('Error setting role:', error.message);
        bot.sendMessage(chatId, 'Failed to set role.');
    }
}

async function removeRole(bot, msg, targetIdentifier) {
    const chatId = msg.chat.id;

    const targetUser = await getUserFromMessageOrArg(bot, chatId, msg, targetIdentifier);

    if (!targetUser) {
        return bot.sendMessage(chatId, 'Please reply to a user\'s message or provide a valid user ID or @username (if bot has seen them before) to remove their role.');
    }

    try {
        const result = await UserRole.deleteOne({ chatId, userId: targetUser.id });
        if (result.deletedCount > 0) {
            bot.sendMessage(chatId, `Role removed for ${targetUser.first_name || targetUser.username}.`);
            await sendLog(bot, `[${chatId}] Role removed for user (${targetUser.id}) by ${msg.from.first_name} (${msg.from.id}).`);
        } else {
            bot.sendMessage(chatId, `User ${targetUser.first_name || targetUser.username} does not have a role set or not found.`);
        }
    } catch (error) {
        console.error('Error removing role:', error.message);
        bot.sendMessage(chatId, 'Failed to remove role.');
    }
}

async function getUserRole(chatId, userId) {
    try {
        const userRole = await UserRole.findOne({ chatId, userId });
        return userRole ? userRole.role : null;
    } catch (error) {
        console.error('Error getting user role:', error);
        return null;
    }
}

module.exports = { setRole, removeRole, getUserRole };