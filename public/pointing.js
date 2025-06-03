// pointing.js
const socket = io();
// Update the currentRoom initialization to use URL parameters
let currentRoom = new URLSearchParams(window.location.search).get('room') || '';
let selectedEmoji = '';
let sessionId = localStorage.getItem('sessionId');
const emojis = ['😀', '😎', '🤓', '🦄', '🐱', '🐶', '🦊', '🐸', '🐼', '🐯'];
const fibonacciSequence = [1, 2, 3, 5, 8, 13, 'Pass'];
const voteOptions = [1, 2, 3, 5, 8, 13, 'Pass'];

const letsTalkGifs = [
  'https://i.giphy.com/tbEjpqYUbeGyZtIcES.webp',
  'https://i.giphy.com/01u3Rw1zQLSylw2Tn9.webp',
  'https://i.giphy.com/l0HlvtIPzPdt2usKs.webp',
  'https://i.giphy.com/l0HlKrB02QY0f1mbm.webp',
];

const celebrationGifs = [
  'https://i.giphy.com/3o7TKDxSkF9iGiCJri.webp',
  'https://i.giphy.com/g9582DNuQppxC.webp',
  'https://i.giphy.com/YTbZzCkRQCEJa.webp',
  'https://i.giphy.com/11sBLVxNs7v6WA.webp',
  'https://i.giphy.com/26tOZ42Mg6pbTUPHW.webp',
  'https://i.giphy.com/26u4lOMA8JKSnL9Uk.webp',
  'https://i.giphy.com/l0MYt5jPR6QX5pnqM.webp',
  'https://i.giphy.com/3oz8xRF0v9WMAUVLNK.webp',
  'https://i.giphy.com/26gsspfbt1HfVQ9va.webp',
  'https://i.giphy.com/l0MYJnJQ4EiYLxvQ4.webp',
  'https://i.giphy.com/26u4cqiYI30juCOGY.webp',
  'https://i.giphy.com/26tPplGWjN0xLybiU.webp',
  'https://i.giphy.com/3o7TKNcbfKa8f2Zkuk.webp',
]; // Initial setup
function populateEmojiGrid() {
  const emojiGrid = document.getElementById('emoji-grid');
  emojis.forEach((emoji) => {
    const div = document.createElement('div');
    div.className = 'emoji-option';
    div.textContent = emoji;
    div.onclick = () => selectEmoji(emoji);
    emojiGrid.appendChild(div);
  });
}

function selectEmoji(emoji) {
  selectedEmoji = emoji;
  document.querySelectorAll('.emoji-option').forEach((el) => {
    el.style.backgroundColor = el.textContent === emoji ? '#3700B3' : '#2c2c2c';
  });
}

// Room management
function copyRoomLink() {
  const roomLink = `${window.location.origin}${window.location.pathname}?room=${currentRoom}`;
  navigator.clipboard.writeText(roomLink).then(() => {
    const copyButton = document.querySelector('.copy-button');
    copyButton.textContent = 'check';
    setTimeout(() => {
      copyButton.textContent = 'content_copy';
    }, 2000);
  });
}

function updateRoomHeader(roomId, show = true) {
  const headerRoomInfo = document.getElementById('header-room-info');
  const headerRoomId = document.getElementById('header-room-id');

  if (show) {
    headerRoomInfo.classList.remove('hidden');
    headerRoomId.textContent = roomId;
  } else {
    headerRoomInfo.classList.add('hidden');
    headerRoomId.textContent = '';
  }
}

function joinRoom() {
  const name = document.getElementById('name').value;
  const room = document.getElementById('room').value || currentRoom;
  if (name && room && selectedEmoji) {
    // Update URL with room parameter
    const newUrl = `${window.location.pathname}?room=${room}`;
    window.history.pushState({}, '', newUrl);
    currentRoom = room;
    socket.emit('joinRoom', { room, name, avatar: selectedEmoji, sessionId });
    document.getElementById('join-form').classList.add('hidden');
    document.getElementById('voting-area').classList.remove('hidden');
    updateRoomHeader(room, true);
    localStorage.setItem(
      'pokerSession',
      JSON.stringify({ name, room, avatar: selectedEmoji })
    );
  } else {
    alert('Please enter your name, room ID, and select an avatar.');
  }
}
function leaveRoom() {
  socket.emit('leaveRoom', { room: currentRoom, sessionId });
  currentRoom = '';
  document.getElementById('voting-area').classList.add('hidden');
  document.getElementById('join-form').classList.remove('hidden');
  document.getElementById('results').classList.add('hidden');
  document.getElementById('consensus').classList.add('hidden');
  document.getElementById('giphy-image').classList.add('hidden');
  updateRoomHeader('', false);
  localStorage.removeItem('pokerSession');
}

