const express = require("express")
const app = express();
const indexrouter = require("./routes/index");
const path = require("path");
const http = require("http")
const server = http.createServer(app);
const socketIO = require("socket.io");
const io = socketIO(server);
let waitingusers = [];
let activeRooms = {}; // Track active rooms and their participants

io.on("connection", function(socket) {
    socket.on("joinroom", function(customRoomId = null) {
        // Remove user from any existing room first
        for (let roomId in activeRooms) {
            if (activeRooms[roomId].includes(socket.id)) {
                delete activeRooms[roomId];
            }
        }

        // If custom room ID is provided, try to join that room
        if (customRoomId) {
            if (activeRooms[customRoomId] && activeRooms[customRoomId].length < 2) {
                // Join existing room
                socket.join(customRoomId);
                activeRooms[customRoomId].push(socket.id);
                io.to(customRoomId).emit("joined", customRoomId);
            } else if (!activeRooms[customRoomId]) {
                // Create new room with custom ID
                socket.join(customRoomId);
                activeRooms[customRoomId] = [socket.id];
                socket.emit("waitingForPartner", customRoomId);
            } else {
                socket.emit("roomFull");
            }
            return;
        }

        // Remove disconnected users from waiting list
        waitingusers = waitingusers.filter(user => user.connected);

        if (waitingusers.length > 0) {
            let partner = waitingusers.shift();
            const roomname = `${socket.id}-${partner.id}`;
            socket.join(roomname);
            partner.join(roomname);
            
            // Store room participants
            activeRooms[roomname] = [socket.id, partner.id];
            
            io.to(roomname).emit("joined", roomname);
            console.log("both connected in room:", roomname);
        } else {
            waitingusers.push(socket);
            console.log("user waiting:", socket.id);
        }
    });

    socket.on("disconnect", function() {
        // Remove from waiting list
        waitingusers = waitingusers.filter(user => user.id !== socket.id);

        // Find and handle disconnection from active room
        for (let roomId in activeRooms) {
            if (activeRooms[roomId].includes(socket.id)) {
                const otherUser = activeRooms[roomId].find(id => id !== socket.id);
                if (otherUser) {
                    // Notify other user about disconnection
                    io.to(otherUser).emit("partnerDisconnected");
                }
                // Delete the room entirely
                delete activeRooms[roomId];
                
                // Force both users to leave the room
                if (otherUser) {
                    const otherSocket = io.sockets.sockets.get(otherUser);
                    if (otherSocket) {
                        otherSocket.leave(roomId);
                    }
                }
                socket.leave(roomId);
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