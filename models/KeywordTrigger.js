const mongoose = require('mongoose');

const KeywordTriggerSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true
    },
    keyword: {
        type: String,
        required: true,
        lowercase: true
    },
    response: {
        type: String,
        required: true
    },
    // Optional: store parse_mode for response, media type, etc.
});

KeywordTriggerSchema.index({ chatId: 1, keyword: 1 }, { unique: true });

module.exports = mongoose.model('KeywordTrigger', KeywordTriggerSchema);