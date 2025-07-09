// index.js (main bot file)

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const { BOT_TOKEN, MONGO_URI, LOG_GROUP_ID } = process.env;

if (!BOT_TOKEN || !MONGO_URI) {
    console.error('Error: BOT_TOKEN or MONGO_URI is not defined in .env');
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// MongoDB Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => console.error('MongoDB connection error:', err));

// Import Mongoose Models
const GroupSettings = require('./models/GroupSettings');
const CustomCommand = require('./models/CustomCommand');
const KeywordTrigger = require('./models/KeywordTrigger');
const UserRole = require('./models/UserRole');
const LockStatus = require('./models/LockStatus');

// Import utility functions and feature handlers
const { isGroupAdmin, isAdmin } = require('./utils/adminChecks');
const { setupWelcome, testWelcome, handleNewChatMembers, deletePreviousWelcome, parseMessageContent } = require('./features/welcomeSystem');
const { addCommand, editCommand, deleteCommand, handleCustomCommand } = require('./features/customCommands');
const { addKeyword, deleteKeyword, listKeywords, handleKeywordTrigger } = require('./features/keywordTrigger');
const { banUser, unbanUser, muteUser, unmuteUser, warnUser, handleModeration, getUserFromMessageOrArg } = require('./features/groupModeration');
const { handleCaptcha, pendingCaptchas, solveCaptcha } = require('./features/captchaVerification');
const { setRole, removeRole, getUserRole } = require('./features/roleSystem');
const { lockGroup, unlockGroup, getLockStatus, checkGroupLock } = require('./features/groupLock');
const { sendLog } = require('./utils/logger');

// Store last welcome message ID for each chat to delete previous ones
const lastWelcomeMessageId = {};


// Middleware to check if the group is locked
// FIX: Define chatId and userId at the start of this block
bot.on('message', async (msg) => {
    const chatId = msg.chat.id; // FIX: Define chatId here
    const userId = msg.from.id; // FIX: Define userId here

    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        const isLocked = await checkGroupLock(chatId); // Use defined chatId
        if (isLocked) {
            const senderIsAdmin = await isGroupAdmin(bot, chatId, userId); // Use defined chatId, userId
            if (!senderIsAdmin) {
                bot.deleteMessage(chatId, msg.message_id).catch(console.error);
                return;
            }
        }
    }
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        if (pendingCaptchas[chatId] && pendingCaptchas[chatId][userId] && !msg.text.startsWith('/start')) {
            bot.deleteMessage(chatId, msg.message_id).catch(console.error);
            return;
        }
    }
});


// /start command (no changes)
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const addGroupButton = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Add to your group', url: `https://t.me/${bot.options.username}?startgroup=true` }]
            ]
        }
    };
    bot.sendMessage(chatId, 'Hello! I am the official ShhhToshi bot. I can help you moderate your group, manage custom commands, set up welcome messages, and much much more.', addGroupButton);
});

// /help command (updated description for /setwelcome and /addkw)
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
*Available Commands:*

*Core Group Moderation (Admin Only):*
\` /ban [user] [reason] \` - Ban a user. Reply to a user's message or use their @username/@user_id.
\` /unban [user] \` - Unban a user. They will need an invite link to rejoin.
\` /mute [user] [minutes] \` - Temporarily mute a user. Reply to a user's message or use their @username/@user_id.
\` /unmute [user] \` - Unmute a user. Reply to a user's message or use their @username/@user_id.
\` /warn [user] \` - Issue a warning. Reply to a user's message or use their @username/@user_id.

*Custom Commands (Static Replies) (Admin Only):*
\` /addcmd [name] [response] \` - Add a custom command (e.g., \` /addcmd rules Read the group rules here. \`). Supports Markdown/HTML and inline buttons (JSON format).
\` /editcmd [name] [new_response] \` - Edit an existing custom command.
\` /delcmd [name] \` - Delete a custom command.

*Welcome System (Admin Only):*
\` /setwelcome [message] \` - Set the custom welcome message. Use \` {mention} \` for new user mention. Supports *pure HTML tags* and inline buttons (JSON), and can be replied to a media file for a banner.
\` /testwelcome \` - Test the current welcome message.
\` /togglecaptcha \` - Enable or disable CAPTCHA verification for new users.

*Keyword Trigger System (Admin Only):*
\` /addkw [keyword] [response] \` - Add a keyword trigger. Supports *pure HTML tags* and inline buttons (JSON).
\` /delkw [keyword] \` - Delete a keyword trigger.
\` /listkw \` - View all active keyword triggers.

*Basic CAPTCHA Verification:*
New users will receive a 1-tap CAPTCHA. If not solved in 60 seconds, they will be kicked.

*Role System (Simple Tags) (Admin Only):*
\` /setrole [user] [role] \` - Set a custom role/tag for a user. (Reply or provide @username/ID)
\` /removerole [user] \` - Remove a user's role. (Reply or provide @username/ID)

*Admin Controls (In-Group) (Admin Only):*
\` /stats \` - Show joined, banned, muted users count.
\` /settings \` - Display enabled/disabled features.
\` /admin \` - Opens inline admin control menu (future implementation, placeholder for now).

*Group Lock System (Admin Only):*
\` /lock [minutes] \` - Lock the group for a specified duration (e.g., \` /lock 60 \` for 60 minutes).
\` /unlock \` - Manually unlock the group.
\` /status \` - Show current lock status and remaining time.

*General Commands:*
\` /help \` - Display this help message.
\` / /start \` - Get basic bot information and an "Add to your group" button.

*Note:* For commands requiring a user, you can either reply to their message or provide their @username or user ID.
    `;
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Handle new chat members for CAPTCHA and Welcome
bot.on('new_chat_members', async (msg) => {
    for (const member of msg.new_chat_members) {
        if (member.is_bot) continue;
        await handleCaptcha(bot, msg.chat.id, member, async () => {
            await handleNewChatMembers(bot, msg.chat.id, member, lastWelcomeMessageId);
        });
    }
});

