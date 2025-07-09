const mongoose = require('mongoose');

const GroupSettingsSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true,
        unique: true
    },
    welcomeMessage: { // This stores the TEXT part of the welcome message (after JSON block is removed)
        type: String,
        default: 'Welcome {mention} to the group!'
    },
    welcomeMediaFileId: { // New field for storing Telegram file_id if media is part of welcome
        type: String,
        default: null
    },
    welcomeParseMode: { // New field to explicitly store the parse_mode ('Markdown' or 'HTML')
        type: String,
        enum: ['Markdown', 'HTML', null],
        default: 'Markdown' // Default parse mode for the text
    },
    autoDeleteLinks: {
        type: Boolean,
        default: true
    },
    autoDeleteBannedWords: {
        type: Boolean,
        default: true
    },
    bannedWords: {
        type: [String],
        default: []
    },
    autoDeleteForwarded: {
        type: Boolean,
        default: false
    },
    captchaEnabled: {
        type: Boolean,
        default: true
    },
    // ... other settings (if you have them)
});

module.exports = mongoose.model('GroupSettings', GroupSettingsSchema);