const GroupSettings = require('../models/GroupSettings');
const { sendLog } = require('../utils/logger');

// Store pending CAPTCHA challenges: { chatId: { userId: { challenge: 'string', sentMessageId: number, timeout: timeoutId } } }
const pendingCaptchas = {};
const CAPTCHA_TIMEOUT = 60 * 1000; // 60 seconds

async function handleCaptcha(bot, chatId, newMember, onCaptchaSolved) {
    const settings = await GroupSettings.findOne({ chatId });
    if (!settings?.captchaEnabled) {
        return onCaptchaSolved(); // Proceed if CAPTCHA is disabled
    }

    if (newMember.is_bot) return; // Don't CAPTCHA other bots

    // Kick the user if they don't solve CAPTCHA in time
    const kickUser = async () => {
        try {
            await bot.kickChatMember(chatId, newMember.id);
            bot.sendMessage(chatId, `${newMember.first_name} was kicked for failing CAPTCHA.`);
            await sendLog(bot, `[${chatId}] User ${newMember.first_name} (${newMember.id}) kicked for CAPTCHA failure.`);
        } catch (error) {
            console.error('Error kicking user for CAPTCHA:', error.message);
        } finally {
            if (pendingCaptchas[chatId] && pendingCaptchas[chatId][newMember.id]) {
                delete pendingCaptchas[chatId][newMember.id];
            }
        }
    };

    const challenge = generateCaptchaChallenge(); // Simple challenge for now
    const sentMessage = await bot.sendMessage(chatId, `Welcome ${newMember.first_name}! Please tap the button to prove you're not a bot.`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: challenge.text, callback_data: `captcha_solve_${challenge.value}` }]
            ]
        }
    });

    // Delete welcome message after 5 seconds to keep chat clean before captcha
    setTimeout(() => {
        bot.deleteMessage(chatId, sentMessage.message_id).catch(console.error);
    }, 5000);


    const timeoutId = setTimeout(kickUser, CAPTCHA_TIMEOUT);

    if (!pendingCaptchas[chatId]) {
        pendingCaptchas[chatId] = {};
    }
    pendingCaptchas[chatId][newMember.id] = {
        challenge: challenge.value,
        sentMessageId: sentMessage.message_id,
        timeout: timeoutId,
        onSolved: onCaptchaSolved
    };

    // Listen for callback queries for CAPTCHA
    bot.once('callback_query', async (query) => {
        if (query.message.chat.id === chatId && query.from.id === newMember.id && query.data.startsWith('captcha_solve_')) {
            const solvedValue = query.data.split('_')[2];
            if (pendingCaptchas[chatId] && pendingCaptchas[chatId][newMember.id] && pendingCaptchas[chatId][newMember.id].challenge === solvedValue) {
                clearTimeout(pendingCaptchas[chatId][newMember.id].timeout);
                bot.answerCallbackQuery(query.id, 'CAPTCHA solved successfully!');
                await bot.deleteMessage(chatId, pendingCaptchas[chatId][newMember.id].sentMessageId).catch(console.error);
                delete pendingCaptchas[chatId][newMember.id];
                onCaptchaSolved(); // Trigger the welcome message logic
            } else {
                bot.answerCallbackQuery(query.id, 'Incorrect CAPTCHA solution or expired. You will be kicked.', true);
                kickUser();
            }
        } else if (query.message.chat.id === chatId && query.from.id === newMember.id && query.data.startsWith('captcha_solve_')) {
            // User clicked wrong button after CAPTCHA expired or was solved by other means
            bot.answerCallbackQuery(query.id, 'This CAPTCHA is no longer active.', true);
        }
    });
}

function generateCaptchaChallenge() {
    // Simple 1-tap CAPTCHA. Can be made more complex (e.g., math problem, image captcha)
    const options = ['I am not a bot', 'Click here', 'Verify'];
    const correctOption = options[Math.floor(Math.random() * options.length)];
    return { text: correctOption, value: correctOption };
}

// Function to handle text messages directly from CAPTCHA pending users (e.g., if they type the solution)
function solveCaptcha(bot, chatId, userId, text) {
    if (pendingCaptchas[chatId] && pendingCaptchas[chatId][userId]) {
        // For a text-based captcha, you'd check if `text` matches the challenge
        // For our button-based captcha, this function isn't strictly needed for the solution
        // but can be used to prevent other messages from CAPTCHA-pending users.
        return false; // Indicating no solution via text is accepted for this button-based CAPTCHA
    }
    return false;
}

module.exports = { handleCaptcha, pendingCaptchas, solveCaptcha };