// Handle text messages for moderation and keyword triggers
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (msg.text) {
        if (pendingCaptchas[chatId] && pendingCaptchas[chatId][userId] && !msg.text.startsWith('/start')) {
            bot.deleteMessage(chatId, msg.message_id).catch(console.error);
            return;
        }

        await handleModeration(bot, msg);
        await handleCustomCommand(bot, msg);
        await handleKeywordTrigger(bot, msg);
    }
});

// Admin commands setup
bot.onText(/\/ban(?:@\S+)?(?:\s+([\s\S]*))?/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await banUser(bot, msg, match[1]);
});

bot.onText(/\/unban(?:@\S+)?(?:\s+([\s\S]*))?/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await unbanUser(bot, msg);
});

bot.onText(/\/mute(?:@\S+)?(?:\s+([\s\S]*))?/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await muteUser(bot, msg);
});

bot.onText(/\/unmute(?:@\S+)?(?:\s+([\s\S]*))?/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await unmuteUser(bot, msg);
});

bot.onText(/\/warn(?:@\S+)?(?:\s+([\s\S]*))?/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await warnUser(bot, msg);
});

bot.onText(/\/addcmd\s+(\S+)\s+([\s\S]+)/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await addCommand(bot, msg.chat.id, match[1], match[2]);
});

bot.onText(/\/editcmd\s+(\S+)\s+([\s\S]+)/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await editCommand(bot, msg.chat.id, match[1], match[2]);
});

bot.onText(/\/delcmd\s+(\S+)/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await deleteCommand(bot, msg.chat.id, match[1]);
});

// This is the updated /setwelcome command handler:
// It captures all text after /setwelcome and passes the full msg object.
bot.onText(/\/setwelcome\s*([\s\S]*)/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    const welcomeText = match[1] || ''; // Capture the text after /setwelcome
    await setupWelcome(bot, msg, welcomeText); // Pass the full message object
});

bot.onText(/\/testwelcome/, async (msg) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await testWelcome(bot, msg.chat.id, msg.from);
});

bot.onText(/\/togglecaptcha/, async (msg) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    const settings = await GroupSettings.findOne({ chatId: msg.chat.id });
    if (!settings) {
        await GroupSettings.create({ chatId: msg.chat.id, captchaEnabled: true });
        bot.sendMessage(msg.chat.id, 'CAPTCHA verification enabled.');
    } else {
        settings.captchaEnabled = !settings.captchaEnabled;
        await settings.save();
        bot.sendMessage(msg.chat.id, `CAPTCHA verification ${settings.captchaEnabled ? 'enabled' : 'disabled'}.`);
    }
});

bot.onText(/\/addkw\s+(\S+)\s+([\s\S]+)/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await addKeyword(bot, msg.chat.id, match[1], match[2]);
});

bot.onText(/\/delkw\s+(\S+)/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await deleteKeyword(bot, msg.chat.id, match[1]);
});

bot.onText(/\/listkw/, async (msg) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await listKeywords(bot, msg.chat.id);
});

bot.onText(/\/setrole(?:@\S+)?(?:\s+([\s\S]+))?/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    const args = match[1] ? match[1].split(' ') : [];
    const targetIdentifier = args[0];
    const role = args.slice(1).join(' ');

    if (!targetIdentifier || !role) {
        return bot.sendMessage(msg.chat.id, 'Usage: /setrole [user]. Reply to a user or use their @username/ID to set their role.');
    }
    await setRole(bot, msg, targetIdentifier, role);
});

bot.onText(/\/removerole(?:@\S+)?(?:\s+([\s\S]+))?/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    const args = match[1] ? match[1].split(' ') : [];
    const targetIdentifier = args[0];
    
    if (!targetIdentifier) {
        return bot.sendMessage(msg.chat.id, 'Usage: /removerole [user]. Reply to a user or use their @username/ID.');
    }
    await removeRole(bot, msg, targetIdentifier);
});

