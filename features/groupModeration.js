// features/groupModeration.js

const GroupSettings = require('../models/GroupSettings');
const { isGroupAdmin } = require('../utils/AdminChecks');
const { sendLog } = require('../utils/logger');

// Anti-spam: Basic rate-limiting for now. More advanced solutions might use a proper database with timestamps.
const userMessageCounts = {};
const SPAM_THRESHOLD = 5; // Max messages in SPAM_INTERVAL
const SPAM_INTERVAL = 5000; // 5 seconds

// Helper to get user object from message reply or argument
async function getUserFromMessageOrArg(bot, chatId, msg, arg) {
    if (msg.reply_to_message) {
        return msg.reply_to_message.from;
    }
    if (arg) {
        // Try to get user by ID
        if (!isNaN(parseInt(arg))) {
            try {
                const member = await bot.getChatMember(chatId, parseInt(arg));
                if (member && member.user) return member.user;
            } catch (e) {
                // User not found or bot doesn't have permission
                return null;
            }
        }
        // Getting user by @username is not directly supported by Telegram Bot API without prior interaction
        // You'd need to have stored a mapping of username to ID in your DB.
        // For simplicity, for now, we'll primarily rely on replies or direct ID.
        // If you need robust username resolution, you must implement a system to cache usernames and IDs.
        // For example, when a user sends a message, store their msg.from.username and msg.from.id.
        return null; // Could not resolve user from argument without reply or valid ID
    }
    return null;
}

async function banUser(bot, msg, reason) {
    const chatId = msg.chat.id;
    // Extract target user identifier and reason correctly from the command arguments
    const args = msg.text.split(' ').slice(1);
    let targetIdentifier = args[0];
    let banReason = args.slice(1).join(' ') || 'No reason specified';

    let targetUser = await getUserFromMessageOrArg(bot, chatId, msg, targetIdentifier);

    // If no target user identified by reply or argument, try parsing the reason as target for legacy reasons
    if (!targetUser && reason) {
        targetUser = await getUserFromMessageOrArg(bot, chatId, msg, reason.split(' ')[0]);
        if (targetUser) {
            banReason = reason.substring(reason.split(' ')[0].length).trim();
        } else {
            // If the first argument wasn't a user, assume it's part of the reason
            banReason = reason;
        }
    }

    if (!targetUser) {
        return bot.sendMessage(chatId, 'Please reply to a user\'s message or provide a valid user ID or @username (if bot has seen them before) to ban.');
    }
    if (await isGroupAdmin(bot, chatId, targetUser.id)) {
        return bot.sendMessage(chatId, 'I cannot ban an admin.');
    }
    if (targetUser.id === bot.options.username) { // Prevent bot from banning itself if possible
        return bot.sendMessage(chatId, 'I cannot ban myself.');
    }


    try {
        await bot.banChatMember(chatId, targetUser.id);
        bot.sendMessage(chatId, `${targetUser.first_name || targetUser.username} has been banned. Reason: ${banReason}`);
        await sendLog(bot, `[${chatId}] User ${targetUser.first_name || targetUser.username} (${targetUser.id}) banned by ${msg.from.first_name} (${msg.from.id}). Reason: ${banReason}`);
    } catch (error) {
        console.error('Error banning user:', error.message);
        bot.sendMessage(chatId, `Failed to ban ${targetUser.first_name || targetUser.username}. Make sure I have administrator rights.`);
    }
}

