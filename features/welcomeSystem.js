// features/welcomeSystem.js

const GroupSettings = require('../models/GroupSettings');
const UserRole = require('../models/UserRole');
const { sendLog } = require('../utils/logger');

// Utility function to HTML-escape text
// This function needs to be here (top-level) to be accessible.
function escapeHtml(text) {
  // Ensure 'text' is a string before calling .replace
  if (typeof text !== 'string') {
    text = String(text);
  }
  return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

// parseMessageContent: Now ONLY extracts the JSON button block.
// It DOES NOT do any HTML escaping or Markdown-to-HTML conversion.
// It assumes the remaining 'text' is valid HTML.
function parseMessageContent(text) {
    let replyOptions = { parse_mode: 'HTML' }; // Always assume HTML for the final message send.
    let cleanedText = text; // This text is kept as the original input, *except* for JSON block removal.
    let buttonsExtracted = false; // Flag to indicate if buttons were successfully extracted

    // --- DEBUGGING LOGS ---
    console.log("\n--- Entering parseMessageContent ---");
    console.log("Input text length:", text.length);
    console.log("Input text preview (first 500 chars):\n", text.substring(0, Math.min(text.length, 500)));
    console.log("Input text (last 500 chars):\n", text.substring(Math.max(0, text.length - 500)));
    // --- END DEBUGGING LOGS ---

    // The robust regex for ```json``` block at the end of the text.
    // Handles various whitespaces and newlines.
    const inlineKeyboardMatch = text.match(/\s*```json\s*\r?\n([\s\S]+?)\r?\n\s*```\s*$/);

    // --- DEBUGGING LOGS ---
    if (inlineKeyboardMatch) {
        console.log("parseMessageContent: Regex matched!");
        console.log("Full matched part length:", inlineKeyboardMatch[0].length, "chars.");
        console.log("Captured JSON content length:", inlineKeyboardMatch[1].length, "chars.");
        console.log("Captured JSON content preview:\n", inlineKeyboardMatch[1].substring(0, Math.min(inlineKeyboardMatch[1].length, 500)));
    } else {
        console.log("parseMessageContent: Regex DID NOT match the JSON block at the end.");
    }
    // --- END DEBUGGING LOGS ---


    if (inlineKeyboardMatch) {
        const jsonPart = inlineKeyboardMatch[1];
        try {
            const keyboard = JSON.parse(jsonPart);
            replyOptions.reply_markup = { inline_keyboard: keyboard };
            // CRITICAL: Remove the entire matched block (including backticks and surrounding whitespace/newlines)
            cleanedText = text.replace(inlineKeyboardMatch[0], '').trim();
            buttonsExtracted = true;
        } catch (e) {
            console.warn('Invalid JSON for inline keyboard in message content:', e.message);
            // Even if JSON is invalid, if the block matched, we MUST remove the block
            // from `cleanedText` to prevent Telegram parsing errors.
            cleanedText = text.replace(inlineKeyboardMatch[0], '').trim();
            console.warn('Malformed JSON: Removed JSON block from text, but buttons not parsed.');
        }
    }

    // The parse_mode is fixed to 'HTML' for welcome messages now.
    // No dynamic detection or Markdown conversion happens here.
    console.log("--- Exiting parseMessageContent ---");
    return { text: cleanedText, options: replyOptions };
}


async function setupWelcome(bot, msg, welcomeText) {
    const chatId = msg.chat.id;
    let welcomeMediaFileId = null;
    let welcomeParseMode = 'HTML'; // Force parse mode to HTML for welcome messages.

    // Check if the admin is replying to a media message
    if (msg.reply_to_message) {
        const replied = msg.reply_to_message;
        if (replied.photo) {
            welcomeMediaFileId = replied.photo[replied.photo.length - 1].file_id; // Get the largest photo size
        } else if (replied.video) {
            welcomeMediaFileId = replied.video.file_id;
        } else if (replied.animation) { // For GIFs
            welcomeMediaFileId = replied.animation.file_id;
        } else if (replied.document) {
            // Check if document is an image or video, sometimes they are sent as documents
            if (replied.document.mime_type && (replied.document.mime_type.startsWith('image/') || replied.document.mime_type.startsWith('video/'))) {
                 welcomeMediaFileId = replied.document.file_id;
            }
        }
    }

    // Process the welcome text for formatting and buttons.
    // `parseMessageContent` extracts the JSON buttons and removes the JSON block from the text.
    // The text now stored in `cleanedWelcomeText` is the raw text (potentially with HTML tags manually inserted).
    const { text: cleanedWelcomeText, options: textOptions } = parseMessageContent(welcomeText);

    try {
        await GroupSettings.findOneAndUpdate(
            { chatId },
            {
                welcomeMessage: cleanedWelcomeText, // Store the text (with HTML tags if provided by admin)
                welcomeMediaFileId: welcomeMediaFileId,
                welcomeParseMode: welcomeParseMode // This will always be 'HTML'
            },
            { upsert: true, new: true } // Upsert: create if not exists, update if it does
        );

        let confirmationMessage = 'Welcome message updated successfully.';
        if (welcomeMediaFileId) {
            confirmationMessage += '\nMedia banner also set.';
        }
        bot.sendMessage(chatId, confirmationMessage);
        await sendLog(bot, `[${chatId}] Welcome message set by ${msg.from.first_name}: "${cleanedWelcomeText.substring(0, Math.min(cleanedWelcomeText.length, 100))}..." (Media: ${welcomeMediaFileId || 'None'})`);
    } catch (error) {
        console.error('Error setting welcome message:', error);
        bot.sendMessage(chatId, 'Failed to set welcome message. Check console for details.').catch(console.error);
    }
}


async function testWelcome(bot, chatId, user) {
    try {
        const settings = await GroupSettings.findOne({ chatId });
        const welcomeMessageTemplate = settings?.welcomeMessage || 'Welcome {mention} to the group!';
        const welcomeMediaFileId = settings?.welcomeMediaFileId || null;
        const welcomeParseMode = settings?.welcomeParseMode || 'HTML'; // Explicitly use HTML now

        const userRole = await UserRole.findOne({ chatId, userId: user.id });
        const roleTag = userRole ? ` [${userRole.role}]` : '';

        // Generate mention text in HTML format.
        // It's crucial that username/first_name/roleTag are HTML-escaped here in case they contain HTML special chars.
        const mentionText = `<a href="tg://user?id=${user.id}">${escapeHtml(user.first_name || user.username)}</a>${escapeHtml(roleTag)}`;

        // Replace {mention} in the stored template with the HTML mention.
        // `welcomeMessageTemplate` should now contain HTML, directly from the admin's input.
        let finalMessageText = welcomeMessageTemplate.replace(/{mention}/g, mentionText);

        // Parse buttons from `finalMessageText`. `parseMessageContent` removes the JSON block.
        const { text, options } = parseMessageContent(finalMessageText);
        options.parse_mode = welcomeParseMode; // Enforce HTML parse_mode.

        let sentMessage = null;

        // --- DEBUGGING LOGS ---
        console.log("\n--- DEBUG: testWelcome attempt ---");
        console.log("Final text to be sent as caption (after processing):", text.substring(0, Math.min(text.length, 500)));
        console.log("Options for sending (includes parse_mode and reply_markup):", JSON.stringify(options, null, 2));
        console.log("--- END DEBUG ---");
        // --- END DEBUGGING LOGS ---


        if (welcomeMediaFileId) {
            try {
                if (welcomeMediaFileId.startsWith('CgAC') || welcomeMediaFileId.endsWith('_gif')) {
                    sentMessage = await bot.sendAnimation(chatId, welcomeMediaFileId, { caption: text, ...options });
                } else if (welcomeMediaFileId.startsWith('BAAC') || welcomeMediaFileId.endsWith('_video')) {
                    sentMessage = await bot.sendVideo(chatId, welcomeMediaFileId, { caption: text, ...options });
                } else {
                    sentMessage = await bot.sendPhoto(chatId, welcomeMediaFileId, { caption: text, ...options });
                }
            } catch (mediaError) {
                console.error(`Failed to send welcome media (${welcomeMediaFileId}), trying fallback:`, mediaError.message);
                try {
                    sentMessage = await bot.sendDocument(chatId, welcomeMediaFileId, { caption: text, ...options });
                } catch (docError) {
                    console.error(`Failed to send welcome document (${welcomeMediaFileId}), falling back to text only:`, docError.message);
                    sentMessage = await bot.sendMessage(chatId, text, options);
                }
            }
        } else {
            // No media file, just send text
            sentMessage = await bot.sendMessage(chatId, text, options);
        }

        return sentMessage;

    } catch (error) {
        console.error('Error in testWelcome function:', error);
        bot.sendMessage(chatId, 'Failed to test welcome message. Check console for details.').catch(console.error);
        return null;
    }
}

async function handleNewChatMembers(bot, chatId, newMember, lastWelcomeMessageIdTracker) {
    try {
        const settings = await GroupSettings.findOne({ chatId });
        const welcomeMessageTemplate = settings?.welcomeMessage || 'Welcome {mention} to the group!';
        const welcomeMediaFileId = settings?.welcomeMediaFileId || null;
        const welcomeParseMode = settings?.welcomeParseMode || 'HTML'; // Explicitly use HTML now

        const userRole = await UserRole.findOne({ chatId, userId: newMember.id });
        const roleTag = userRole ? ` [${userRole.role}]` : '';

        const mentionText = `<a href="tg://user?id=${newMember.id}">${escapeHtml(newMember.first_name || newMember.username)}</a>${escapeHtml(roleTag)}`;
        const welcomeMessageWithMention = welcomeMessageTemplate.replace(/{mention}/g, mentionText);

        const { text, options } = parseMessageContent(welcomeMessageWithMention);
        options.parse_mode = welcomeParseMode;

        let sentMessage = null;

        if (lastWelcomeMessageIdTracker[chatId]) {
            deletePreviousWelcome(bot, chatId, lastWelcomeMessageIdTracker[chatId]);
        }

        console.log("\n--- DEBUG: handleNewChatMembers attempt ---");
        console.log("Final text to be sent as caption (after processing):", text.substring(0, Math.min(text.length, 500)));
        console.log("Options for sending (includes parse_mode and reply_markup):", JSON.stringify(options, null, 2));
        console.log("--- END DEBUG ---");


        if (welcomeMediaFileId) {
            try {
                if (welcomeMediaFileId.startsWith('CgAC') || welcomeMediaFileId.endsWith('_gif')) {
                    sentMessage = await bot.sendAnimation(chatId, welcomeMediaFileId, { caption: text, ...options });
                } else if (welcomeMediaFileId.startsWith('BAAC') || welcomeMediaFileId.endsWith('_video')) {
                    sentMessage = await bot.sendVideo(chatId, welcomeMediaFileId, { caption: text, ...options });
                } else {
                    sentMessage = await bot.sendPhoto(chatId, welcomeMediaFileId, { caption: text, ...options });
                }
            } catch (mediaError) {
                console.error(`Failed to send welcome media (${welcomeMediaFileId}), trying fallback:`, mediaError.message);
                try {
                    sentMessage = await bot.sendDocument(chatId, welcomeMediaFileId, { caption: text, ...options });
                } catch (docError) {
                    console.error(`Failed to send welcome document (${welcomeMediaFileId}), falling back to text only:`, docError.message);
                    sentMessage = await bot.sendMessage(chatId, text, options);
                }
            }
        } else {
            sentMessage = await bot.sendMessage(chatId, text, options);
        }

        if (sentMessage) {
            lastWelcomeMessageIdTracker[chatId] = sentMessage.message_id;

            setTimeout(() => {
                bot.deleteMessage(chatId, sentMessage.message_id).catch(err => {
                    if (err.response && err.response.body && err.response.body.description.includes('message to delete not found')) {
                    } else {
                        console.error('Error auto-deleting welcome message:', err);
                    }
                });
            }, 60 * 1000);
        }

        return sentMessage;
    } catch (error) {
        console.error('Error handling new chat members:', error);
        bot.sendMessage(chatId, 'Failed to send welcome message to new user. Check console for details.').catch(console.error);
        return null;
    }
}

async function deletePreviousWelcome(bot, chatId, messageId) {
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch (error) {
        if (error.response && error.response.body && error.response.body.description.includes('message to delete not found')) {
        } else {
            console.error('Error deleting previous welcome message:', error);
        }
    }
}

module.exports = { setupWelcome, testWelcome, handleNewChatMembers, deletePreviousWelcome, parseMessageContent };