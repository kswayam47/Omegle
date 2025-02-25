const express = require('express');
const router = express.Router();
const Profile = require('../models/Profile');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, './public/uploads')
    },
    filename: function(req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: function(req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif|mp3|wav|mp4/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image, audio and video files are allowed!'));
    }
});

// Render profile page
router.get('/', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect('/auth/login');
        }

        const profile = await Profile.findOne({ userId: req.session.userId });
        res.render('profile', { 
            user: {
                name: req.session.name,
                username: req.session.username
            },
            profile: profile || {}
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).send('Server error');
    }
});

// Update profile
router.post('/update', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect('/auth/login');
        }

        const { bio, interests, preferredLanguage } = req.body;
        const profile = await Profile.findOneAndUpdate(
            { userId: req.session.userId },
            { bio, interests: interests.split(',').map(i => i.trim()), preferredLanguage },
            { new: true, upsert: true }
        );

        req.flash('success', 'Profile updated successfully!');
        res.redirect('/profile');
    } catch (error) {
        console.error('Error updating profile:', error);
        req.flash('error', 'Failed to update profile');
        res.redirect('/profile');
    }
});

// Upload avatar
router.post('/avatar', upload.single('avatar'), async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const avatarUrl = `/uploads/${req.file.filename}`;
        await Profile.findOneAndUpdate(
            { userId: req.session.userId },
            { avatarUrl },
            { new: true, upsert: true }
        );

        res.json({ success: true, avatarUrl });
    } catch (error) {
        console.error('Error uploading avatar:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// File upload for chat
router.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const fileUrl = `/uploads/${req.file.filename}`;
        res.json({ 
            success: true, 
            file: {
                url: fileUrl,
                type: req.file.mimetype,
                name: req.file.originalname
            }
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
