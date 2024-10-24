// pointing.js
const socket = io();
let currentRoom = '';
let selectedEmoji = '';
let sessionId = localStorage.getItem('sessionId');
const emojis = ['😀', '😎', '🤓', '🦄', '🐱', '🐶', '🦊', '🐸', '🐼', '🐯'];
const fibonacciSequence = [1, 2, 3, 5, 8, 13];

const letsTalkGifs = [
    'https://i.giphy.com/tbEjpqYUbeGyZtIcES.webp',
    'https://i.giphy.com/01u3Rw1zQLSylw2Tn9.webp',
];

// Initial setup
function populateEmojiGrid() {
    const emojiGrid = document.getElementById('emoji-grid');
    emojis.forEach(emoji => {
        const div = document.createElement('div');
        div.className = 'emoji-option';
        div.textContent = emoji;
        div.onclick = () => selectEmoji(emoji);
        emojiGrid.appendChild(div);
    });
}

function selectEmoji(emoji) {
    selectedEmoji = emoji;
    document.querySelectorAll('.emoji-option').forEach(el => {
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
    const room = document.getElementById('room').value;
    if (name && room && selectedEmoji) {
        currentRoom = room;
        socket.emit('joinRoom', { room, name, avatar: selectedEmoji, sessionId });
        document.getElementById('join-form').classList.add('hidden');
        document.getElementById('voting-area').classList.remove('hidden');
        updateRoomHeader(room, true);
        localStorage.setItem('pokerSession', JSON.stringify({ name, room, avatar: selectedEmoji }));
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
    currentVote = value;
    
    // Update UI to show selected vote
    document.querySelectorAll('.vote-button').forEach(button => {
        button.classList.remove('selected');
        if (parseInt(button.textContent) === value) {
            button.classList.add('selected');
        }
    });

    socket.emit('vote', { room: currentRoom, vote: value, sessionId });
}

function revealVotes() {
    socket.emit('revealVotes', currentRoom);
}

function resetVotes() {
    currentVote = null;
    document.querySelectorAll('.vote-button').forEach(button => {
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
    participants.forEach(p => {
        const div = document.createElement('div');
        div.className = 'participant card p-4 flex items-center space-x-2';
        div.innerHTML = `
            <span class="text-3xl">${p.avatar}</span>
            <span class="font-medium">${p.name}</span>
            <span class="ml-auto ${p.vote ? 'text-green-400' : 'text-gray-500'}">
                ${revealed ? (p.vote || '-') : (p.vote ? '<span class="material-icons">check_circle</span>' : '<span class="material-icons">help_outline</span>')}
            </span>
        `;
        if (p.vote) div.classList.add('voted');
        participantsDiv.appendChild(div);
    });
}

function calculateAndDisplayResults(participants) {
    const votes = participants.map(p => p.vote).filter(v => v !== null);
    const average = votes.length > 0 ? votes.reduce((a, b) => a + b, 0) / votes.length : 0;
    
    document.getElementById('average-vote').textContent = average.toFixed(2);
    document.getElementById('results').classList.remove('hidden');

    const allSame = votes.length > 0 && votes.every(v => v === votes[0]);
    if (allSame) {
        document.getElementById('consensus').classList.remove('hidden');
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
        });
    } else {
        document.getElementById('consensus').classList.add('hidden');
    }

    const minVote = Math.min(...votes);
    const maxVote = Math.max(...votes);
    const minIndex = fibonacciSequence.indexOf(minVote);
    const maxIndex = fibonacciSequence.indexOf(maxVote);

    if (maxIndex - minIndex > 2) {
        displayRandomGif();
    } else {
        document.getElementById('giphy-image').classList.add('hidden');
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
document.querySelectorAll('.input-md').forEach(input => {
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