const User = require('../models/User');

const isAuthenticated = async (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/auth/login');
    }

    try {
        // Attach user to request
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.redirect('/auth/login');
        }
        req.user = user;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.redirect('/auth/login');
    }
};

module.exports = {
    isAuthenticated
};
