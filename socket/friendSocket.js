const User = require('../models/User');
const Relation = require('../models/Relation');

function initFriendSocket(io) {
    // Track online users by uniqueId
    const onlineUsers = new Set();
    // Track socket IDs for each user
    const userSockets = new Map(); // uniqueId -> Set of socket IDs

    io.on('connection', async (socket) => {
        console.log('Friend socket connected:', socket.id);

        // Handle user coming online
        socket.on('userOnline', async (data) => {
            try {
                const { uniqueId } = data;
                console.log('User coming online:', uniqueId);
                
                socket.uniqueId = uniqueId;
                onlineUsers.add(uniqueId);

                // Track this socket for the user
                if (!userSockets.has(uniqueId)) {
                    userSockets.set(uniqueId, new Set());
                }
                userSockets.get(uniqueId).add(socket.id);
                
                // Only broadcast if this is the first socket for this user
                if (userSockets.get(uniqueId).size === 1) {
                    // Tell everyone this user is online
                    io.emit('friendStatus', {
                        friendId: uniqueId,
                        isOnline: true
                    });

                    console.log('Broadcasting online status for new connection:', {
                        user: uniqueId,
                        socketCount: userSockets.get(uniqueId).size
                    });
                }

                // Send this user the status of all online users
                onlineUsers.forEach(onlineUserId => {
                    if (onlineUserId !== uniqueId) {
                        socket.emit('friendStatus', {
                            friendId: onlineUserId,
                            isOnline: true
                        });
                    }
                });

            } catch (error) {
                console.error('User online error:', error);
            }
        });

        // Handle private messages
        socket.on('privateMessage', async (data) => {
            try {
                const { roomId, message } = data;
                console.log('Private message:', {
                    from: socket.uniqueId,
                    roomId,
                    message
                });
                
                io.to(roomId).emit('privateMessage', {
                    userId: socket.uniqueId,
                    message
                });
            } catch (error) {
                console.error('Private message error:', error);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // Join private room
        socket.on('joinPrivateRoom', async (data) => {
            try {
                const { friendId } = data;
                const roomId = [socket.uniqueId, friendId].sort().join('-');
                socket.join(roomId);
                console.log('User joined room:', {
                    user: socket.uniqueId,
                    friend: friendId,
                    roomId
                });
                socket.emit('userJoinedRoom', { roomId });
            } catch (error) {
                console.error('Join private room error:', error);
                socket.emit('error', { message: 'Failed to join private room' });
            }
        });

        // Video call signaling
        socket.on('videoOffer', (data) => {
            const { target, sdp } = data;
            console.log('Video offer from', socket.uniqueId, 'to', target);
            
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
            console.log('Video answer from', socket.uniqueId, 'to', target);
            
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
            console.log('ICE candidate from', socket.uniqueId, 'to', target);
            
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

        // Handle disconnection
        socket.on('disconnect', () => {
            if (socket.uniqueId) {
                // Remove this socket from user's socket list
                const userSocketSet = userSockets.get(socket.uniqueId);
                if (userSocketSet) {
                    userSocketSet.delete(socket.id);
                    console.log('Socket disconnected for user:', {
                        user: socket.uniqueId,
                        remainingSockets: userSocketSet.size
                    });

                    // Only if this was the last socket for this user
                    if (userSocketSet.size === 0) {
                        onlineUsers.delete(socket.uniqueId);
                        userSockets.delete(socket.uniqueId);
                        
                        // Tell everyone this user is offline
                        io.emit('friendStatus', {
                            friendId: socket.uniqueId,
                            isOnline: false
                        });

                        console.log('User fully disconnected:', {
                            user: socket.uniqueId,
                            onlineUsers: Array.from(onlineUsers)
                        });
                    }
                }
            }
        });
    });
}

module.exports = initFriendSocket;
