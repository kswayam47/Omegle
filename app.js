const express = require("express")
const app = express();
const indexrouter = require("./routes/index");
const path = require("path");
const http = require("http")
const server = http.createServer(app);
const socketIO = require("socket.io");
const io = socketIO(server);
const PRIVATE_ROOM_ID = 'rkgjtnnigot';
const PRIVATE_ROOM_PIN = '1234'; // You should change this to your desired PIN
let waitingusers = [];
let activeRooms = {}; // Track active rooms and their participants

io.on("connection", function(socket) {
    socket.on("joinPrivateRoom", function(data) {
        const { pin } = data;
        
        if (pin !== PRIVATE_ROOM_PIN) {
            socket.emit("wrongPin", {
                message: "Incorrect PIN for private room"
            });
            return;
        }

        // Leave any existing rooms first
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
            }
        });

        // Remove from any active rooms
        for (let roomId in activeRooms) {
            const index = activeRooms[roomId].indexOf(socket.id);
            if (index !== -1) {
                activeRooms[roomId].splice(index, 1);
                if (activeRooms[roomId].length === 0) {
                    delete activeRooms[roomId];
                }
            }
        }

        // Remove from waiting users
        waitingusers = waitingusers.filter(user => user.id !== socket.id);

        // Join or create private room
        if (!activeRooms[PRIVATE_ROOM_ID]) {
            activeRooms[PRIVATE_ROOM_ID] = [socket.id];
            socket.join(PRIVATE_ROOM_ID);
            socket.emit("waitingForPartner", {
                roomId: PRIVATE_ROOM_ID,
                message: "Waiting for someone to join the private room..."
            });
        } else if (activeRooms[PRIVATE_ROOM_ID].length < 2) {
            socket.join(PRIVATE_ROOM_ID);
            activeRooms[PRIVATE_ROOM_ID].push(socket.id);
            
            // Notify all users in the room
            io.to(PRIVATE_ROOM_ID).emit("privateRoomJoined", {
                title: "Private Chat Started",
                message: "A new user has joined the private chat room",
                participants: activeRooms[PRIVATE_ROOM_ID].length,
                roomId: PRIVATE_ROOM_ID
            });

            // Initialize the connection between peers
            io.to(PRIVATE_ROOM_ID).emit("joined", PRIVATE_ROOM_ID);
        } else {
            socket.emit("roomFull", {
                message: "Private room is currently full. Please try again later."
            });
        }
    });

    socket.on("joinroom", function(customRoomId = null) {
        // Don't allow joining regular rooms if user is in private room
        if (socket.rooms.has(PRIVATE_ROOM_ID)) {
            return;
        }

        // Remove user from any existing room first
        for (let roomId in activeRooms) {
            const index = activeRooms[roomId].indexOf(socket.id);
            if (index !== -1) {
                activeRooms[roomId].splice(index, 1);
                if (activeRooms[roomId].length === 0) {
                    delete activeRooms[roomId];
                }
            }
        }

        if (customRoomId) {
            // Don't allow joining the private room ID through this method
            if (customRoomId === PRIVATE_ROOM_ID) {
                socket.emit("error", {
                    message: "Please use the private room join button to access this room"
                });
                return;
            }

            if (activeRooms[customRoomId] && activeRooms[customRoomId].length < 2) {
                socket.join(customRoomId);
                activeRooms[customRoomId].push(socket.id);
                if (activeRooms[customRoomId].length === 2) {
                    io.to(customRoomId).emit("joined", customRoomId);
                }
            } else if (!activeRooms[customRoomId]) {
                socket.join(customRoomId);
                activeRooms[customRoomId] = [socket.id];
                socket.emit("waitingForPartner", customRoomId);
            } else {
                socket.emit("roomFull");
            }
            return;
        }

        // Handle random room joining
        if (waitingusers.length > 0) {
            const partner = waitingusers.shift();
            const roomId = Math.random().toString(36).substring(7);
            
            socket.join(roomId);
            partner.join(roomId);
            
            activeRooms[roomId] = [socket.id, partner.id];
            io.to(roomId).emit("joined", roomId);
        } else {
            waitingusers.push(socket);
            socket.emit("waitingForPartner");
        }
    });

    socket.on("disconnect", function() {
        // Remove from waiting list
        waitingusers = waitingusers.filter(user => user.id !== socket.id);

        // Remove from active rooms and notify remaining users
        for (let roomId in activeRooms) {
            const index = activeRooms[roomId].indexOf(socket.id);
            if (index !== -1) {
                activeRooms[roomId].splice(index, 1);
                if (activeRooms[roomId].length === 0) {
                    delete activeRooms[roomId];
                } else {
                    // Notify remaining users about disconnection
                    io.to(roomId).emit("partnerDisconnected");
                }
            }
        }
    });

    socket.on("message",function(data){
        socket.broadcast.to(data.room).emit("message",data.message);
    })

    socket.on("signalingMessage",function(data){
        socket.broadcast.to(data.room).emit("signalingMessage",data.message);
    });
    socket.on("startVideoCall",function({room}){
        socket.broadcast.to(room).emit("incomingCall");
        socket.emit("callInitiated");
    })
    socket.on("acceptCall",function(room){
        socket.broadcast.to(room).emit("callAccepted")

    })
    socket.on("rejectCall",function({room}){
        socket.broadcast.to(room).emit("callRejected")
    })
})

app.set("view engine","ejs");
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));

app.use("/",indexrouter);

server.listen(3000);