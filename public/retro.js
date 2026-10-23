// retro.js

const socket = io({
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 10000
});

// The access code is entered on the main page, which sends us back here after
function redirectToAccessForm() {
    const next = window.location.pathname + window.location.search;
    window.location.href = `/?next=${encodeURIComponent(next)}`;
}

fetch('/access-status')
    .then(response => response.json())
    .then(data => data.valid ? socket.connect() : redirectToAccessForm())
    .catch(error => {
        console.error('Error checking access:', error);
        document.getElementById('loading-overlay').textContent = 'Connection error. Please refresh the page.';
    });

// Core variables
let userName = '';
let timerInterval;
let participants = new Set();
let timer = null;

// Room management
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

let roomId = new URLSearchParams(window.location.search).get('room');
if (!roomId || !/^[\w -]{1,64}$/.test(roomId)) {
    roomId = generateRoomId();
    const newUrl = `${window.location.pathname}?room=${roomId}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
}

// User name generation
const animals = [
    'Panda','Red Panda', 'Tiger', 'Lion', 'Elephant', 'Giraffe', 'Penguin', 'Kangaroo', 'Koala',
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
    const roomLink = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    navigator.clipboard.writeText(roomLink).then(() => {
        const button = document.querySelector('button[onclick="copyRoomLink()"]');
        const originalIcon = button.textContent;
        button.textContent = 'check';
        setTimeout(() => {
            button.textContent = originalIcon;
        }, 2000);
    });
}

// PDF Generation
async function downloadPDF() {
    const pdfButton = document.querySelector('button[onclick="downloadPDF()"]');
    const originalContent = pdfButton.innerHTML;
    pdfButton.innerHTML = '<span class="material-icons">hourglass_top</span>Generating...';
    const container = document.createElement('div');
    
    try {
        const contentClone = document.querySelector('#retro-content').cloneNode(true);
        
        // Clean up the clone for PDF
        contentClone.querySelectorAll('button').forEach(button => {
            if (!button.classList.contains('vote-count')) {
                button.remove();
            }
        });
        
        contentClone.querySelectorAll('textarea').forEach(textarea => {
            const div = document.createElement('div');
            div.textContent = textarea.value || 'Empty card';
            div.style.minHeight = '50px';
            div.style.padding = '8px';
            textarea.parentNode.replaceChild(div, textarea);
        });

        container.style.background = 'white';
        container.style.padding = '20px';
        container.style.color = 'black';
        container.appendChild(contentClone);
        document.body.appendChild(container);

        const canvas = await html2canvas(container, {
            scale: 2,
            backgroundColor: 'white',
            useCORS: true,
            logging: false
        });

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210;
        const imgHeight = canvas.height * imgWidth / canvas.width;
        const pageHeight = 297;

        // Add title and metadata
        pdf.setFontSize(20);
        pdf.text('Sprint Retrospective', 105, 15, { align: 'center' });
        pdf.setFontSize(12);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, 105, 25, { align: 'center' });
        pdf.text(`Room: ${roomId}`, 105, 32, { align: 'center' });

        // Add content
        let position = 40;
        let remainingHeight = imgHeight;

        while (remainingHeight > 0) {
            pdf.addImage(
                canvas.toDataURL('image/jpeg', 1.0),
                'JPEG',
                0,
                position,
                imgWidth,
                Math.min(remainingHeight, pageHeight - 40)
            );
            
            remainingHeight -= (pageHeight - 40);
            if (remainingHeight > 0) {
                pdf.addPage();
                position = 0;
            }
        }

        pdf.save(`Sprint_Retro_${roomId}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
        console.error('PDF generation failed:', error);
        alert('Failed to generate PDF. Please try again.');
    } finally {
        container.remove();
        pdfButton.innerHTML = originalContent;
    }
}

