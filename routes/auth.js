const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Relation = require('../models/Relation');

// Render login page
router.get('/login', (req, res) => {
    res.render('login');
});

// Render register page
router.get('/create', (req, res) => {
    res.render('register');
});

// Render chat page
router.get('/chat', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/auth/login');
    }
    res.render('chat');
});

// Login route
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });

        if (!user) {
            return res.render('login', { error: 'Invalid username or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid username or password' });
        }

        req.session.userId = user._id;
        req.session.uniqueId = user.uniqueId;
        req.session.username = user.username;
        req.session.name = user.name;
        
        res.redirect('/auth/dashboard');
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'An error occurred. Please try again.' });
    }
});

// Register route
router.post('/create', async (req, res) => {
    try {
        const { name, username, password } = req.body;

        // Check if username exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.json({ success: false, message: 'Username already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const user = new User({
            name,
            username,
            password: hashedPassword,
            uniqueId: uuidv4()
        });

        await user.save();

        // Set user session
        req.session.userId = user.uniqueId;

        res.json({
            success: true,
            uniqueId: user.uniqueId
        });
    } catch (error) {
        res.json({ success: false, message: 'An error occurred' });
    }
});

// Add relation route
router.post('/add-relation', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.json({ success: false, message: 'Not authenticated' });
        }

        const { referralId } = req.body;
        
        // Check if referral ID exists
        const referredUser = await User.findOne({ uniqueId: referralId });
        if (!referredUser) {
            return res.json({ success: false, message: 'Invalid referral ID' });
        }

        // Check if relation already exists
        const existingRelation = await Relation.findOne({
            $or: [
                { user1Id: req.session.userId, user2Id: referralId },
                { user1Id: referralId, user2Id: req.session.userId }
            ]
        });

        if (existingRelation) {
            return res.json({ success: false, message: 'Relation already exists' });
        }

        // Create new relation
        const relation = new Relation({
            user1Id: req.session.userId,
            user2Id: referralId
        });

        await relation.save();

        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: 'An error occurred' });
    }
});

// Get user relations
router.get('/relations', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.json({ success: false, message: 'Not authenticated' });
        }

        const relations = await Relation.find({
            $or: [
                { user1Id: req.session.userId },
                { user2Id: req.session.userId }
            ]
        });

        const friendIds = relations.map(relation => 
            relation.user1Id === req.session.userId ? relation.user2Id : relation.user1Id
        );

        const friends = await User.find({
            uniqueId: { $in: friendIds }
        }).select('name username uniqueId');

        res.json({
            success: true,
            friends
        });
    } catch (error) {
        res.json({ success: false, message: 'An error occurred' });
    }
});

// Add dashboard route
router.get('/dashboard', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/auth/login');
    }

    try {
        const user = await User.findById(req.session.userId);
        const relations = await Relation.find({
            $or: [
                { user1Id: user.uniqueId },
                { user2Id: user.uniqueId }
            ]
        });

        const friendIds = relations.map(rel => 
            rel.user1Id === user.uniqueId ? rel.user2Id : rel.user1Id
        );

        const friends = await User.find({
            uniqueId: { $in: friendIds }
        }).select('name uniqueId');

        res.render('dashboard', { user, friends });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.redirect('/auth/login');
    }
});

module.exports = router;