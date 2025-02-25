const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Relation = require('../models/Relation');

// Show friends list page
router.get('/', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/auth/login');
    }
    res.render('friends/list', { userId: req.session.userId });
});

// Show private chat page
router.get('/chat/:friendId', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/auth/login');
    }
    res.render('friends/chat', { 
        userId: req.session.userId,
        friendId: req.params.friendId 
    });
});

// Get friends list
router.get('/list', async (req, res) => {
    try {
        const userId = req.session.userId;
        const relations = await Relation.find({
            $or: [{ user1Id: userId }, { user2Id: userId }]
        });
        
        const friendIds = relations.map(relation => 
            relation.user1Id === userId ? relation.user2Id : relation.user1Id
        );
        
        const friends = await User.find({
            uniqueId: { $in: friendIds }
        }, 'username uniqueId');
        
        res.json({ success: true, friends });
    } catch (error) {
        res.json({ success: false, message: 'Failed to load friends' });
    }
});

// Send friend request
router.post('/request', async (req, res) => {
    try {
        const { friendId } = req.body;
        const fromUserId = req.session.userId;

        if (fromUserId === friendId) {
            return res.json({ success: false, message: 'Cannot send friend request to yourself' });
        }

        const toUser = await User.findOne({ uniqueId: friendId });
        if (!toUser) {
            return res.json({ success: false, message: 'User not found' });
        }

        // Check if already friends
        const existingRelation = await Relation.findOne({
            $or: [
                { user1Id: fromUserId, user2Id: friendId },
                { user1Id: friendId, user2Id: fromUserId }
            ]
        });

        if (existingRelation) {
            return res.json({ success: false, message: 'Already friends with this user' });
        }

        // Emit friend request event to the recipient
        req.app.get('io').to(friendId).emit('friendRequest', { fromUserId });
        
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: 'Failed to send friend request' });
    }
});

// Accept friend request
router.post('/accept', async (req, res) => {
    try {
        const { fromUserId } = req.body;
        const toUserId = req.session.userId;

        const relation = new Relation({
            user1Id: fromUserId,
            user2Id: toUserId
        });
        await relation.save();

        // Notify both users about the accepted friend request
        const io = req.app.get('io');
        io.to(fromUserId).emit('friendRequestAccepted', { userId: toUserId });
        io.to(toUserId).emit('friendRequestAccepted', { userId: fromUserId });

        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: 'Failed to accept friend request' });
    }
});

module.exports = router;