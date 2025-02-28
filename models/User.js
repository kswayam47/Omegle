const mongoose = require('mongoose');
const Joi = require('joi');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 50
    },
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 30
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    uniqueId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    bio: {
        type: String,
        default: "Hey there! I'm using Omegle.",
        maxlength: 150
    },
    relations: {
        type: [String],
        default: []
    },
    pendingRequests: {
        type: [String],
        default: []
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Create Mongoose Model
const User = mongoose.model('User', userSchema);

// JOI Validation Schema
const validateUser = (data) => {
    const schema = Joi.object({
        name: Joi.string().min(3).max(50).required(),
        username: Joi.string().min(3).max(30).required(),
        password: Joi.string().min(6).required(),
        uniqueId: Joi.string().required(),
        bio: Joi.string().max(150),
        relations: Joi.array().items(Joi.string()),
        pendingRequests: Joi.array().items(Joi.string()),
    });

    return schema.validate(data, { abortEarly: false });
};

// Function to Validate and Save User
const createUser = async (userData) => {
    const { error } = validateUser(userData);
    if (error) {
        return { success: false, errors: error.details.map((err) => err.message) };
    }

    try {
        const newUser = new User(userData);
        await newUser.save();
        return { success: true, user: newUser };
    } catch (err) {
        return { success: false, errors: [err.message] };
    }
};

module.exports = { User, validateUser, createUser };
