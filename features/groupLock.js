const LockStatus = require('../models/LockStatus');
const { sendLog } = require('../utils/logger');

const lockedGroupsTimeouts = {}; // Store setTimeout IDs for auto-unlock

async function lockGroup(bot, chatId, minutes) {
    try {
        let lockedUntil = null;
        let lockReason = 'Manual lock';

        if (minutes) {
            lockedUntil = new Date(Date.now() + minutes * 60 * 1000);
            lockReason = `Locked for ${minutes} minutes`;
        } else {
            lockReason = 'Permanently locked (until /unlock)';
        }

        const lock = await LockStatus.findOneAndUpdate(
            { chatId },
            { isLocked: true, lockedUntil, lockReason, lockedBy: bot.options.username }, // Assuming bot.options.username is the bot's username
            { upsert: true, new: true }
        );

        bot.sendMessage(chatId, `Group locked. ${lockReason}.`);
        await sendLog(bot, `[${chatId}] Group locked by admin. ${lockReason}.`);

        // Clear any existing timeout and set a new one if minutes are provided
        if (lockedGroupsTimeouts[chatId]) {
            clearTimeout(lockedGroupsTimeouts[chatId]);
        }
        if (minutes) {
            lockedGroupsTimeouts[chatId] = setTimeout(async () => {
                await unlockGroup(bot, chatId, true); // Pass true to indicate auto-unlock
            }, minutes * 60 * 1000);
        }

    } catch (error) {
        console.error('Error locking group:', error);
        bot.sendMessage(chatId, 'Failed to lock the group.');
    }
}

async function unlockGroup(bot, chatId, isAutoUnlock = false) {
    try {
        const lock = await LockStatus.findOneAndUpdate(
            { chatId },
            { isLocked: false, lockedUntil: null, lockReason: null, lockedBy: null },
            { new: true }
        );

        if (lock && !lock.isLocked) {
            const message = isAutoUnlock ? 'Group automatically unlocked.' : 'Group unlocked.';
            bot.sendMessage(chatId, message);
            await sendLog(bot, `[${chatId}] Group unlocked by ${isAutoUnlock ? 'auto-unlock' : 'admin'}.`);
        } else {
            if (!isAutoUnlock) {
                bot.sendMessage(chatId, 'Group is not currently locked.');
            }
        }

        // Clear the timeout if it exists
        if (lockedGroupsTimeouts[chatId]) {
            clearTimeout(lockedGroupsTimeouts[chatId]);
            delete lockedGroupsTimeouts[chatId];
        }

    } catch (error) {
        console.error('Error unlocking group:', error);
        bot.sendMessage(chatId, 'Failed to unlock the group.');
    }
}

async function getLockStatus(bot, chatId) {
    try {
        const lock = await LockStatus.findOne({ chatId });
        if (lock && lock.isLocked) {
            let statusMessage = `Group is currently locked.`;
            if (lock.lockedUntil) {
                const remainingMs = lock.lockedUntil.getTime() - Date.now();
                if (remainingMs > 0) {
                    const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
                    statusMessage += ` It will unlock in approximately ${remainingMinutes} minutes.`;
                } else {
                    statusMessage += ` It was scheduled to unlock but might need manual /unlock if not auto-unlocked yet.`;
                    // Trigger auto-unlock if the time has passed
                    await unlockGroup(bot, chatId, true);
                }
            } else {
                statusMessage += ` It is permanently locked (until manually /unlock).`;
            }
            bot.sendMessage(chatId, statusMessage);
        } else {
            bot.sendMessage(chatId, 'Group is currently unlocked.');
        }
    } catch (error) {
        console.error('Error getting lock status:', error);
        bot.sendMessage(chatId, 'Failed to retrieve lock status.');
    }
}

async function checkGroupLock(chatId) {
    try {
        const lock = await LockStatus.findOne({ chatId });
        if (lock && lock.isLocked) {
            if (lock.lockedUntil && lock.lockedUntil.getTime() < Date.now()) {
                // If past scheduled unlock time, auto-unlock it
                await unlockGroup(bot, chatId, true);
                return false; // Now unlocked
            }
            return true; // Still locked
        }
        return false; // Not locked
    } catch (error) {
        console.error('Error checking group lock:', error);
        return false;
    }
}

// Optional: Auto-lock the group daily during certain hours (e.g., 11 PM to 7 AM)
// This would require a scheduled task runner (e.g., node-cron) outside of basic bot.on()
// For example, in your index.js or a separate cron.js file:
/*
const cron = require('node-cron');
cron.schedule('0 23 * * *', async () => { // Every day at 11 PM
    // Iterate through all groups and check if auto-lock is enabled for them
    // This requires adding an 'autoLockSchedule' field to GroupSettings
    // For each relevant group, call lockGroup(bot, chatId, duration_until_7AM)
    // Example: For all chats in DB, if auto-lock enabled, call lockGroup(chatId, 8*60)
});
cron.schedule('0 7 * * *', async () => { // Every day at 7 AM
    // Iterate through all groups and unlock them if they were auto-locked
});
*/

module.exports = { lockGroup, unlockGroup, getLockStatus, checkGroupLock };