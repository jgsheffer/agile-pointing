// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// Storage for different game types
const pointingRooms = new Map();
const retroRooms = new Map();
const breakoutRooms = new Map(); // New storage for breakout games
const sessions = new Map();

// Breakout game constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PADDLE_WIDTH = 100;
const PADDLE_HEIGHT = 15;
const BALL_RADIUS = 8;
const BALL_SPEED = 4;
const BRICK_WIDTH = 75;
const BRICK_HEIGHT = 20;
const BRICK_ROWS = 8;
const BRICK_COLS = 10;
const BRICK_PADDING = 5;

// Player colors for breakout
const playerColors = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
  '#BB8FCE',
  '#85C1E9',
  '#F8C471',
  '#82E0AA',
  '#F1948A',
  '#85C1E9',
  '#D7BDE2',
];

// Brick colors by row
const brickColors = [
  '#FF6B6B',
  '#FF8E53',
  '#FF6B9D',
  '#C44569',
  '#F8B500',
  '#FFC048',
  '#FFD93D',
  '#6BCF7F',
];

// Initialize breakout room
function initializeBreakoutRoom(roomId) {
  const room = {
    players: new Map(),
    balls: [],
    bricks: [],
    gameRunning: false,
    gamePaused: false,
    score: 0,
    gameInterval: null,
  };

  // Create bricks
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      const brick = {
        x: col * (BRICK_WIDTH + BRICK_PADDING) + BRICK_PADDING,
        y: row * (BRICK_HEIGHT + BRICK_PADDING) + 50,
        destroyed: false,
        color: brickColors[row % brickColors.length],
        points: (BRICK_ROWS - row) * 10,
      };
      room.bricks.push(brick);
    }
  }
  breakoutRooms.set(roomId, room);
  return room;
}

// Create initial ball
function createBall() {
  return {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT - 100,
    dx: (Math.random() > 0.5 ? 1 : -1) * BALL_SPEED,
    dy: -BALL_SPEED,
  };
}

// Game physics update
function updateBreakoutGame(roomId) {
  const room = breakoutRooms.get(roomId);
  if (!room || !room.gameRunning || room.gamePaused) return;

  // Update balls
  room.balls.forEach((ball, ballIndex) => {
    // Move ball
    ball.x += ball.dx;
    ball.y += ball.dy;

    // Wall collisions
    if (ball.x <= BALL_RADIUS || ball.x >= CANVAS_WIDTH - BALL_RADIUS) {
      ball.dx = -ball.dx;
    }

    if (ball.y <= BALL_RADIUS) {
      ball.dy = -ball.dy;
    }

    // Ball falls below screen - remove it
    if (ball.y > CANVAS_HEIGHT + BALL_RADIUS) {
      room.balls.splice(ballIndex, 1);
      return;
    }

    // Paddle collisions
    room.players.forEach((player) => {
      const paddle = player.paddle;
      if (
        ball.x >= paddle.x &&
        ball.x <= paddle.x + PADDLE_WIDTH &&
        ball.y + BALL_RADIUS >= paddle.y &&
        ball.y - BALL_RADIUS <= paddle.y + PADDLE_HEIGHT &&
        ball.dy > 0
      ) {
        // Calculate bounce angle based on where ball hits paddle
        const hitPos = (ball.x - paddle.x) / PADDLE_WIDTH;
        const angle = ((hitPos - 0.5) * Math.PI) / 3; // Max 60 degree angle

        ball.dx = BALL_SPEED * Math.sin(angle);
        ball.dy = -BALL_SPEED * Math.cos(angle);

        // Ensure minimum upward velocity
        if (ball.dy > -2) ball.dy = -2;
      }
    });

    // Brick collisions
    room.bricks.forEach((brick) => {
      if (brick.destroyed) return;

      if (
        ball.x >= brick.x &&
        ball.x <= brick.x + BRICK_WIDTH &&
        ball.y >= brick.y &&
        ball.y <= brick.y + BRICK_HEIGHT
      ) {
        brick.destroyed = true;
        ball.dy = -ball.dy;

        // Add score
        room.score += brick.points;

        // Find which player gets credit (closest paddle)
        let closestPlayer = null;
        let closestDistance = Infinity;

        room.players.forEach((player) => {
          const distance = Math.abs(
            player.paddle.x + PADDLE_WIDTH / 2 - ball.x
          );
          if (distance < closestDistance) {
            closestDistance = distance;
            closestPlayer = player;
          }
        });

        if (closestPlayer) {
          closestPlayer.score += brick.points;
        }
      }
    });
  });

  // Check win condition
  const remainingBricks = room.bricks.filter((brick) => !brick.destroyed);
  if (remainingBricks.length === 0) {
    room.gameRunning = false;
    clearInterval(room.gameInterval);
    io.to(roomId).emit('gameWon');
  }

  // Check game over condition (no balls left)
  if (room.balls.length === 0) {
    room.gameRunning = false;
    clearInterval(room.gameInterval);
    io.to(roomId).emit('gameOver');
  }

  // Broadcast game state
  broadcastBreakoutGameState(roomId);
}

