// utils/adminChecks.js

async function isGroupAdmin(bot, chatId, userId) {
    try {
        const chatMember = await bot.getChatMember(chatId, userId);
        return ['administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
        console.error(`Error checking admin status for user ${userId} in chat ${chatId}:`, error.message);
        return false;
    }
}

async function isAdmin(userId) {
    const SUPER_ADMIN_IDS = process.env.SUPER_ADMIN_IDS ? process.env.SUPER_ADMIN_IDS.split(',').map(Number) : [];
    return SUPER_ADMIN_IDS.includes(userId);
}

module.exports = { isGroupAdmin, isAdmin };
