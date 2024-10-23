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

app.use(express.static(path.join(__dirname, 'public')));

// Store for retro data
const retroRooms = new Map();

// Debug logging function
function logRoomState(roomId, action) {
    const room = retroRooms.get(roomId);
    console.log(`[${action}] Room ${roomId}:`, {
        participants: room ? Array.from(room.participants) : [],
        cardCount: room ? room.cards.length : 0
    });
}

function getOrCreateRoom(roomId) {
    if (!retroRooms.has(roomId)) {
        retroRooms.set(roomId, {
            cards: [], // Array to store cards
            participants: new Set(),
            lastActivity: Date.now()
        });
        console.log(`Created new room: ${roomId}`);
    }
    return retroRooms.get(roomId);
}

io.on('connection', (socket) => {
    console.log('New client connected');
    let currentRoom = null;
    let currentUser = null;

    socket.on('joinRetro', ({ room, name }) => {
        currentRoom = room;
        currentUser = name;
        socket.join(room);

        const roomData = getOrCreateRoom(room);
        roomData.participants.add(name);
        roomData.lastActivity = Date.now();

        // Send existing cards to the new participant
        socket.emit('updateCards', { 
            cards: roomData.cards
        });

        io.to(room).emit('participantJoined', { name });
        io.to(room).emit('updateParticipants', {
            participants: Array.from(roomData.participants)
        });

        logRoomState(room, 'join');
    });

    socket.on('addCard', ({ room, card }) => {
        const roomData = getOrCreateRoom(room);
        card.isSubmitted = false;
        roomData.cards.push(card);
        roomData.lastActivity = Date.now();

        io.to(room).emit('updateCards', { 
            cards: roomData.cards 
        });

        logRoomState(room, 'addCard');
    });

    socket.on('submitCard', ({ room, cardId, content }) => {
        const roomData = getOrCreateRoom(room);
        const cardIndex = roomData.cards.findIndex(c => c.id === cardId);
        
        if (cardIndex !== -1) {
            roomData.cards[cardIndex] = {
                ...roomData.cards[cardIndex],
                content: content,
                isSubmitted: true
            };
            roomData.lastActivity = Date.now();
            
            io.to(room).emit('updateCards', { 
                cards: roomData.cards 
            });

            logRoomState(room, 'submitCard');
        }
    });

    socket.on('updateCard', ({ room, cardId, content }) => {
        const roomData = getOrCreateRoom(room);
        const card = roomData.cards.find(c => c.id === cardId);
        
        if (card && !card.isSubmitted) {
            card.content = content;
            roomData.lastActivity = Date.now();
            
            io.to(room).emit('updateCards', { 
                cards: roomData.cards 
            });
        }
    });

    socket.on('deleteCard', ({ room, cardId }) => {
        const roomData = getOrCreateRoom(room);
        roomData.cards = roomData.cards.filter(card => card.id !== cardId);
        roomData.lastActivity = Date.now();

        io.to(room).emit('updateCards', { 
            cards: roomData.cards 
        });

        logRoomState(room, 'deleteCard');
    });

    socket.on('voteCard', ({ room, cardId, voter }) => {
        const roomData = getOrCreateRoom(room);
        const card = roomData.cards.find(c => c.id === cardId);
        
        if (card && card.isSubmitted) {
            if (!card.voters) card.voters = new Set();
            
            if (card.voters.has(voter)) {
                card.voters.delete(voter);
                card.votes = (card.votes || 1) - 1;
            } else {
                card.voters.add(voter);
                card.votes = (card.votes || 0) + 1;
            }
            
            roomData.lastActivity = Date.now();

            // Convert Set to Array for sending over socket
            const cardsToSend = roomData.cards.map(c => ({
                ...c,
                voters: c.voters ? Array.from(c.voters) : []
            }));
            
            io.to(room).emit('updateCards', { 
                cards: cardsToSend 
            });
        }
    });

    socket.on('moveCard', ({ room, cardId, newColumn }) => {
        const roomData = getOrCreateRoom(room);
        const card = roomData.cards.find(c => c.id === cardId);
        
        if (card && card.isSubmitted) {
            card.column = newColumn;
            roomData.lastActivity = Date.now();
            
            io.to(room).emit('updateCards', { 
                cards: roomData.cards 
            });
        }
    });

    socket.on('resetRetro', ({ room }) => {
        const roomData = getOrCreateRoom(room);
        roomData.cards = [];
        roomData.lastActivity = Date.now();
        
        io.to(room).emit('retroReset');
        io.to(room).emit('updateCards', { cards: [] });

        logRoomState(room, 'reset');
    });

    socket.on('groupSimilarCards', ({ room }) => {
        const roomData = getOrCreateRoom(room);
        
        // Process each column separately
        const columns = ['went-well', 'improve', 'action-items'];
        columns.forEach(column => {
            const columnCards = roomData.cards.filter(card => 
                card.column === column && card.isSubmitted
            );

            // Group similar cards
            columnCards.forEach((card, i) => {
                if (card.grouped) return; // Skip already grouped cards

                const similar = columnCards.filter((other, j) => {
                    if (i === j || other.grouped) return false;
                    
                    const similarity = calculateSimilarity(card.content, other.content);
                    return similarity > 0.3; // Adjust threshold as needed
                });

                if (similar.length > 0) {
                    card.groupedCards = similar.map(s => ({
                        content: s.content,
                        author: s.author
                    }));
                    
                    // Mark similar cards for removal
                    similar.forEach(s => {
                        s.grouped = true;
                    });
                }
            });

            // Remove grouped cards
            roomData.cards = roomData.cards.filter(card => !card.grouped);
        });

        roomData.lastActivity = Date.now();
        io.to(room).emit('updateCards', { cards: roomData.cards });
    });

    socket.on('requestUpdate', ({ room }) => {
        const roomData = getOrCreateRoom(room);
        socket.emit('updateCards', { 
            cards: roomData.cards 
        });
    });

    socket.on('disconnect', () => {
        if (currentRoom && currentUser) {
            const roomData = retroRooms.get(currentRoom);
            if (roomData) {
                roomData.participants.delete(currentUser);
                
                io.to(currentRoom).emit('participantLeft', { name: currentUser });
                io.to(currentRoom).emit('updateParticipants', {
                    participants: Array.from(roomData.participants)
                });

                logRoomState(currentRoom, 'disconnect');
            }
        }
        console.log('Client disconnected');
    });
});

function calculateSimilarity(text1, text2) {
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);
    const common = words1.filter(word => words2.includes(word));
    return common.length / Math.max(words1.length, words2.length);
}

// Cleanup inactive rooms periodically (every hour)
setInterval(() => {
    const now = Date.now();
    for (const [roomId, roomData] of retroRooms.entries()) {
        // Remove rooms that have been inactive for more than 24 hours and have no participants
        if (roomData.participants.size === 0 && 
            now - roomData.lastActivity > 24 * 60 * 60 * 1000) {
            retroRooms.delete(roomId);
            console.log(`Cleaned up inactive room: ${roomId}`);
        }
    }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});