// Voting functionality
let currentVote = null;

function vote(value) {
  const previousVote = currentVote;
  currentVote = value;

  // Update UI to show selected vote with enhanced animations
  document.querySelectorAll('.vote-button').forEach((button) => {
    button.classList.remove('selected');
    button.style.transform = 'scale(1)';
    
    const buttonValue = button.textContent.trim();
    if (
      buttonValue == value ||
      (typeof value === 'number' && parseInt(buttonValue) === value)
    ) {
      button.classList.add('selected');
      
      // Add pop effect
      button.style.transform = 'scale(1.15)';
      setTimeout(() => {
        button.style.transform = 'scale(1.1)';
      }, 200);

      // Add ripple effect
      const ripple = document.createElement('div');
      ripple.className = 'absolute inset-0 bg-white rounded-xl';
      ripple.style.animation = 'ripple 0.6s linear';
      button.appendChild(ripple);
      
      setTimeout(() => ripple.remove(), 700);

      // Add micro-confetti burst from the button
      const rect = button.getBoundingClientRect();
      const buttonCenterX = (rect.left + rect.right) / 2;
      const buttonCenterY = rect.top;
      
      confetti({
        particleCount: 20,
        spread: 30,
        startVelocity: 20,
        origin: {
          x: buttonCenterX / window.innerWidth,
          y: buttonCenterY / window.innerHeight
        },
        colors: ['#60A5FA', '#3B82F6', '#2563EB'],
        shapes: ['circle'],
        scalar: 0.75
      });
    }
  });

  // Add voting sound effect
  const audio = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAEAAABVgANTU1NTU1Q0NDQ0NDUVFRUVFRXl5eXl5ea2tra2tra3l5eXl5eYaGhoaGhpSUlJSUlKGhoaGhoaGvr6+vr6+8vLy8vLzKysrKysrX19fX19fX5OTk5OTk8vLy8vLy////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQCgAAAAAAAAAVY82AhbwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAALACwAAP/AADwQKVE9YWDGPkQWpT66yk4+zIiYPoTUaT3tnU+OkZUwY0ZIg/oGjvxzqX6qufq9+vRJBW/WtaRBQlT0LXqWvQ5BDm8Wn0CRQoUCCv7zP6N/qv//7vRAGKwjkHhGQf/8I5F4RyL/8QDg4OAaEf/yDguBwcAwI/l/5cHBwcA0D//5cHBwcA4CAh+D/+XBwcHAMDAwPwf/yg//5QEP/+MYxA8L0DU0A/9IADD4nB8Hg+D4nB8EDweD4nB8Hg+D4nB8Hg+D4nB8Hg+D4nB8Hg+D4nB8Hg+D4nB8Hg+D4nB8Hg+D4nB8Hg+D4nB8Hg+D4nB8Hg+D4nB8Hg+D4nB8Hg+D4nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxB8AAANIAAAAABYAAVERAAqIiIAAEREACIiIgABEREQAAiIiIAAREREAAIiIiAAAREREAAIiIiAAARERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  audio.volume = 0.2;
  audio.play();

  // If this is a new vote (not just deselecting), add some particle effects
  if (previousVote !== value) {
    const buttons = document.getElementById('voting-buttons');
    const rect = buttons.getBoundingClientRect();
    const centerX = (rect.left + rect.right) / 2;
    const centerY = (rect.top + rect.bottom) / 2;

    // Create floating number particles
    for (let i = 0; i < 3; i++) {
      const particle = document.createElement('div');
      particle.textContent = value;
      particle.className = 'absolute text-2xl font-bold text-blue-400 pointer-events-none';
      particle.style.left = `${centerX}px`;
      particle.style.top = `${centerY}px`;
      particle.style.transform = 'scale(0)';
      particle.style.opacity = '0';
      document.body.appendChild(particle);

      // Random direction for each particle
      const angle = (Math.random() * Math.PI * 2);
      const distance = 100 + Math.random() * 50;
      const destinationX = centerX + Math.cos(angle) * distance;
      const destinationY = centerY + Math.sin(angle) * distance;

      // Animate the particle
      requestAnimationFrame(() => {
        particle.style.transition = 'all 1s cubic-bezier(0.4, 0, 0.2, 1)';
        particle.style.transform = 'scale(1)';
        particle.style.opacity = '1';
        particle.style.left = `${destinationX}px`;
        particle.style.top = `${destinationY}px`;
      });

      // Remove the particle after animation
      setTimeout(() => {
        particle.style.opacity = '0';
        setTimeout(() => particle.remove(), 1000);
      }, 500);
    }
  }

  socket.emit('vote', { room: currentRoom, vote: value, sessionId });
}

