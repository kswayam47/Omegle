const mongoose = require('mongoose');

const relationSchema = new mongoose.Schema({
    user1Id: {
        type: String,
        required: true
    },
    user2Id: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Ensure unique relationships
relationSchema.index({ user1Id: 1, user2Id: 1 }, { unique: true });

module.exports = mongoose.model('Relation', relationSchema);