// Broadcast game state to all players in room
function broadcastBreakoutGameState(roomId) {
  const room = breakoutRooms.get(roomId);
  if (!room) return;

  const gameState = {
    players: Object.fromEntries(room.players),
    balls: room.balls,
    bricks: room.bricks,
    score: room.score,
    gameRunning: room.gameRunning,
    gamePaused: room.gamePaused,
  };

  io.to(roomId).emit('gameStateUpdate', gameState);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Existing agile pointing handlers...
  socket.on('joinRoom', (data) => {
    const { roomId, name } = data;
    socket.join(roomId);

    if (!pointingRooms.has(roomId)) {
      pointingRooms.set(roomId, new Map());
    }

    const room = pointingRooms.get(roomId);
    room.set(socket.id, { name, vote: null, hasVoted: false });

    io.to(roomId).emit('participantUpdate', Array.from(room.values()));
  });

  // Existing retro handlers...
  socket.on('joinRetro', (data) => {
    const { roomId, userName } = data;
    socket.join(roomId);

    if (!retroRooms.has(roomId)) {
      retroRooms.set(roomId, { cards: [], participants: new Set() });
    }

    const room = retroRooms.get(roomId);
    room.participants.add(userName);

    socket.emit('retroJoined', { cards: room.cards });
    io.to(roomId).emit('participantUpdate', Array.from(room.participants));
  });

  // NEW BREAKOUT GAME HANDLERS
  socket.on('joinBreakout', (data) => {
    const { roomId, playerName } = data;
    socket.join(roomId);

    // Initialize room if it doesn't exist
    if (!breakoutRooms.has(roomId)) {
      initializeBreakoutRoom(roomId);
    }

    const room = breakoutRooms.get(roomId);
    const playerId = socket.id;

    // Assign color to player
    const colorIndex = room.players.size % playerColors.length;
    const playerColor = playerColors[colorIndex];

    // Create player with paddle
    const player = {
      id: playerId,
      name: playerName,
      color: playerColor,
      score: 0,
      paddle: {
        x: CANVAS_WIDTH / 2 - PADDLE_WIDTH / 2,
        y: CANVAS_HEIGHT - 30 - room.players.size * 25, // Stack paddles
      },
    };

    room.players.set(playerId, player);

    // Send initial game state to new player
    const gameState = {
      players: Object.fromEntries(room.players),
      balls: room.balls,
      bricks: room.bricks,
      score: room.score,
      gameRunning: room.gameRunning,
      gamePaused: room.gamePaused,
    };

    socket.emit('playerJoined', { playerId, gameState });

    // Notify other players
    socket.to(roomId).emit('gameStateUpdate', gameState);
  });

  socket.on('startBreakout', (roomId) => {
    const room = breakoutRooms.get(roomId);
    if (!room || room.gameRunning) return;

    // Reset game state
    room.gameRunning = true;
    room.gamePaused = false;
    room.score = 0;
    room.balls = [createBall()];

    // Reset player scores
    room.players.forEach((player) => {
      player.score = 0;
    });

    // Reset bricks
    room.bricks.forEach((brick) => {
      brick.destroyed = false;
    });

    // Start game loop
    room.gameInterval = setInterval(() => {
      updateBreakoutGame(roomId);
    }, 1000 / 60); // 60 FPS

    io.to(roomId).emit('gameStarted');
    broadcastBreakoutGameState(roomId);
  });

  socket.on('resetBreakout', (roomId) => {
    const room = breakoutRooms.get(roomId);
    if (!room) return;

    // Stop game loop
    if (room.gameInterval) {
      clearInterval(room.gameInterval);
      room.gameInterval = null;
    }

    // Reset game state
    room.gameRunning = false;
    room.gamePaused = false;
    room.score = 0;
    room.balls = [];

    // Reset player scores
    room.players.forEach((player) => {
      player.score = 0;
    });

    // Reset bricks
    room.bricks.forEach((brick) => {
      brick.destroyed = false;
    });

    const gameState = {
      players: Object.fromEntries(room.players),
      balls: room.balls,
      bricks: room.bricks,
      score: room.score,
      gameRunning: room.gameRunning,
      gamePaused: room.gamePaused,
    };

    io.to(roomId).emit('gameReset', gameState);
  });

  socket.on('pauseBreakout', (roomId) => {
    const room = breakoutRooms.get(roomId);
    if (!room || !room.gameRunning) return;

    room.gamePaused = !room.gamePaused;
    io.to(roomId).emit('gamePaused', room.gamePaused);
  });

  socket.on('paddleMove', (data) => {
    const { roomId, playerId, x } = data;
    const room = breakoutRooms.get(roomId);

    if (room && room.players.has(playerId)) {
      const player = room.players.get(playerId);
      player.paddle.x = Math.max(0, Math.min(CANVAS_WIDTH - PADDLE_WIDTH, x));

      // Broadcast updated player position
      socket.to(roomId).emit('gameStateUpdate', {
        players: Object.fromEntries(room.players),
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Clean up from all room types
    pointingRooms.forEach((room, roomId) => {
      if (room.has(socket.id)) {
        room.delete(socket.id);
        io.to(roomId).emit('participantUpdate', Array.from(room.values()));
      }
    });

    retroRooms.forEach((room, roomId) => {
      // Handle retro cleanup if needed
    });

    breakoutRooms.forEach((room, roomId) => {
      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);

        // Stop game if no players left
        if (room.players.size === 0 && room.gameInterval) {
          clearInterval(room.gameInterval);
          room.gameInterval = null;
          room.gameRunning = false;
        }

        io.to(roomId).emit('playerLeft', { playerId: socket.id });
        broadcastBreakoutGameState(roomId);
      }
    });
  });

  // Existing socket handlers for agile pointing and retro...
  socket.on('vote', (data) => {
    const { roomId, vote } = data;
    const room = pointingRooms.get(roomId);

    if (room && room.has(socket.id)) {
      const participant = room.get(socket.id);
      participant.vote = vote;
      participant.hasVoted = true;

      io.to(roomId).emit('participantUpdate', Array.from(room.values()));
    }
  });

  socket.on('revealVotes', (roomId) => {
    io.to(roomId).emit('votesRevealed');
  });

  socket.on('resetVotes', (roomId) => {
    const room = pointingRooms.get(roomId);
    if (room) {
      room.forEach((participant) => {
        participant.vote = null;
        participant.hasVoted = false;
      });
      io.to(roomId).emit('participantUpdate', Array.from(room.values()));
    }
  });
  // Retro handlers
  socket.on('addCard', (data) => {
    const { roomId, card } = data;
    const room = retroRooms.get(roomId);

    if (room) {
      room.cards.push(card);
      io.to(roomId).emit('cardAdded', card);
    }
  });

  socket.on('submitCard', (data) => {
    const { roomId, cardId } = data;
    const room = retroRooms.get(roomId);

    if (room) {
      const card = room.cards.find((c) => c.id === cardId);
      if (card) {
        card.isSubmitted = true;
        io.to(roomId).emit('cardSubmitted', card);
      }
    }
  });

  socket.on('voteCard', (data) => {
    const { roomId, cardId, voter } = data;
    const room = retroRooms.get(roomId);

    if (room) {
      const card = room.cards.find((c) => c.id === cardId);
      if (card) {
        if (card.voters.includes(voter)) {
          card.voters = card.voters.filter((v) => v !== voter);
          card.votes--;
        } else {
          card.voters.push(voter);
          card.votes++;
        }
        io.to(roomId).emit('cardVoted', card);
      }
    }
  });

  socket.on('deleteCard', (data) => {
    const { roomId, cardId } = data;
    const room = retroRooms.get(roomId);

    if (room) {
      room.cards = room.cards.filter((c) => c.id !== cardId);
      io.to(roomId).emit('cardDeleted', cardId);
    }
  });

  socket.on('moveCard', (data) => {
    const { roomId, cardId, newColumn } = data;
    const room = retroRooms.get(roomId);

    if (room) {
      const card = room.cards.find((c) => c.id === cardId);
      if (card) {
        card.column = newColumn;
        io.to(roomId).emit('cardMoved', card);
      }
    }
  });
  socket.on('resetRetro', (roomId) => {
    const room = retroRooms.get(roomId);
    if (room) {
      room.cards = [];
      io.to(roomId).emit('retroReset');
    }
  });

  socket.on('groupSimilarCards', (data) => {
    const { roomId, cardIds } = data;
    const room = retroRooms.get(roomId);

    if (room && cardIds.length > 1) {
      const cards = room.cards.filter((c) => cardIds.includes(c.id));
      if (cards.length > 1) {
        const mainCard = cards[0];
        const groupedCards = cards.slice(1);

        mainCard.groupedCards = groupedCards.map((c) => ({
          content: c.content,
          author: c.author,
        }));

        room.cards = room.cards.filter((c) => !cardIds.slice(1).includes(c.id));
        io.to(roomId).emit('cardsGrouped', {
          mainCard,
          groupedCardIds: cardIds.slice(1),
        });
      }
    }
  });
});