function revealVotes() {
  socket.emit('revealVotes', currentRoom);
}

function resetVotes() {
  currentVote = null;
  document.querySelectorAll('.vote-button').forEach((button) => {
    button.classList.remove('selected');
  });
  socket.emit('resetVotes', currentRoom);
  document.getElementById('results').classList.add('hidden');
  document.getElementById('consensus').classList.add('hidden');
  document.getElementById('giphy-image').classList.add('hidden');
}

function updateParticipantList(participants, revealed = false) {
  const participantsDiv = document.getElementById('participants');
  participantsDiv.innerHTML = '';
  participants.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'participant modern-card p-6 flex items-center space-x-4 transform transition-all duration-300 hover:scale-105';
    
    // Add a random animation delay for a staggered effect
    const delay = Math.random() * 0.5;
    div.style.animationDelay = `${delay}s`;
    
    const voteStatus = p.vote 
      ? revealed 
        ? `<span class="text-2xl font-bold gradient-text">${p.vote}</span>`
        : '<span class="material-icons text-green-400 animate-pulse">check_circle</span>'
      : '<span class="material-icons text-gray-400 float-animation">help_outline</span>';

    div.innerHTML = `
      <div class="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-2xl transform hover:rotate-12 transition-transform duration-300">
        ${p.avatar}
      </div>
      <span class="font-medium text-lg">${p.name}</span>
      <span class="ml-auto">
        ${voteStatus}
      </span>
    `;
    
    if (p.vote) {
      div.classList.add('voted');
      // Add a subtle glow effect for voted participants
      div.style.boxShadow = '0 0 15px rgba(74, 222, 128, 0.2)';
    }
    
    participantsDiv.appendChild(div);
  });
  
  // Add entrance animation for new participants
  const allParticipants = participantsDiv.querySelectorAll('.participant');
  allParticipants.forEach((participant, index) => {
    participant.style.opacity = '0';
    participant.style.transform = 'translateY(20px)';
    setTimeout(() => {
      participant.style.opacity = '1';
      participant.style.transform = 'translateY(0)';
    }, index * 100);
  });
}

