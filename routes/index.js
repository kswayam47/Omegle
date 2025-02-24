const express = require("express");
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const User = require('../models/User');

// Home page
router.get("/", function(req, res) {
    res.render("index");
});

// Random chat
router.get("/chat", isAuthenticated, function(req, res) {
    const roomId = req.query.room || null;
    res.render("chat", { roomId });
});

// Friend chat
router.get('/friend-chat/:friendId', isAuthenticated, async (req, res) => {
    try {
        const friendId = req.params.friendId;
        const friend = await User.findOne({ uniqueId: friendId });
        if (!friend) {
            return res.redirect('/auth/dashboard');
        }
        res.render('friend-chat', { 
            user: req.user,
            friend: friend
        });
    } catch (error) {
        console.error('Friend chat error:', error);
        res.redirect('/auth/dashboard');
    }
});

module.exports = router;