// Added /unban function
async function unbanUser(bot, msg) {
    const chatId = msg.chat.id;
    const args = msg.text.split(' ').slice(1);
    const targetIdentifier = args[0];

    const targetUser = await getUserFromMessageOrArg(bot, chatId, msg, targetIdentifier);

    if (!targetUser) {
        return bot.sendMessage(chatId, 'Please reply to a user\'s message or provide a valid user ID or @username (if bot has seen them before) to unban.');
    }

    try {
        // unbanChatMember only unbans, it doesn't add them back.
        // The user will be able to join via an invite link.
        await bot.unbanChatMember(chatId, targetUser.id);
        
        let inviteLink = null;
        try {
            // Create a new invite link for the user to rejoin
            inviteLink = await bot.createChatInviteLink(chatId, {
                member_limit: 1, // Only allow one join for this specific link
                expire_date: Math.floor(Date.now() / 1000) + (5 * 60) // Valid for 5 minutes
            });
        } catch (linkError) {
            console.warn('Could not create invite link after unban:', linkError.message);
            // This might happen if the bot doesn't have 'invite users' admin right.
        }

        let replyMessage = `${targetUser.first_name || targetUser.username} has been unbanned. They can now join the group again.`;
        if (inviteLink) {
            replyMessage += `\n\nTo rejoin, they can use this invite link (valid for 5 minutes): ${inviteLink.invite_link}`;
        } else {
            replyMessage += `\n\nNote: I could not generate an invite link. They will need to rejoin via another group invite link.`;
        }

        bot.sendMessage(chatId, replyMessage);
        await sendLog(bot, `[${chatId}] User ${targetUser.first_name || targetUser.username} (${targetUser.id}) unbanned by ${msg.from.first_name} (${msg.from.id}).`);

    } catch (error) {
        console.error('Error unbanning user:', error.message);
        bot.sendMessage(chatId, `Failed to unban ${targetUser.first_name || targetUser.username}. Make sure I have administrator rights.`);
    }
}


async function muteUser(bot, msg, targetUser, minutes) {
    const chatId = msg.chat.id;
    if (!targetUser) {
        // Re-parse targetUser from msg args if not found in reply_to_message
        const args = msg.text.split(' ').slice(1);
        const targetIdentifier = args[0];
        targetUser = await getUserFromMessageOrArg(bot, chatId, msg, targetIdentifier);
        minutes = parseInt(args[1]); // Re-parse minutes after getting target
    }

    if (!targetUser) {
        return bot.sendMessage(chatId, 'Please reply to a user\'s message or provide a valid user ID or @username (if bot has seen them before) to mute, along with duration in minutes (e.g., /mute @user 60).');
    }
    if (await isGroupAdmin(bot, chatId, targetUser.id)) {
        return bot.sendMessage(chatId, 'I cannot mute an admin.');
    }
    if (targetUser.id === bot.options.username) {
        return bot.sendMessage(chatId, 'I cannot mute myself.');
    }

    const untilDate = minutes ? Math.floor(Date.now() / 1000) + (minutes * 60) : 0; // 0 for permanent mute (until unmuted)

    try {
        await bot.restrictChatMember(chatId, targetUser.id, {
            can_send_messages: false,
            can_send_media_messages: false,
            can_send_polls: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false,
            can_change_info: false,
            can_invite_users: false,
            can_pin_messages: false,
            can_manage_topics: false,
            until_date: untilDate
        });
        const muteDuration = minutes ? `for ${minutes} minutes` : 'permanently';
        bot.sendMessage(chatId, `${targetUser.first_name || targetUser.username} has been muted ${muteDuration}.`);
        await sendLog(bot, `[${chatId}] User ${targetUser.first_name || targetUser.username} (${targetUser.id}) muted by ${msg.from.first_name} (${msg.from.id}) ${muteDuration}.`);
    } catch (error) {
        console.error('Error muting user:', error.message);
        bot.sendMessage(chatId, `Failed to mute ${targetUser.first_name || targetUser.username}. Make sure I have administrator rights.`);
    }
}

