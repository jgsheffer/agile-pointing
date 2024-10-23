// retro.js

// Initialize socket with reconnection options
const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity
});

// Core variables
let userName = '';
let timerInterval;
let participants = new Set();

// Room management
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

let roomId = new URLSearchParams(window.location.search).get('room');
if (!roomId) {
    roomId = generateRoomId();
    const newUrl = `${window.location.pathname}?room=${roomId}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
}

// User name generation
const animals = [
    'Panda', 'Tiger', 'Lion', 'Elephant', 'Giraffe', 'Penguin', 'Kangaroo', 'Koala',
    'Dolphin', 'Zebra', 'Monkey', 'Bear', 'Fox', 'Wolf', 'Owl', 'Eagle', 'Rabbit'
];

function generateAnimalName() {
    return `Anon ${animals[Math.floor(Math.random() * animals.length)]}`;
}

userName = generateAnimalName();
document.getElementById('user-name').textContent = userName;

// Room display functions
function updateRoomDisplay() {
    const roomDisplay = document.getElementById('room-id-display');
    if (roomDisplay) {
        roomDisplay.textContent = roomId;
    }
}

function copyRoomLink() {
    const roomLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(roomLink).then(() => {
        const button = document.querySelector('button[onclick="copyRoomLink()"]');
        const originalText = button.textContent;
        button.textContent = '✅';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
    });
}

// Participant management
function updateParticipantsList() {
    const list = document.getElementById('participants-list');
    if (list) {
        list.textContent = `Participants: ${Array.from(participants).join(', ')}`;
    }
}

// Card management
function createCard(content, id, votes = 0, author = userName, groupedCards = [], isSubmitted = false) {
    const card = document.createElement('div');
    card.className = 'card bg-white border rounded-lg p-4 shadow hover:shadow-md dark:bg-gray-700 dark:border-gray-600 theme-transition';
    card.dataset.id = id;
    
    const textarea = document.createElement('textarea');
    textarea.className = 'w-full resize-none border-none focus:ring-0 mb-2 dark:bg-gray-700 dark:text-white theme-transition';
    textarea.value = content;
    textarea.placeholder = 'Enter your thoughts here...';
    textarea.disabled = isSubmitted;

    const cardHeader = document.createElement('div');
    cardHeader.className = 'flex justify-between items-start mb-2';
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'flex items-center space-x-2 ml-2';

    // if (isSubmitted) {
    //     controlsDiv.innerHTML = `
    //         <button onclick="voteCard('${id}')" class="vote-count bg-blue-100 text-blue-800 px-2 py-1 rounded hover:bg-blue-200 transition dark:bg-blue-900 dark:text-blue-200 theme-transition">
    //             👍 ${votes}
    //         </button>
    //         <button onclick="deleteCard('${id}')" class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">×</button>
    //     `;
    // }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'flex-grow';
    contentDiv.appendChild(textarea);

    cardHeader.appendChild(contentDiv);
    cardHeader.appendChild(controlsDiv);

    card.appendChild(cardHeader);

    if (!isSubmitted) {
        const submitBtnContainer = document.createElement('div');
        submitBtnContainer.className = 'flex justify-end mt-2';
        
        const submitBtn = document.createElement('button');
        submitBtn.className = 'submit-button';
        submitBtn.textContent = 'Submit';
        submitBtn.onclick = () => submitCard(id, textarea.value, card);
        
        submitBtnContainer.appendChild(submitBtn);
        card.appendChild(submitBtnContainer);
    }

    const authorDiv = document.createElement('div');
    authorDiv.className = 'text-sm text-gray-500 mt-2 dark:text-gray-400 theme-transition';
    authorDiv.textContent = `Added by ${author}`;
    card.appendChild(authorDiv);

    if (groupedCards && groupedCards.length > 0) {
        const groupedDiv = document.createElement('div');
        groupedDiv.className = 'grouped-cards mt-2';
        groupedCards.forEach(groupedCard => {
            const groupedCardDiv = document.createElement('div');
            groupedCardDiv.className = 'text-sm text-gray-600 pl-2 border-l-2 border-gray-200 mt-2 dark:text-gray-300 dark:border-gray-600 theme-transition';
            groupedCardDiv.textContent = `${groupedCard.content} (by ${groupedCard.author})`;
            groupedDiv.appendChild(groupedCardDiv);
        });
        card.appendChild(groupedDiv);
    }

    setTimeout(() => {
        autoResize(textarea);
        if (!content && !isSubmitted) {
            textarea.focus();
        }
    }, 0);

    return card;
}