// Timer functionality
function toggleTimer() {
    const timerBtn = document.getElementById('timer-btn');
    const timerDisplay = document.getElementById('timer-display');
    
    if (!timer) {
        let timeLeft = 5 * 60;
        timerDisplay.classList.remove('hidden');
        
        timer = setInterval(() => {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            if (timeLeft === 0) {
                clearInterval(timer);
                timer = null;
                timerBtn.innerHTML = '<span class="material-icons">timer</span>Start Timer (5:00)';
                timerDisplay.classList.add('hidden');
            }
            timeLeft--;
        }, 1000);
        
        timerBtn.innerHTML = '<span class="material-icons">timer_off</span>Stop Timer';
    } else {
        clearInterval(timer);
        timer = null;
        timerBtn.innerHTML = '<span class="material-icons">timer</span>Start Timer (5:00)';
        timerDisplay.classList.add('hidden');
    }
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
    card.className = 'card p-4';
    card.dataset.id = id;
    
    const textarea = document.createElement('textarea');
    textarea.className = 'w-full border-none focus:ring-0 mb-2';
    textarea.value = content;
    textarea.placeholder = 'Enter your thoughts here...';
    textarea.disabled = isSubmitted;

    const cardHeader = document.createElement('div');
    cardHeader.className = 'flex justify-between items-start mb-2';
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'flex items-center space-x-2 ml-2';

    if (isSubmitted) {
        const voteBtn = document.createElement('button');
        voteBtn.className = 'vote-count px-2 py-1 rounded';
        voteBtn.textContent = `👍 ${votes}`;
        voteBtn.addEventListener('click', () => voteCard(id));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'material-icons text-red-400 hover:text-red-300';
        deleteBtn.textContent = 'delete';
        deleteBtn.addEventListener('click', () => deleteCard(id));

        controlsDiv.append(voteBtn, deleteBtn);
    }

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
        submitBtn.className = 'submit-button px-4 py-2 rounded';
        submitBtn.innerHTML = '<span class="material-icons">send</span>Submit';
        submitBtn.onclick = () => submitCard(id, textarea.value);
        
        submitBtnContainer.appendChild(submitBtn);
        card.appendChild(submitBtnContainer);
    }

    const authorDiv = document.createElement('div');
    authorDiv.className = 'text-sm opacity-60 mt-2';
    authorDiv.textContent = `Added by ${author}`;
    card.appendChild(authorDiv);

    if (groupedCards && groupedCards.length > 0) {
        const groupedDiv = document.createElement('div');
        groupedDiv.className = 'grouped-cards mt-2';
        groupedCards.forEach(groupedCard => {
            const groupedCardDiv = document.createElement('div');
            groupedCardDiv.className = 'text-sm opacity-80 pl-2 border-l-2 border-purple-500 mt-2';
            groupedCardDiv.textContent = `${groupedCard.content} (by ${groupedCard.author})`;
            groupedDiv.appendChild(groupedCardDiv);
        });
        card.appendChild(groupedDiv);
    }

    textarea.addEventListener('input', () => autoResize(textarea));
    setTimeout(() => autoResize(textarea), 0);

    return card;
}

function addCard(columnId) {
    // The server creates the card and replies with its id once it's on screen
    socket.emit('addCard', { column: columnId }, (cardId) => {
        const textarea = document.querySelector(`[data-id="${CSS.escape(cardId)}"] textarea`);
        if (textarea) textarea.focus();
    });
}

function submitCard(cardId, content) {
    if (!content.trim()) {
        alert('Please enter some content before submitting.');
        return;
    }
    
    socket.emit('submitCard', {
        cardId: cardId,
        content: content.trim()
    });
}

function deleteCard(cardId) {
    if (confirm('Are you sure you want to delete this card?')) {
        socket.emit('deleteCard', { cardId });
    }
}

function voteCard(cardId) {
    socket.emit('voteCard', { cardId });
}

function resetRetro() {
    if (confirm('Are you sure you want to reset the retro? This will clear all cards for everyone.')) {
        socket.emit('resetRetro');
    }
}

function groupSimilarCards() {
    socket.emit('groupSimilarCards');
}

function autoResize(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
}

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server, joining room:', roomId);
    socket.emit('joinRetro', { room: roomId, name: userName });
    document.getElementById('loading-overlay').style.display = 'none';
    updateRoomDisplay();
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('loading-overlay').textContent = 'Reconnecting...';
});

socket.on('connect_error', (error) => {
    if (error.message === 'unauthorized') {
        redirectToAccessForm();
        return;
    }
    console.error('Socket error:', error);
    document.getElementById('loading-overlay').textContent = 'Connection error. Please refresh the page.';
});

socket.on('loadCards', ({ cards }) => {
    console.log('Received cards update:', cards.length);
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

// Card display update
function updateCardsDisplay(cards) {
    // Keep anything typed into unsubmitted cards across re-renders
    const drafts = new Map();
    let focusedId = null;
    document.querySelectorAll('.card[data-id] textarea:not(:disabled)').forEach(textarea => {
        const id = textarea.closest('.card').dataset.id;
        drafts.set(id, textarea.value);
        if (document.activeElement === textarea) focusedId = id;
    });

    ['went-well', 'improve', 'action-items'].forEach(columnId => {
        const column = document.getElementById(columnId);
        column.innerHTML = '';
        cards
            .filter(card => card.column === columnId)
            .sort((a, b) => b.votes - a.votes)
            .forEach(card => {
                column.appendChild(createCard(
                    card.isSubmitted ? card.content : (drafts.get(card.id) ?? card.content),
                    card.id,
                    card.votes,
                    card.author,
                    card.groupedCards,
                    card.isSubmitted
                ));
            });
    });

    document.querySelectorAll('textarea').forEach(autoResize);

    if (focusedId) {
        const textarea = document.querySelector(`[data-id="${CSS.escape(focusedId)}"] textarea`);
        if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
    }
}

// Initialize drag and drop
const drake = dragula([
    document.getElementById('went-well'),
    document.getElementById('improve'),
    document.getElementById('action-items')
], {
    moves: function (el, container, handle) {
        return !handle.classList.contains('vote-count') && 
               !handle.classList.contains('material-icons') &&
               el.querySelector('textarea').disabled;
    }
}).on('drop', function (el, target, source) {
    socket.emit('moveCard', {
        cardId: el.dataset.id,
        newColumn: target.id
    });
});