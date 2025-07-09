const { LOG_GROUP_ID } = process.env;

async function sendLog(bot, message) {
    if (!LOG_GROUP_ID) {
        console.warn('LOG_GROUP_ID not set in .env. Logging to console instead.');
        console.log('BOT LOG:', message);
        return;
    }
    try {
        await bot.sendMessage(LOG_GROUP_ID, `\`\`\`\n${message}\n\`\`\``, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error sending log to Telegram group:', error.message);
    }
}

module.exports = { sendLog };