async function unmuteUser(bot, msg, targetUser) {
    const chatId = msg.chat.id;
    if (!targetUser) {
        // Re-parse targetUser from msg args if not found in reply_to_message
        const args = msg.text.split(' ').slice(1);
        const targetIdentifier = args[0];
        targetUser = await getUserFromMessageOrArg(bot, chatId, msg, targetIdentifier);
    }
    
    if (!targetUser) {
        return bot.sendMessage(chatId, 'Please reply to a user\'s message or provide a valid user ID or @username (if bot has seen them before) to unmute.');
    }

    try {
        await bot.restrictChatMember(chatId, targetUser.id, {
            can_send_messages: true,
            can_send_media_messages: true,
            can_send_polls: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
            // Keep other permissions as they were or grant back if you want a full reset
            // For a full "unmute", you generally restore all messaging permissions.
            can_change_info: false, // These usually remain admin-only
            can_invite_users: false,
            can_pin_messages: false,
            can_manage_topics: false,
        });
        bot.sendMessage(chatId, `${targetUser.first_name || targetUser.username} has been unmuted.`);
        await sendLog(bot, `[${chatId}] User ${targetUser.first_name || targetUser.username} (${targetUser.id}) unmuted by ${msg.from.first_name} (${msg.from.id}).`);
    } catch (error) {
        console.error('Error unmuting user:', error.message);
        bot.sendMessage(chatId, `Failed to unmute ${targetUser.first_name || targetUser.username}.`);
    }
}

async function warnUser(bot, msg) {
    const chatId = msg.chat.id;
    const targetUser = msg.reply_to_message ? msg.reply_to_message.from : null;

    if (!targetUser) {
        return bot.sendMessage(chatId, 'Please reply to a user\'s message to warn them.');
    }
    if (await isGroupAdmin(bot, chatId, targetUser.id)) {
        return bot.sendMessage(chatId, 'I cannot warn an admin.');
    }
    if (targetUser.id === bot.options.username) {
        return bot.sendMessage(chatId, 'I cannot warn myself.');
    }

    // You might want to store warning counts in a database for more sophisticated warning systems
    bot.sendMessage(chatId, `Warning issued to ${targetUser.first_name || targetUser.username}.`);
    await sendLog(bot, `[${chatId}] Warning issued to ${targetUser.first_name || targetUser.username} (${targetUser.id}) by ${msg.from.first_name} (${msg.from.id}).`);
}

async function handleModeration(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    const settings = await GroupSettings.findOne({ chatId });

    // Skip moderation for admins
    if (await isGroupAdmin(bot, chatId, userId)) return;

    // Anti-spam protection
    if (!userMessageCounts[userId]) {
        userMessageCounts[userId] = [];
    }
    userMessageCounts[userId].push(Date.now());
    userMessageCounts[userId] = userMessageCounts[userId].filter(timestamp => Date.now() - timestamp < SPAM_INTERVAL);

    if (userMessageCounts[userId].length > SPAM_THRESHOLD) {
        bot.deleteMessage(chatId, msg.message_id).catch(console.error);
        sendLog(bot, `[${chatId}] Spam detected from ${msg.from.first_name} (${userId}). Message deleted.`);
        // Optionally mute for a short period or warn
        return;
    }

    // Auto-delete links
    if (settings?.autoDeleteLinks && text && /(https?:\/\/[^\s]+|t\.me\/[^\s]+|telegram\.me\/[^\s]+)/gi.test(text)) {
        bot.deleteMessage(chatId, msg.message_id).catch(console.error);
        sendLog(bot, `[${chatId}] Link detected and deleted from ${msg.from.first_name} (${userId}): ${text}`);
        return;
    }

    // Auto-delete banned words
    if (settings?.autoDeleteBannedWords && settings?.bannedWords.length > 0 && text) {
        const lowerCaseText = text.toLowerCase();
        for (const word of settings.bannedWords) {
            if (lowerCaseText.includes(word.toLowerCase())) {
                bot.deleteMessage(chatId, msg.message_id).catch(console.error);
                sendLog(bot, `[${chatId}] Banned word detected and deleted from ${msg.from.first_name} (${userId}): ${text}`);
                return;
            }
        }
    }

    // Auto-delete forwarded messages
    if (settings?.autoDeleteForwarded && msg.forward_from || msg.forward_from_chat) {
        bot.deleteMessage(chatId, msg.message_id).catch(console.error);
        sendLog(bot, `[${chatId}] Forwarded message deleted from ${msg.from.first_name} (${userId}).`);
        return;
    }
}

module.exports = { banUser, unbanUser, muteUser, unmuteUser, warnUser, handleModeration, getUserFromMessageOrArg }; // Export getUserFromMessageOrArg