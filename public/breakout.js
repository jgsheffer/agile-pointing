// Game constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PADDLE_WIDTH = 100;
const PADDLE_HEIGHT = 15;
const BALL_RADIUS = 8;
const BRICK_WIDTH = 75;
const BRICK_HEIGHT = 20;
const BRICK_ROWS = 8;
const BRICK_COLS = 10;
const BRICK_PADDING = 5;

// Animal names for players
const animals = [
  'Panda',
  'Red Panda',
  'Tiger',
  'Lion',
  'Elephant',
  'Giraffe',
  'Penguin',
  'Kangaroo',
  'Koala',
  'Dolphin',
  'Zebra',
  'Monkey',
  'Bear',
  'Fox',
  'Wolf',
  'Owl',
  'Eagle',
  'Rabbit',
  'Cheetah',
  'Hippo',
];

// Player colors
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

// Game state
let canvas, ctx;
let socket;
let gameState = {
  players: new Map(),
  balls: [],
  bricks: [],
  gameRunning: false,
  gamePaused: false,
  score: 0,
};

let myPlayerId = null;
let myPlayerName = '';
let roomId = '';
let keys = {};

// Initialize the game
document.addEventListener('DOMContentLoaded', function () {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');

  // Get room ID from URL or generate new one
  const urlParams = new URLSearchParams(window.location.search);
  roomId = urlParams.get('room') || generateRoomId();

  // Update URL if needed
  if (!urlParams.get('room')) {
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?room=${roomId}`
    );
  }

  // Display room ID and link
  document.getElementById('roomId').textContent = roomId;
  document.getElementById('roomLink').value = window.location.href;

  // Initialize socket connection
  initSocket();

  // Set up event listeners
  setupEventListeners();

  // Generate player name
  myPlayerName = animals[Math.floor(Math.random() * animals.length)];

  // Start game loop
  gameLoop();
});

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function initSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('joinBreakout', { roomId, playerName: myPlayerName });
  });

  socket.on('playerJoined', (data) => {
    myPlayerId = data.playerId;
    updateGameState(data.gameState);
    updatePlayersList();
  });

  socket.on('gameStateUpdate', (data) => {
    updateGameState(data);
    updatePlayersList();
    updateGameStats();
  });

  socket.on('playerLeft', (data) => {
    gameState.players.delete(data.playerId);
    updatePlayersList();
  });

  socket.on('gameStarted', () => {
    gameState.gameRunning = true;
    gameState.gamePaused = false;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('pauseBtn').disabled = false;
    document.getElementById('gameStatus').textContent = 'Playing';
  });

  socket.on('gameReset', (data) => {
    updateGameState(data);
    gameState.gameRunning = false;
    gameState.gamePaused = false;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('pauseBtn').disabled = true;
    document.getElementById('gameStatus').textContent = 'Waiting';
  });

  socket.on('gamePaused', (paused) => {
    gameState.gamePaused = paused;
    document.getElementById('gameStatus').textContent = paused
      ? 'Paused'
      : 'Playing';
  });

  socket.on('gameWon', () => {
    gameState.gameRunning = false;
    document.getElementById('gameStatus').textContent = 'Victory!';
    showVictoryMessage();
  });

  socket.on('gameOver', () => {
    gameState.gameRunning = false;
    document.getElementById('gameStatus').textContent = 'Game Over';
  });
}

function setupEventListeners() {
  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
    }
  });

  document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
  });

  // Game controls
  document.getElementById('startBtn').addEventListener('click', () => {
    socket.emit('startBreakout', roomId);
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    socket.emit('resetBreakout', roomId);
  });

  document.getElementById('pauseBtn').addEventListener('click', () => {
    socket.emit('pauseBreakout', roomId);
  });

  // Copy room link
  document.getElementById('copyBtn').addEventListener('click', () => {
    const roomLink = document.getElementById('roomLink');
    roomLink.select();
    document.execCommand('copy');

    const btn = document.getElementById('copyBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="material-icons text-sm">check</span>';
    setTimeout(() => {
      btn.innerHTML = originalText;
    }, 2000);
  });
}

function updateGameState(newState) {
  // Update players
  gameState.players.clear();
  if (newState.players) {
    Object.entries(newState.players).forEach(([id, player]) => {
      gameState.players.set(id, player);
    });
  }

  // Update other game state
  if (newState.balls) gameState.balls = newState.balls;
  if (newState.bricks) gameState.bricks = newState.bricks;
  if (newState.score !== undefined) gameState.score = newState.score;
  if (newState.gameRunning !== undefined)
    gameState.gameRunning = newState.gameRunning;
  if (newState.gamePaused !== undefined)
    gameState.gamePaused = newState.gamePaused;
}

function updatePlayersList() {
  const playersList = document.getElementById('playersList');
  const playerCount = document.getElementById('playerCount');

  playersList.innerHTML = '';
  playerCount.textContent = gameState.players.size;

  gameState.players.forEach((player, playerId) => {
    const playerDiv = document.createElement('div');
    playerDiv.className =
      'flex items-center justify-between p-2 rounded-lg bg-black bg-opacity-20';

    const isMe = playerId === myPlayerId;

    playerDiv.innerHTML = `
            <div class="flex items-center">
                <div class="w-4 h-4 rounded-full mr-3" style="background-color: ${
                  player.color
                }"></div>
                <span class="font-medium">${player.name}${
      isMe ? ' (You)' : ''
    }</span>
            </div>
            <div class="text-sm opacity-80">
                Score: ${player.score || 0}
            </div>
        `;

    playersList.appendChild(playerDiv);
  });
}

function updateGameStats() {
  const bricksLeft = gameState.bricks.filter(
    (brick) => !brick.destroyed
  ).length;
  document.getElementById('bricksLeft').textContent = bricksLeft;
  document.getElementById('totalScore').textContent = gameState.score;
}

function gameLoop() {
  // Handle player input
  if (
    myPlayerId &&
    gameState.players.has(myPlayerId) &&
    gameState.gameRunning &&
    !gameState.gamePaused
  ) {
    const myPlayer = gameState.players.get(myPlayerId);
    let moved = false;

    if (keys['ArrowLeft'] && myPlayer.paddle.x > 0) {
      myPlayer.paddle.x = Math.max(0, myPlayer.paddle.x - 8);
      moved = true;
    }

    if (keys['ArrowRight'] && myPlayer.paddle.x < CANVAS_WIDTH - PADDLE_WIDTH) {
      myPlayer.paddle.x = Math.min(
        CANVAS_WIDTH - PADDLE_WIDTH,
        myPlayer.paddle.x + 8
      );
      moved = true;
    }

    // Send paddle position update if moved
    if (moved) {
      socket.emit('paddleMove', {
        roomId,
        playerId: myPlayerId,
        x: myPlayer.paddle.x,
      });
    }
  }

  // Render the game
  render();

  // Continue the game loop
  requestAnimationFrame(gameLoop);
}

function render() {
  // Clear canvas
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Draw bricks
  gameState.bricks.forEach((brick) => {
    if (!brick.destroyed) {
      ctx.fillStyle = brick.color;
      ctx.fillRect(brick.x, brick.y, BRICK_WIDTH, BRICK_HEIGHT);

      // Add brick border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(brick.x, brick.y, BRICK_WIDTH, BRICK_HEIGHT);
    }
  });

  // Draw paddles
  gameState.players.forEach((player, playerId) => {
    ctx.fillStyle = player.color;
    ctx.fillRect(player.paddle.x, player.paddle.y, PADDLE_WIDTH, PADDLE_HEIGHT);

    // Draw player name above paddle
    ctx.fillStyle = '#fff';
    ctx.font = '12px Roboto';
    ctx.textAlign = 'center';
    ctx.fillText(
      player.name,
      player.paddle.x + PADDLE_WIDTH / 2,
      player.paddle.y - 5
    );
  });

  // Draw balls
  gameState.balls.forEach((ball) => {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.closePath();
  });

  // Draw game status overlay
  if (!gameState.gameRunning || gameState.gamePaused) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#fff';
    ctx.font = '48px Roboto';
    ctx.textAlign = 'center';

    let message = '';
    if (
      !gameState.gameRunning &&
      gameState.bricks.every((brick) => brick.destroyed)
    ) {
      message = 'VICTORY!';
    } else if (!gameState.gameRunning) {
      message = 'WAITING TO START';
    } else if (gameState.gamePaused) {
      message = 'PAUSED';
    }

    ctx.fillText(message, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  }
}

function showVictoryMessage() {
  // Create confetti effect
  createConfetti();
}

function createConfetti() {
  const colors = [
    '#ff0000',
    '#00ff00',
    '#0000ff',
    '#ffff00',
    '#ff00ff',
    '#00ffff',
  ];
  const confettiCount = 100;

  for (let i = 0; i < confettiCount; i++) {
    setTimeout(() => {
      const confetti = document.createElement('div');
      confetti.style.position = 'fixed';
      confetti.style.left = Math.random() * window.innerWidth + 'px';
      confetti.style.top = '-10px';
      confetti.style.width = '10px';
      confetti.style.height = '10px';
      confetti.style.backgroundColor =
        colors[Math.floor(Math.random() * colors.length)];
      confetti.style.pointerEvents = 'none';
      confetti.style.zIndex = '9999';

      document.body.appendChild(confetti);

      const animation = confetti.animate(
        [
          { transform: 'translateY(0px) rotate(0deg)', opacity: 1 },
          {
            transform: `translateY(${
              window.innerHeight + 20
            }px) rotate(360deg)`,
            opacity: 0,
          },
        ],
        {
          duration: 3000,
          easing: 'linear',
        }
      );

      animation.onfinish = () => {
        document.body.removeChild(confetti);
      };
    }, i * 50);
  }
}