// Cleanup function for old rooms
function cleanupRooms() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  // Clean up pointing rooms
  pointingRooms.forEach((room, roomId) => {
    if (room.size === 0) {
      pointingRooms.delete(roomId);
    }
  });

  // Clean up retro rooms
  retroRooms.forEach((room, roomId) => {
    if (room.participants.size === 0) {
      retroRooms.delete(roomId);
    }
  });

  // Clean up breakout rooms
  breakoutRooms.forEach((room, roomId) => {
    if (room.players.size === 0) {
      if (room.gameInterval) {
        clearInterval(room.gameInterval);
      }
      breakoutRooms.delete(roomId);
    }
  });

  // Clean up sessions
  sessions.forEach((session, sessionId) => {
    if (now - session.lastActivity > maxAge) {
      sessions.delete(sessionId);
    }
  });
}

// Run cleanup every hour
setInterval(cleanupRooms, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Agile Pointing: http://localhost:${PORT}`);
  console.log(`Retrospective: http://localhost:${PORT}/retro.html`);
  console.log(`Breakout Game: http://localhost:${PORT}/breakout.html`);
});

// Add near the top with other Express middleware
app.get('/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/validate-access', (req, res) => {
  try {
    const { accessCode } = req.body;

    // Add some logging to debug
    console.log('Received access code validation request');
    console.log('Expected:', process.env.ACCESS_CODE);
    console.log('Received:', accessCode);

    if (accessCode === process.env.ACCESS_CODE) {
      res.json({ valid: true });
    } else {
      res.json({ valid: false });
    }
  } catch (error) {
    console.error('Error in validate-access endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
