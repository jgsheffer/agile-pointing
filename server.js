const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const sessions = new Map();

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('joinRoom', ({ room, name, avatar, sessionId }) => {
    let userSessionId = sessionId;
    if (!userSessionId || !sessions.has(userSessionId)) {
      userSessionId = uuidv4();
    }
    
    sessions.set(userSessionId, { room, name, avatar });
    socket.join(room);
    
    if (!rooms.has(room)) {
      rooms.set(room, new Map());
    }
    rooms.get(room).set(userSessionId, { name, avatar, vote: null });
    
    socket.emit('sessionCreated', userSessionId);
    io.to(room).emit('updateParticipants', Array.from(rooms.get(room).values()));
  });

  socket.on('vote', ({ room, vote, sessionId }) => {
    if (rooms.has(room) && rooms.get(room).has(sessionId)) {
      rooms.get(room).get(sessionId).vote = vote;
      io.to(room).emit('updateVotes', Array.from(rooms.get(room).values()));
    }
  });

  socket.on('revealVotes', (room) => {
    io.to(room).emit('votesRevealed', Array.from(rooms.get(room).values()));
  });

  socket.on('resetVotes', (room) => {
    if (rooms.has(room)) {
      for (let participant of rooms.get(room).values()) {
        participant.vote = null;
      }
      io.to(room).emit('votesReset', Array.from(rooms.get(room).values()));
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    sessions.forEach((session, sessionId) => {
      const room = session.room;
      if (rooms.has(room) && rooms.get(room).has(sessionId)) {
        rooms.get(room).delete(sessionId);
        io.to(room).emit('updateParticipants', Array.from(rooms.get(room).values()));
        if (rooms.get(room).size === 0) {
          rooms.delete(room);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));