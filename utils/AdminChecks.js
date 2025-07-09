async function isGroupAdmin(bot, chatId, userId) {
    try {
        const chatMember = await bot.getChatMember(chatId, userId);
        return ['administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
        console.error(`Error checking admin status for user ${userId} in chat ${chatId}:`, error.message);
        return false;
    }
}

// You might also want a global admin check if you have super-admins for the bot itself
async function isAdmin(userId) {
    // Implement your global admin logic here, e.g., check against a predefined list of IDs
    // For now, it's just a placeholder.
    const SUPER_ADMIN_IDS = process.env.SUPER_ADMIN_IDS ? process.env.SUPER_ADMIN_IDS.split(',').map(Number) : [];
    return SUPER_ADMIN_IDS.includes(userId);
}

module.exports = { isGroupAdmin, isAdmin };