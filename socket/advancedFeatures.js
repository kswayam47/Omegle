const Profile = require('../models/Profile');

function initAdvancedFeatures(io) {
    const typingUsers = new Map(); // Track typing status
    const voiceMessages = new Map(); // Store temporary voice messages

    io.on('connection', (socket) => {
        // Update user status when connected
        if (socket.userId) {
            Profile.findOneAndUpdate(
                { userId: socket.userId },
                { status: 'online', lastSeen: new Date() },
                { upsert: true }
            ).catch(console.error);
        }

        // Handle typing indicators
        socket.on('typing_start', (data) => {
            const { roomId } = data;
            if (!typingUsers.has(roomId)) {
                typingUsers.set(roomId, new Set());
            }
            typingUsers.get(roomId).add(socket.userName);
            socket.to(roomId).emit('user_typing', {
                users: Array.from(typingUsers.get(roomId))
            });
        });

        socket.on('typing_end', (data) => {
            const { roomId } = data;
            if (typingUsers.has(roomId)) {
                typingUsers.get(roomId).delete(socket.userName);
                socket.to(roomId).emit('user_typing', {
                    users: Array.from(typingUsers.get(roomId))
                });
            }
        });

        // Handle voice messages
        socket.on('voice_message', (data) => {
            const { roomId, audioBlob } = data;
            // Store voice message temporarily
            if (!voiceMessages.has(roomId)) {
                voiceMessages.set(roomId, []);
            }
            voiceMessages.get(roomId).push({
                from: socket.userName,
                audioBlob,
                timestamp: new Date()
            });
            
            // Emit to room
            socket.to(roomId).emit('new_voice_message', {
                from: socket.userName,
                audioBlob,
                timestamp: new Date()
            });
        });

        // Handle read receipts
        socket.on('message_read', async (data) => {
            const { messageId, roomId } = data;
            socket.to(roomId).emit('receipt_updated', {
                messageId,
                readBy: socket.userName,
                timestamp: new Date()
            });
        });

        // Clean up on disconnect
        socket.on('disconnect', async () => {
            if (socket.userId) {
                await Profile.findOneAndUpdate(
                    { userId: socket.userId },
                    { status: 'offline', lastSeen: new Date() }
                ).catch(console.error);
            }

            // Clean up typing indicators
            for (const [roomId, users] of typingUsers.entries()) {
                if (users.has(socket.userName)) {
                    users.delete(socket.userName);
                    socket.to(roomId).emit('user_typing', {
                        users: Array.from(users)
                    });
                }
            }
        });
    });
}

module.exports = initAdvancedFeatures;
