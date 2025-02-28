const User = require('../models/User');
const Relation = require('../models/Relation');
const Message = require('../models/Message');
const sharp = require('sharp');

function initFriendSocket(io) {
    const userSockets = new Map(); // uniqueId -> Set of socket IDs
    const onlineUsers = new Set();
    const activeRooms = new Map(); // roomId -> {users: Set, messages: Array}

    // Helper function to extract base64 image data
    const extractImageData = (message) => {
        const match = message.match(/<img>data:([^;]+);base64,([^<]+)<\/img>/);
        return match ? { contentType: match[1], data: match[2] } : null;
    };

    // Helper function to check file size (10MB limit)
    const checkImageSize = (message) => {
        const base64Data = message.replace(/^<img>data:[^;]+;base64,/, '').replace(/<\/img>$/, '');
        const sizeInBytes = Buffer.from(base64Data, 'base64').length;
        const sizeInMB = sizeInBytes / (1024 * 1024);
        return sizeInMB <= 10;
    };

    io.on('connection', async (socket) => {
        console.log('Friend socket connected:', socket.id);

        // Handle user coming online
        socket.on('userOnline', async (data) => {
            const { uniqueId } = data;
            socket.uniqueId = uniqueId;
            onlineUsers.add(uniqueId);

            if (!userSockets.has(uniqueId)) {
                userSockets.set(uniqueId, new Set());
            }
            userSockets.get(uniqueId).add(socket.id);

            // Get all online users and send status to the newly connected user
            onlineUsers.forEach(onlineUserId => {
                if (onlineUserId !== uniqueId) {
                    socket.emit('friendStatus', {
                        friendId: onlineUserId,
                        isOnline: true
                    });
                }
            });

            // Broadcast online status to all other users
            socket.broadcast.emit('friendStatus', {
                friendId: uniqueId,
                isOnline: true
            });
        });

        // Handle friend status updates
        socket.on('friendStatus', async (data) => {
            const { friendId } = data;
            // When receiving a friend's status, send back your status to them
            if (socket.uniqueId && userSockets.has(friendId)) {
                const targetSockets = userSockets.get(friendId);
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('friendStatus', {
                        friendId: socket.uniqueId,
                        isOnline: true
                    });
                });
            }
        });

        // Join private room
        socket.on('joinPrivateRoom', async (data) => {
            const { friendId } = data;
            const users = [socket.uniqueId, friendId].sort();
            const roomId = `chat_${users[0]}_${users[1]}`;
            
            // Leave previous rooms
            Object.keys(socket.rooms).forEach(room => {
                if (room !== socket.id) socket.leave(room);
            });

            socket.join(roomId);
            socket.currentRoom = roomId;

            if (!activeRooms.has(roomId)) {
                activeRooms.set(roomId, {
                    users: new Set([socket.uniqueId, friendId]),
                    messages: []
                });
            }

            socket.emit('userJoinedRoom', { roomId });
        });
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

        // Handle messages
        socket.on('message', async (message) => {
            if (!socket.currentRoom || !message) return;
            
            try {
                // Get the recipient's ID from the room
                const roomUsers = Array.from(activeRooms.get(socket.currentRoom).users);
                const recipientId = roomUsers.find(id => id !== socket.uniqueId);

                // For images, first check size and send
                if (message.startsWith('<img>')) {
                    // Check size first
                    if (!checkImageSize(message)) {
                        socket.emit('error', 'Image size exceeds 10MB limit');
                        return;
                    }

                    // Send image immediately
                    socket.broadcast.to(socket.currentRoom).emit('message', message);

                    // After successful send, store in DB
                    setTimeout(async () => {
                        try {
                            // Extract image data
                            const base64Data = message.replace(/^<img>data:([^;]+);base64,/, '').replace(/<\/img>$/, '');
                            const contentType = message.match(/^<img>data:([^;]+);base64,/)[1];
                            
                            // Compress image
                            const imageBuffer = Buffer.from(base64Data, 'base64');
                            const compressedImage = await sharp(imageBuffer)
                                .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                                .jpeg({ quality: 80 })
                                .toBuffer();

                            // Store in DB
                            const newMessage = new Message({
                                from: socket.uniqueId,
                                to: recipientId,
                                content: '<img>stored',
                                compressedImage: compressedImage,
                                contentType: contentType
                            });
                            await newMessage.save();
                        } catch (err) {
                            console.error('Error storing image:', err);
                        }
                    }, 1000); // Wait 1 second after sending before storing

                } else {
                    // For text messages, send immediately
                    socket.broadcast.to(socket.currentRoom).emit('message', message);
                    
                    // Then store
                    const newMessage = new Message({
                        from: socket.uniqueId,
                        to: recipientId,
                        content: message,
                        isRead: false
                    });
                    await newMessage.save();
                }

                // Get sender's name and handle notifications
                const sender = await User.findOne({ uniqueId: socket.uniqueId });
                if (userSockets.has(recipientId)) {
                    const recipientSockets = userSockets.get(recipientId);
                    recipientSockets.forEach(socketId => {
                        if (!activeRooms.get(socket.currentRoom).users.has(recipientId)) {
                            io.to(socketId).emit('notification', {
                                message: `New message from ${sender.name}`,
                                from: socket.uniqueId
                            });
                        }
                    });
                }
            } catch (error) {
                console.error('Error handling message:', error);
                socket.emit('error', 'Failed to process message');
            }
        });

        // Handle marking messages as read
        socket.on('markMessagesAsRead', async (data) => {
            try {
                const { fromUser } = data;
                await Message.updateMany(
                    { from: fromUser, to: socket.uniqueId, isRead: false },
                    { isRead: true }
                );
            } catch (error) {
                console.error('Error marking messages as read:', error);
            }
        });

        // Handle getting unread messages count
        socket.on('getUnreadMessages', async () => {
            try {
                const unreadCounts = await Message.aggregate([
                    {
                        $match: {
                            to: socket.uniqueId,
                            isRead: false
                        }
                    },
                    {
                        $group: {
                            _id: '$from',
                            count: { $sum: 1 },
                            lastMessage: { $last: '$content' }
                        }
                    }
                ]);

                const unreadInfo = await Promise.all(unreadCounts.map(async (item) => {
                    const sender = await User.findOne({ uniqueId: item._id });
                    return {
                        from: item._id,
                        senderName: sender ? sender.name : 'Unknown',
                        count: item.count,
                        lastMessage: item.lastMessage
                    };
                }));

                socket.emit('unreadMessages', unreadInfo);
            } catch (error) {
                console.error('Error getting unread messages:', error);
            }
        });

        // Handle loading previous messages
        socket.on('getMessages', async (data) => {
            try {
                const { friendId } = data;
                if (!socket.uniqueId || !friendId) return;

                const messages = await Message.find({
                    $or: [
                        { from: socket.uniqueId, to: friendId },
                        { from: friendId, to: socket.uniqueId }
                    ]
                }).sort('timestamp');

                // Filter out stored image placeholders
                const filteredMessages = messages.map(msg => ({
                    content: msg.content === '<img>stored' ? '' : msg.content,
                    from: msg.from
                })).filter(msg => msg.content !== '');

                socket.emit('previousMessages', filteredMessages);
            } catch (error) {
                console.error('Error getting previous messages:', error);
            }
        });

        // Video call signaling
        socket.on('callRequest', (data) => {
            const { target } = data;
            const targetSockets = userSockets.get(target);
            
            if (targetSockets) {
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('incomingCall', {
                        from: socket.uniqueId
                    });
                });
            }
        });

        socket.on('callResponse', (data) => {
            const { target, accepted } = data;
            const targetSockets = userSockets.get(target);
            
            if (targetSockets) {
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('callResponseReceived', {
                        from: socket.uniqueId,
                        accepted
                    });
                });
            }
        });

        socket.on('videoOffer', (data) => {
            console.log('Relaying video offer from:', socket.uniqueId);
            const { target, sdp } = data;
            const targetSockets = userSockets.get(target);
            
            if (targetSockets) {
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('videoOffer', {
                        from: socket.uniqueId,
                        sdp
                    });
                });
            }
        });

        socket.on('videoAnswer', (data) => {
            console.log('Relaying video answer from:', socket.uniqueId);
            const { target, sdp } = data;
            const targetSockets = userSockets.get(target);
            
            if (targetSockets) {
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('videoAnswer', {
                        from: socket.uniqueId,
                        sdp
                    });
                });
            }
        });

        socket.on('iceCandidate', (data) => {
            console.log('Relaying ICE candidate from:', socket.uniqueId);
            const { target, candidate } = data;
            const targetSockets = userSockets.get(target);
            
            if (targetSockets) {
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('iceCandidate', {
                        from: socket.uniqueId,
                        candidate
                    });
                });
            }
        });

        socket.on('endCall', (data) => {
            console.log('Relaying call end from:', socket.uniqueId);
            const { target } = data;
            const targetSockets = userSockets.get(target);
            
            if (targetSockets) {
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('callEnded', {
                        from: socket.uniqueId
                    });
                });
            }
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            if (socket.uniqueId) {
                const userSocketSet = userSockets.get(socket.uniqueId);
                if (userSocketSet) {
                    userSocketSet.delete(socket.id);
                    if (userSocketSet.size === 0) {
                        onlineUsers.delete(socket.uniqueId);
                        userSockets.delete(socket.uniqueId);
                        io.emit('friendStatus', {
                            friendId: socket.uniqueId,
                            isOnline: false
                        });
                    }
                }
            }
        });
    });
}

module.exports = initFriendSocket;