bot.onText(/\/stats/, async (msg) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    bot.sendMessage(msg.chat.id, "User statistics feature is under development.");
});

bot.onText(/\/settings/, async (msg) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    const settings = await GroupSettings.findOne({ chatId: msg.chat.id });
    let message = 'Current Group Settings:\n';
    if (settings) {
        message += `- Auto-delete links: ${settings.autoDeleteLinks ? 'Enabled' : 'Disabled'}\n`;
        message += `- Auto-delete banned words: ${settings.autoDeleteBannedWords ? 'Enabled' : 'Disabled'}\n`;
        message += `- Auto-delete forwarded messages: ${settings.autoDeleteForwarded ? 'Enabled' : 'Disabled'}\n`;
        message += `- CAPTCHA enabled: ${settings.captchaEnabled ? 'Enabled' : 'Disabled'}\n`;
        message += `- Welcome Message Media: ${settings.welcomeMediaFileId ? 'Set' : 'Not Set'}\n`;
        message += `- Welcome Message Parse Mode: ${settings.welcomeParseMode}\n`;
    } else {
        message += 'No specific settings configured for this group. Using default values.\n';
    }
    bot.sendMessage(msg.chat.id, message);
});

bot.onText(/\/admin/, async (msg) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    bot.sendMessage(msg.chat.id, 'Admin menu feature is under development.', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Moderation Settings', callback_data: 'admin_moderation' }],
                [{ text: 'Welcome Settings', callback_data: 'admin_welcome' }],
                [{ text: 'Custom Commands', callback_data: 'admin_custom_commands' }],
                [{ text: 'Keyword Triggers', callback_data: 'admin_keyword_triggers' }],
                [{ text: 'Role System', callback_data: 'admin_role_system' }],
                [{ text: 'Group Lock', callback_data: 'admin_group_lock' }]
            ]
        }
    });
});

// Handle callback queries for inline buttons (e.g., admin menu and CAPTCHA)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    bot.answerCallbackQuery(query.id).catch(console.error);

    if (data.startsWith('captcha_solve_')) {
        if (pendingCaptchas[chatId] && pendingCaptchas[chatId][userId]) {
            const solvedValue = data.split('_')[2];
            const captchaEntry = pendingCaptchas[chatId][userId];

            if (captchaEntry.challenge === solvedValue) {
                clearTimeout(captchaEntry.timeout);

                await bot.deleteMessage(chatId, captchaEntry.sentMessageId)
                    .catch(error => {
                        if (error.response && error.response.body && error.response.body.description.includes('message to delete not found')) {
                            // Message might have been deleted already by auto-delete or user
                        } else {
                            console.error(`[${chatId}] Error deleting CAPTCHA message ${captchaEntry.sentMessageId}:`, error.message);
                        }
                    });
                
                if (typeof captchaEntry.onSolved === 'function') {
                    captchaEntry.onSolved();
                }
                
                delete pendingCaptchas[chatId][userId];
                
                return;
            } else {
                bot.sendMessage(chatId, `${query.from.first_name || query.from.username}, incorrect CAPTCHA solution. You will be kicked if not already.`).catch(console.error);
                return;
            }
        } else {
            bot.sendMessage(chatId, `${query.from.first_name || query.from.username}, this CAPTCHA is no longer active or has expired.`).catch(console.console.error);
            return;
        }
    }

    if (!await isGroupAdmin(bot, chatId, userId)) {
        bot.sendMessage(chatId, 'You are not an admin to use this functionality.');
        return;
    }

    if (data === 'admin_moderation') {
        bot.sendMessage(chatId, 'Moderation settings menu (Placeholder).');
    } else if (data === 'admin_welcome') {
        bot.sendMessage(chatId, 'Welcome settings menu (Placeholder).');
    } else if (data === 'admin_custom_commands') {
        bot.sendMessage(chatId, 'Custom commands menu (Placeholder).');
    } else if (data === 'admin_keyword_triggers') {
        bot.sendMessage(chatId, 'Keyword triggers menu (Placeholder).');
    } else if (data === 'admin_role_system') {
        bot.sendMessage(chatId, 'Role system menu (Placeholder).');
    } else if (data === 'admin_group_lock') {
        bot.sendMessage(chatId, 'Group lock menu (Placeholder).');
    }
});

bot.onText(/\/lock(?:\s+(\d+))?/, async (msg, match) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    const minutes = match[1] ? parseInt(match[1]) : null;
    await lockGroup(bot, msg.chat.id, minutes);
});

bot.onText(/\/unlock/, async (msg) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await unlockGroup(bot, msg.chat.id);
});

bot.onText(/\/status/, async (msg) => {
    if (!await isGroupAdmin(bot, msg.chat.id, msg.from.id)) return;
    await getLockStatus(bot, msg.chat.id);
});


// Polling error handling
bot.on('polling_error', (err) => console.error('Polling error:', err));

console.log('ShhhToshi Bot is running...');