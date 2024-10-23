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

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Data structure to store retro rooms and their data
const retroRooms = new Map();

// Helper function to get or create room data
function getOrCreateRoom(roomId) {
    if (!retroRooms.has(roomId)) {
        retroRooms.set(roomId, {
            cards: [],
            participants: new Set(),
            lastActivity: Date.now()
        });
    }
    return retroRooms.get(roomId);
}

// Handle socket connections
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

        // Notify all participants about the new joiner
        io.to(room).emit('participantJoined', { name });
        io.to(room).emit('updateParticipants', {
            participants: Array.from(roomData.participants)
        });

        console.log(`${name} joined room ${room}`);
    });

    socket.on('addCard', ({ room, card }) => {
        const roomData = getOrCreateRoom(room);
        card.isSubmitted = false;
        roomData.cards.push(card);
        roomData.lastActivity = Date.now();
        
        io.to(room).emit('updateCards', { 
            cards: roomData.cards 
        });

        console.log(`Card added in room ${room}`);
    });

    socket.on('submitCard', ({ room, cardId, content }) => {
        const roomData = getOrCreateRoom(room);
        const card = roomData.cards.find(c => c.id === cardId);
        
        if (card) {
            card.content = content;
            card.isSubmitted = true;
            roomData.lastActivity = Date.now();
            
            io.to(room).emit('updateCards', { 
                cards: roomData.cards 
            });

            console.log(`Card ${cardId} submitted in room ${room}`);
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

        console.log(`Card ${cardId} deleted from room ${room}`);
    });

    socket.on('voteCard', ({ room, cardId, voter }) => {
        const roomData = getOrCreateRoom(room);
        const card = roomData.cards.find(c => c.id === cardId);
        
        if (card && card.isSubmitted) {
            if (!card.voters) card.voters = [];
            const voterIndex = card.voters.indexOf(voter);
            
            if (voterIndex === -1) {
                card.voters.push(voter);
                card.votes = (card.votes || 0) + 1;
            } else {
                card.voters.splice(voterIndex, 1);
                card.votes = (card.votes || 1) - 1;
            }
            
            roomData.lastActivity = Date.now();
            
            io.to(room).emit('updateCards', { 
                cards: roomData.cards 
            });

            console.log(`Vote updated for card ${cardId} in room ${room}`);
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

            console.log(`Card ${cardId} moved to ${newColumn} in room ${room}`);
        }
    });

    socket.on('resetRetro', ({ room }) => {
        const roomData = getOrCreateRoom(room);
        roomData.cards = [];
        roomData.lastActivity = Date.now();
        
        io.to(room).emit('retroReset');
        io.to(room).emit('updateCards', { 
            cards: [] 
        });

        console.log(`Room ${room} reset`);
    });

    socket.on('groupSimilarCards', ({ room }) => {
        const roomData = getOrCreateRoom(room);
        const cards = roomData.cards;
        
        // Simple text similarity function
        const similarity = (text1, text2) => {
            if (!text1 || !text2) return 0;
            const words1 = text1.toLowerCase().split(/\s+/);
            const words2 = text2.toLowerCase().split(/\s+/);
            const commonWords = words1.filter(word => words2.includes(word));
            return commonWords.length / Math.max(words1.length, words2.length);
        };

        // Group similar cards
        const processedCards = new Set();
        const similarityThreshold = 0.3;

        cards.forEach((card1, i) => {
            if (processedCards.has(card1.id) || !card1.isSubmitted) return;

            const similarCards = cards.filter((card2, j) => {
                if (i === j || processedCards.has(card2.id) || !card2.isSubmitted) return false;
                if (card2.column !== card1.column) return false;
                return similarity(card1.content, card2.content) > similarityThreshold;
            });

            if (similarCards.length > 0) {
                card1.groupedCards = similarCards.map(card => ({
                    content: card.content,
                    author: card.author
                }));

                // Remove grouped cards and mark as processed
                similarCards.forEach(card => {
                    processedCards.add(card.id);
                    roomData.cards = roomData.cards.filter(c => c.id !== card.id);
                });
                processedCards.add(card1.id);
            }
        });

        roomData.lastActivity = Date.now();
        io.to(room).emit('updateCards', { 
            cards: roomData.cards 
        });

        console.log(`Cards grouped in room ${room}`);
    });

    socket.on('disconnect', () => {
        if (currentRoom && currentUser) {
            const roomData = retroRooms.get(currentRoom);
            if (roomData) {
                roomData.participants.delete(currentUser);
                
                io.to(currentRoom).emit('participantLeft', { 
                    name: currentUser 
                });
                io.to(currentRoom).emit('updateParticipants', {
                    participants: Array.from(roomData.participants)
                });

                // If room is empty, mark last activity time
                if (roomData.participants.size === 0) {
                    roomData.lastActivity = Date.now();
                }
            }
        }
        console.log('Client disconnected');
    });
});

// Cleanup inactive rooms periodically
setInterval(() => {
    const now = Date.now();
    for (const [roomId, roomData] of retroRooms.entries()) {
        // Remove rooms that have been inactive for more than 24 hours
        const inactiveTime = now - roomData.lastActivity;
        if (inactiveTime > 24 * 60 * 60 * 1000 && roomData.participants.size === 0) {
            retroRooms.delete(roomId);
            console.log(`Removed inactive room ${roomId}`);
        }
    }
}, 60 * 60 * 1000); // Check every hour

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});