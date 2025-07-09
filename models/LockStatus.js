const mongoose = require('mongoose');

const LockStatusSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true,
        unique: true
    },
    isLocked: {
        type: Boolean,
        default: false
    },
    lockedUntil: {
        type: Date,
        default: null
    },
    lockedBy: {
        type: Number, // User ID of the admin who locked it
        default: null
    },
    lockReason: {
        type: String,
        default: 'Manual lock'
    }
});

module.exports = mongoose.model('LockStatus', LockStatusSchema);