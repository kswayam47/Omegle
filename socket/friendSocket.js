const User = require('../models/User');
const Relation = require('../models/Relation');
const Message = require('../models/Message');

function initFriendSocket(io) {
    const userSockets = new Map(); // uniqueId -> Set of socket IDs
    const onlineUsers = new Set();
    const activeRooms = new Map(); // roomId -> {users: Set, messages: Array}

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

        // Handle messages
        socket.on('message', async (message) => {
            if (!socket.currentRoom || !message) return;
            
            try {
                // Store message in database
                const newMessage = new Message({
                    from: socket.uniqueId,
                    to: message.to || Array.from(activeRooms.get(socket.currentRoom).users).find(id => id !== socket.uniqueId),
                    content: message,
                    isRead: false
                });
                await newMessage.save();

                // Get sender's name for notification
                const sender = await User.findOne({ uniqueId: socket.uniqueId });
                
                // Broadcast the message to all users in the room except the sender
                socket.broadcast.to(socket.currentRoom).emit('message', message);
                
                // Send notification about new message
                socket.broadcast.to(socket.currentRoom).emit('newMessage', {
                    from: socket.uniqueId,
                    senderName: sender.name,
                    message: message
                });
            } catch (error) {
                console.error('Error handling message:', error);
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

                // Get messages between the two users
                const messages = await Message.find({
                    $or: [
                        { from: socket.uniqueId, to: friendId },
                        { from: friendId, to: socket.uniqueId }
                    ]
                }).sort('timestamp');

                socket.emit('previousMessages', messages);
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
            const { target } = data;
            const targetSockets = userSockets.get(target);
            
            if (targetSockets) {
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('callEnded');
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