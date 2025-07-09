const mongoose = require('mongoose');

const CustomCommandSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true
    },
    name: {
        type: String,
        required: true,
        lowercase: true
    },
    response: {
        type: String,
        required: true
    },
    // Optional: store parse_mode (Markdown, HTML) for the response
    parseMode: {
        type: String,
        enum: ['Markdown', 'HTML', null],
        default: 'Markdown'
    }
});

CustomCommandSchema.index({ chatId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('CustomCommand', CustomCommandSchema);