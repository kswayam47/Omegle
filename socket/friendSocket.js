const User = require('../models/User');
const Relation = require('../models/Relation');

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

            // Broadcast online status
            io.emit('friendStatus', {
                friendId: uniqueId,
                isOnline: true
            });
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

        // Handle private messages
        socket.on('privateMessage', (data) => {
            const { roomId, message } = data;
            if (!roomId || !message) return;

            const room = activeRooms.get(roomId);
            if (!room) return;

            room.messages.push({
                userId: socket.uniqueId,
                message,
                timestamp: Date.now()
            });

            // Send to all OTHER sockets in the room
            socket.broadcast.to(roomId).emit('privateMessage', {
                userId: socket.uniqueId,
                message
            });
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