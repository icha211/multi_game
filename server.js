const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

const rooms = new Map();

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getRoom(roomCode) {
  if (!rooms.has(roomCode)) return null;
  return rooms.get(roomCode);
}

function setHost(room, socketId) {
  room.hostId = socketId;
}

function getRoomState(room) {
  return {
    roomCode: room.code,
    hostId: room.hostId,
    players: room.players,
    names: room.names
  };
}

io.on("connection", (socket) => {
  socket.on("createOrJoin", ({ roomCode, role, name }) => {
    let code = (roomCode || "").trim().toUpperCase();
    if (!code) code = generateRoomCode();

    let room = getRoom(code);
    if (!room) {
      room = {
        code,
        hostId: socket.id,
        seed: Math.floor(Math.random() * 2 ** 31),
        players: { p1: null, p2: null },
        names: {}
      };
      rooms.set(code, room);
    }

    const desiredRole = role === "p2" ? "p2" : "p1";
    if (room.players[desiredRole] && room.players[desiredRole] !== socket.id) {
      socket.emit("joinError", "Role already taken. Choose the other player.");
      return;
    }

    if (!room.players.p1 || room.players.p1 === socket.id) {
      // ok
    }
    if (!room.players.p2 || room.players.p2 === socket.id) {
      // ok
    }

    room.players[desiredRole] = socket.id;
    room.names[socket.id] = name || "Player";

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = desiredRole;

    if (!room.hostId || room.hostId === socket.id) {
      setHost(room, socket.id);
    }

    socket.emit("roomJoined", {
      roomCode: code,
      role: desiredRole,
      isHost: room.hostId === socket.id,
      seed: room.seed
    });

    io.to(code).emit("roomState", getRoomState(room));
  });

  socket.on("cmd", ({ roomCode, name, payload }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    io.to(roomCode).emit("cmd", { name, payload });
  });

  socket.on("action", ({ roomCode, game, payload }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    io.to(roomCode).emit("action", { game, payload });
  });

  socket.on("updateName", ({ roomCode, name }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    const cleanName = (name || "").trim() || "Player";
    room.names[socket.id] = cleanName;
    io.to(roomCode).emit("roomState", getRoomState(room));
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;

    if (room.players.p1 === socket.id) room.players.p1 = null;
    if (room.players.p2 === socket.id) room.players.p2 = null;
    delete room.names[socket.id];

    if (room.hostId === socket.id) {
      const newHost = room.players.p1 || room.players.p2 || null;
      room.hostId = newHost;
    }

    if (!room.players.p1 && !room.players.p2) {
      rooms.delete(roomCode);
      return;
    }

    io.to(roomCode).emit("roomState", getRoomState(room));
  });
});

server.listen(PORT, () => {
  console.log(`Multiplayer server running on http://localhost:${PORT}`);
});
