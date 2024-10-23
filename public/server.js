// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for rooms and their cards
const rooms = new Map();

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            cards: [],
            participants: new Set()
        });
    }
    return rooms.get(roomId);
}

io.on('connection', (socket) => {
    console.log('Client connected');
    let currentRoom = null;
    let currentUser = null;

    // Join room handler
    socket.on('joinRetro', ({ room, name }) => {
        console.log(`${name} joining room ${room}`);
        currentRoom = room;
        currentUser = name;
        socket.join(room);

        const roomData = getRoom(room);
        roomData.participants.add(name);

        // Send existing cards to the new participant
        socket.emit('loadCards', { cards: roomData.cards });
        
        // Notify others
        io.to(room).emit('participantJoined', { name });
        io.to(room).emit('updateParticipants', {
            participants: Array.from(roomData.participants)
        });

        console.log(`Room ${room} now has ${roomData.cards.length} cards`);
    });

    // Add card handler
    socket.on('addCard', ({ room, card }) => {
        console.log(`Adding card to room ${room}`);
        const roomData = getRoom(room);
        roomData.cards.push({
            ...card,
            isSubmitted: false
        });

        io.to(room).emit('loadCards', { cards: roomData.cards });
        console.log(`Room ${room} now has ${roomData.cards.length} cards`);
    });

    // Submit card handler
    socket.on('submitCard', ({ room, cardId, content }) => {
        console.log(`Submitting card ${cardId} in room ${room}`);
        const roomData = getRoom(room);
        const card = roomData.cards.find(c => c.id === cardId);
        
        if (card) {
            card.content = content;
            card.isSubmitted = true;
            io.to(room).emit('loadCards', { cards: roomData.cards });
        }
    });

    // Delete card handler
    socket.on('deleteCard', ({ room, cardId }) => {
        console.log(`Deleting card ${cardId} from room ${room}`);
        const roomData = getRoom(room);
        roomData.cards = roomData.cards.filter(card => card.id !== cardId);
        io.to(room).emit('loadCards', { cards: roomData.cards });
    });

    // Vote card handler
    socket.on('voteCard', ({ room, cardId, voter }) => {
        const roomData = getRoom(room);
        const card = roomData.cards.find(c => c.id === cardId);
        
        if (card) {
            if (!card.voters) {
                card.voters = new Set();
                card.votes = 0;
            }

            if (card.voters.has(voter)) {
                card.voters.delete(voter);
                card.votes--;
            } else {
                card.voters.add(voter);
                card.votes++;
            }

            // Convert Set to Array for sending over socket
            const cardsWithArrayVoters = roomData.cards.map(c => ({
                ...c,
                voters: c.voters ? Array.from(c.voters) : []
            }));

            io.to(room).emit('loadCards', { cards: cardsWithArrayVoters });
        }
    });

    // Move card handler
    socket.on('moveCard', ({ room, cardId, newColumn }) => {
        const roomData = getRoom(room);
        const card = roomData.cards.find(c => c.id === cardId);
        
        if (card) {
            card.column = newColumn;
            io.to(room).emit('loadCards', { cards: roomData.cards });
        }
    });

    // Reset room handler
    socket.on('resetRetro', ({ room }) => {
        console.log(`Resetting room ${room}`);
        const roomData = getRoom(room);
        roomData.cards = [];
        io.to(room).emit('loadCards', { cards: [] });
    });

    // Group similar cards handler
    socket.on('groupSimilarCards', ({ room }) => {
        const roomData = getRoom(room);
        // Group logic here if needed
        io.to(room).emit('loadCards', { cards: roomData.cards });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        if (currentRoom && currentUser) {
            const roomData = getRoom(currentRoom);
            roomData.participants.delete(currentUser);
            
            io.to(currentRoom).emit('participantLeft', { name: currentUser });
            io.to(currentRoom).emit('updateParticipants', {
                participants: Array.from(roomData.participants)
            });
        }
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});