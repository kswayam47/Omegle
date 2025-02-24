const express = require("express")
const app = express();
const indexrouter = require("./routes/index");
const authRouter = require("./routes/auth");
const friendsRouter = require("./routes/friends");
const path = require("path");
const http = require("http")
const server = http.createServer(app);
const socketIO = require("socket.io");
const io = socketIO(server);
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const User = require('./models/User');
const Relation = require('./models/Relation');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/omegle', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Session configuration
const sessionMiddleware = session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: 'mongodb://localhost:27017/omegle'
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
});

app.use(sessionMiddleware);

// Convert a connect middleware to a Socket.IO middleware
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

const PRIVATE_ROOM_ID = 'rkgjtnnigot';
const PRIVATE_ROOM_PIN = '1234'; // You should change this to your desired PIN
let waitingusers = [];
let activeRooms = {}; // Track active rooms and their participants

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Store user's socket id and session data
    if (socket.request.session.userId) {
        socket.userId = socket.request.session.userId;
        socket.uniqueId = socket.request.session.uniqueId;
        socket.userName = socket.request.session.name;
        console.log('User authenticated:', socket.uniqueId);
    }

    // Handle friend requests
    socket.on('sendFriendRequest', async (data) => {
        try {
            if (!socket.userId) {
                socket.emit('error', { message: 'You must be logged in to send friend requests' });
                return;
            }

            const sender = await User.findById(socket.userId);
            if (!sender) {
                socket.emit('error', { message: 'Sender not found' });
                return;
            }

            const receiver = await User.findOne({ uniqueId: data.to });
            if (!receiver) {
                socket.emit('error', { message: 'User not found with that ID' });
                return;
            }

            if (sender.uniqueId === receiver.uniqueId) {
                socket.emit('error', { message: 'You cannot send a friend request to yourself' });
                return;
            }

            // Check if already friends
            const existingRelation = await Relation.findOne({
                $or: [
                    { user1Id: sender.uniqueId, user2Id: receiver.uniqueId },
                    { user1Id: receiver.uniqueId, user2Id: sender.uniqueId }
                ]
            });

            if (existingRelation) {
                socket.emit('error', { message: 'You are already friends with this user' });
                return;
            }

            // Send friend request to receiver
            const connectedSockets = await io.fetchSockets();
            const receiverSocket = connectedSockets.find(s => s.uniqueId === receiver.uniqueId);
            
            if (receiverSocket) {
                receiverSocket.emit('friendRequest', {
                    from: sender.uniqueId,
                    name: sender.name
                });
                console.log('Friend request sent to:', receiver.uniqueId);
            } else {
                socket.emit('error', { message: 'User is currently offline' });
            }
        } catch (error) {
            console.error('Send friend request error:', error);
            socket.emit('error', { message: 'Failed to send friend request' });
        }
    });

    socket.on('acceptFriendRequest', async (data) => {
        try {
            if (!socket.userId) {
                socket.emit('error', { message: 'You must be logged in to accept friend requests' });
                return;
            }

            const receiver = await User.findById(socket.userId);
            const sender = await User.findOne({ uniqueId: data.from });

            if (!sender || !receiver) {
                socket.emit('error', { message: 'User not found' });
                return;
            }

            // Check if already friends
            const existingRelation = await Relation.findOne({
                $or: [
                    { user1Id: sender.uniqueId, user2Id: receiver.uniqueId },
                    { user1Id: receiver.uniqueId, user2Id: sender.uniqueId }
                ]
            });

            if (existingRelation) {
                socket.emit('error', { message: 'Already friends' });
                return;
            }

            // Create new relation
            await Relation.create({
                user1Id: sender.uniqueId,
                user2Id: receiver.uniqueId
            });

            // Notify sender
            const connectedSockets = await io.fetchSockets();
            const senderSocket = connectedSockets.find(s => s.uniqueId === sender.uniqueId);
            
            if (senderSocket) {
                senderSocket.emit('friendRequestAccepted', {
                    name: receiver.name
                });
            }
            console.log('Friend request accepted:', sender.uniqueId, receiver.uniqueId);
        } catch (error) {
            console.error('Accept friend request error:', error);
            socket.emit('error', { message: 'Failed to accept friend request' });
        }
    });

    socket.on('rejectFriendRequest', async (data) => {
        try {
            if (!socket.userId) {
                socket.emit('error', { message: 'You must be logged in to reject friend requests' });
                return;
            }

            const receiver = await User.findById(socket.userId);
            const sender = await User.findOne({ uniqueId: data.from });

            if (!sender || !receiver) {
                socket.emit('error', { message: 'User not found' });
                return;
            }

            // Notify sender
            const connectedSockets = await io.fetchSockets();
            const senderSocket = connectedSockets.find(s => s.uniqueId === sender.uniqueId);
            
            if (senderSocket) {
                senderSocket.emit('friendRequestRejected', {
                    name: receiver.name
                });
            }
            console.log('Friend request rejected:', sender.uniqueId, receiver.uniqueId);
        } catch (error) {
            console.error('Reject friend request error:', error);
            socket.emit('error', { message: 'Failed to reject friend request' });
        }
    });

    // Store user's socket id for friend system
    socket.on('storeUserId', (userId) => {
        socket.userId = userId;
        socket.join(userId); // Join a room with their userId
    });

    // Handle private room for friend chat
    socket.on('joinPrivateRoom', async (data) => {
        const { friendId } = data;
        const userId = socket.userId;
        if (userId) {
            const roomId = [userId, friendId].sort().join('-');
            socket.join(roomId);
            io.to(roomId).emit('userJoinedRoom', { roomId, userId: socket.userId });
        }
    });

    // Handle private messages between friends
    socket.on('privateMessage', (data) => {
        const { roomId, message } = data;
        io.to(roomId).emit('privateMessage', {
            message,
            userId: socket.userId,
            timestamp: new Date()
        });
    });

    // Original random chat functionality
    socket.on("joinroom", function(roomId) {
        if (roomId) {
            socket.join(roomId);
            return;
        }
        
        if (waitingusers.length && waitingusers[0].id !== socket.id) {
            const partner = waitingusers.shift();
            const room = Math.random().toString(36).substring(7);
            socket.join(room);
            io.sockets.sockets.get(partner.id)?.join(room);
            io.to(room).emit("joined", room);
        } else {
            waitingusers.push({
                id: socket.id
            });
        }
    });

    socket.on("message", function(data) {
        socket.to(data.room).emit("message", data.message);
    });

    socket.on("disconnect", () => {
        console.log('User disconnected:', socket.id);
        waitingusers = waitingusers.filter(user => user.id !== socket.id);
        if (socket.userId) {
            socket.leave(socket.userId);
        }
    });

    // Original video call functionality
    socket.on("signalingMessage", function(data) {
        socket.to(data.room).emit("signalingMessage", data.message);
    });

    socket.on("startVideoCall", function(data) {
        socket.to(data.room).emit("incomingCall");
    });

    socket.on("acceptCall", function(data) {
        socket.to(data.room).emit("callAccepted");
    });

    socket.on("rejectCall", function(data) {
        socket.to(data.room).emit("callRejected");
    });
});

app.set("view engine","ejs");
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));

// Use routers
app.use("/",indexrouter);
app.use("/auth",authRouter);

const port = process.env.PORT || 3000;

server.listen(port);