function addCard(columnId) {
    const cardId = Date.now().toString();
    const card = {
        id: cardId,
        content: '',
        column: columnId,
        votes: 0,
        author: userName,
        voters: []
    };
    
    const column = document.getElementById(columnId);
    column.appendChild(createCard('', cardId, 0, userName, [], false));
    
    socket.emit('addCard', { room: roomId, card });
}

function submitCard(cardId, content, cardElement) {
    if (!content.trim()) {
        alert('Please enter some content before submitting.');
        return;
    }
    
    const textarea = cardElement.querySelector('textarea');
    const submitBtn = cardElement.querySelector('.submit-button');
    const controlsDiv = cardElement.querySelector('.flex.items-center');
    
    textarea.disabled = true;
    if (submitBtn) {
        submitBtn.parentElement.remove();
    }
    
    controlsDiv.innerHTML = `
        <button onclick="voteCard('${cardId}')" class="vote-count bg-blue-100 text-blue-800 px-2 py-1 rounded hover:bg-blue-200 transition dark:bg-blue-900 dark:text-blue-200 theme-transition">
            👍 0
        </button>
        <button onclick="deleteCard('${cardId}')" class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">×</button>
    `;
    
    socket.emit('submitCard', {
        room: roomId,
        cardId: cardId,
        content: content.trim()
    });
}

function deleteCard(cardId) {
    socket.emit('deleteCard', { room: roomId, cardId });
}

function voteCard(cardId) {
    socket.emit('voteCard', { room: roomId, cardId, voter: userName });
}

function resetRetro() {
    if (confirm('Are you sure you want to reset the retro? This will clear all cards for everyone.')) {
        socket.emit('resetRetro', { room: roomId });
    }
}

function autoResize(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
}

// Theme management
function toggleTheme() {
    const html = document.documentElement;
    const themeToggle = document.querySelector('.theme-toggle');
    const isDark = html.classList.toggle('dark');
    themeToggle.classList.toggle('dark');
    themeToggle.classList.toggle('light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server, joining room:', roomId);
    updateRoomDisplay();
    socket.emit('joinRetro', { room: roomId, name: userName });
    document.getElementById('loading-overlay').style.display = 'none';
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('loading-overlay').textContent = 'Reconnecting...';
});

socket.on('initialCards', ({ cards }) => {
    console.log('Received initial cards:', cards.length);
    updateCardsDisplay(cards);
});

socket.on('updateCards', ({ cards }) => {
    console.log('Received card update:', cards.length);
    updateCardsDisplay(cards);
});

socket.on('participantJoined', ({ name }) => {
    participants.add(name);
    updateParticipantsList();
});

socket.on('participantLeft', ({ name }) => {
    participants.delete(name);
    updateParticipantsList();
});

socket.on('updateParticipants', ({ participants: participantsList }) => {
    participants = new Set(participantsList);
    updateParticipantsList();
});

socket.on('retroReset', () => {
    ['went-well', 'improve', 'action-items'].forEach(columnId => {
        const column = document.getElementById(columnId);
        column.innerHTML = '';
    });
});

// Card display update
function updateCardsDisplay(cards) {
    ['went-well', 'improve', 'action-items'].forEach(columnId => {
        const column = document.getElementById(columnId);
        column.innerHTML = '';
        cards
            .filter(card => card.column === columnId)
            .sort((a, b) => b.votes - a.votes)
            .forEach(card => {
                column.appendChild(createCard(
                    card.content,
                    card.id,
                    card.votes,
                    card.author,
                    card.groupedCards,
                    card.isSubmitted
                ));
            });
    });

    document.querySelectorAll('textarea').forEach(autoResize);
}

// Initialize drag and drop
const drake = dragula([
    document.getElementById('went-well'),
    document.getElementById('improve'),
    document.getElementById('action-items')
], {
    moves: function (el, container, handle) {
        return !handle.classList.contains('vote-count') && 
               !handle.classList.contains('text-red-500') &&
               el.querySelector('textarea').disabled;
    }
}).on('drop', function (el, target, source) {
    socket.emit('moveCard', {
        room: roomId,
        cardId: el.dataset.id,
        newColumn: target.id
    });
});

// Initialize theme
if (localStorage.getItem('theme') === 'dark' || 
    (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
    document.querySelector('.theme-toggle').classList.add('dark');
    document.querySelector('.theme-toggle').classList.remove('light');
}

// Handle page visibility
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        socket.emit('requestUpdate', { room: roomId });
    }
});

// Handle beforeunload
window.addEventListener('beforeunload', () => {
    socket.emit('leaveRetro', { room: roomId, name: userName });
});

// Error handling
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    document.getElementById('loading-overlay').textContent = 'Connection error. Retrying...';
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    socket.emit('joinRetro', { room: roomId, name: userName });
});