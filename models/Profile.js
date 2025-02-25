const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    interests: [{
        type: String,
        trim: true
    }],
    bio: {
        type: String,
        maxLength: 500
    },
    preferredLanguage: {
        type: String,
        default: 'en'
    },
    lastSeen: {
        type: Date,
        default: Date.now
    },
    avatarUrl: String,
    status: {
        type: String,
        enum: ['online', 'offline', 'busy'],
        default: 'offline'
    }
}, { timestamps: true });

module.exports = mongoose.model('Profile', profileSchema);