function calculateAndDisplayResults(participants) {
  // Filter out Pass votes and null votes for average calculation
  const numericVotes = participants
    .map((p) => p.vote)
    .filter((v) => v !== null && v !== 'Pass' && typeof v === 'number');

  const average =
    numericVotes.length > 0
      ? numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length
      : 0;

  // Display average and count of numeric votes vs total votes
  const totalVotes = participants.filter((p) => p.vote !== null).length;
  const passVotes = participants.filter((p) => p.vote === 'Pass').length;

  const resultsDiv = document.getElementById('results');
  const averageVoteSpan = document.getElementById('average-vote');
  
  // Animate the average vote number counting up
  const duration = 1500;
  const steps = 30;
  const stepDuration = duration / steps;
  let currentStep = 0;
  
  const startValue = 0;
  const endValue = parseFloat(average.toFixed(2));
  
  if (numericVotes.length > 0) {
    const interval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const currentValue = startValue + (endValue - startValue) * progress;
      averageVoteSpan.textContent = currentValue.toFixed(2);
      
      if (currentStep === steps) {
        clearInterval(interval);
        // Add a small bounce animation when done counting
        averageVoteSpan.style.transform = 'scale(1.2)';
        setTimeout(() => {
          averageVoteSpan.style.transform = 'scale(1)';
        }, 200);
      }
    }, stepDuration);
  } else {
    averageVoteSpan.textContent = 'N/A';
  }

  // Update results display to show vote breakdown with animation
  const existingBreakdown = resultsDiv.querySelector('.vote-breakdown');
  if (existingBreakdown) {
    existingBreakdown.remove();
  }

  if (passVotes > 0) {
    const breakdownDiv = document.createElement('div');
    breakdownDiv.className = 'vote-breakdown text-lg text-gray-400 mt-4 opacity-0 transform translate-y-4';
    breakdownDiv.textContent = `${numericVotes.length} numeric votes, ${passVotes} pass votes`;
    resultsDiv.appendChild(breakdownDiv);
    
    // Fade in animation
    setTimeout(() => {
      breakdownDiv.style.transition = 'all 0.5s ease-out';
      breakdownDiv.style.opacity = '1';
      breakdownDiv.style.transform = 'translateY(0)';
    }, 100);
  }

  resultsDiv.classList.remove('hidden');

  // Check for consensus only among numeric votes
  const allSame =
    numericVotes.length > 0 && numericVotes.every((v) => v === numericVotes[0]);
  
  const consensusDiv = document.getElementById('consensus');
  const giphyImage = document.getElementById('giphy-image');
  
  if (allSame && numericVotes.length > 1) {
    consensusDiv.classList.remove('hidden');
    
    // Enhanced confetti effect
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    function randomInRange(min, max) {
      return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      
      // Create confetti from multiple origins
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
      });
    }, 250);

    // Show celebration GIF with fade-in effect
    const randomIndex = Math.floor(Math.random() * celebrationGifs.length);
    giphyImage.src = celebrationGifs[randomIndex];
    giphyImage.style.opacity = '0';
    giphyImage.classList.remove('hidden');
    
    setTimeout(() => {
      giphyImage.style.transition = 'opacity 0.5s ease-in';
      giphyImage.style.opacity = '1';
    }, 100);
  } else {
    consensusDiv.classList.add('hidden');

    // Check for large vote spread only among numeric votes
    if (numericVotes.length > 1) {
      const minVote = Math.min(...numericVotes);
      const maxVote = Math.max(...numericVotes);
      const minIndex = fibonacciSequence.indexOf(minVote);
      const maxIndex = fibonacciSequence.indexOf(maxVote);

      if (maxIndex - minIndex > 2) {
        // Show "let's talk" GIF with bounce effect
        const randomIndex = Math.floor(Math.random() * letsTalkGifs.length);
        giphyImage.src = letsTalkGifs[randomIndex];
        giphyImage.style.transform = 'scale(0)';
        giphyImage.classList.remove('hidden');
        
        setTimeout(() => {
          giphyImage.style.transition = 'transform 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
          giphyImage.style.transform = 'scale(1)';
        }, 100);
      } else {
        giphyImage.classList.add('hidden');
      }
    } else {
      giphyImage.classList.add('hidden');
    }
  }
}
function displayRandomGif() {
  const randomIndex = Math.floor(Math.random() * letsTalkGifs.length);
  const gifUrl = letsTalkGifs[randomIndex];
  const giphyImage = document.getElementById('giphy-image');
  giphyImage.src = gifUrl;
  giphyImage.classList.remove('hidden');
}

// Session management
function checkExistingSession() {
  const session = JSON.parse(localStorage.getItem('pokerSession'));
  if (session) {
    document.getElementById('name').value = session.name;
    document.getElementById('room').value = session.room;
    selectEmoji(session.avatar);
    joinRoom();
  }
}

// Socket event handlers
socket.on('sessionCreated', (newSessionId) => {
  sessionId = newSessionId;
  localStorage.setItem('sessionId', sessionId);
});

socket.on('updateParticipants', (participants) => {
  updateParticipantList(participants);
});

socket.on('updateVotes', (participants) => {
  updateParticipantList(participants);
});

socket.on('votesRevealed', (participants) => {
  updateParticipantList(participants, true);
  calculateAndDisplayResults(participants);
});

socket.on('votesReset', (participants) => {
  updateParticipantList(participants);
});

// Input field effects
document.querySelectorAll('.input-md').forEach((input) => {
  input.addEventListener('focus', () => {
    input.nextElementSibling.classList.remove('scale-x-0');
    input.nextElementSibling.classList.add('scale-x-100');
  });
  input.addEventListener('blur', () => {
    if (input.value === '') {
      input.nextElementSibling.classList.remove('scale-x-100');
      input.nextElementSibling.classList.add('scale-x-0');
    }
  });
});

// Initialize
populateEmojiGrid();
window.onload = checkExistingSession;
