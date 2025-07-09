const mongoose = require('mongoose');

const UserRoleSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true
    },
    userId: {
        type: Number,
        required: true
    },
    role: {
        type: String,
        required: true
    },
    username: String, // Store username for easier lookup/display
    firstName: String,
    lastName: String
});

UserRoleSchema.index({ chatId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UserRole', UserRoleSchema);