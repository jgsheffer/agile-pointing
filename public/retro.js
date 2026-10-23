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

const COLUMNS = [
    { id: 'went-well', title: 'What Went Well?', emoji: '🎉', color: 'text-green-400', empty: 'Wins, big and small' },
    { id: 'improve', title: 'What Could Be Improved?', emoji: '🤔', color: 'text-yellow-400', empty: 'What slowed us down?' },
    { id: 'action-items', title: 'Action Items', emoji: '📋', color: 'text-blue-400', empty: 'What will we try next?' },
    { id: 'kudos', title: 'Kudos', emoji: '🙌', color: 'text-pink-400', empty: 'Shout out a teammate' }
];
const NOTE_COLORS = {
    yellow: '#fde68a', green: '#a7f3d0', blue: '#bfdbfe',
    pink: '#fbcfe8', purple: '#ddd6fe', orange: '#fed7aa'
};
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_IMAGE_SIDE = 1200;
const DRAG_THRESHOLD = 4;

// Core variables
let userName = '';
let participants = new Set();
let timer = null;
let selectedColor = 'yellow';
let lastColumn = 'went-well';
const cards = new Map();        // id -> card data from the server
const cardElements = new Map(); // id -> element on the board

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

function toast(message) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

// Room display functions
function updateRoomDisplay() {
    const roomDisplay = document.getElementById('room-id-display');
    if (roomDisplay) {
        roomDisplay.textContent = roomId;
    }
    // Same room name on the pointing page, so the team stays together
    document.getElementById('nav-pointing').href = `/?room=${encodeURIComponent(roomId)}`;
}

function copyRoomLink() {
    const roomLink = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    navigator.clipboard.writeText(roomLink).then(() => {
        const icon = document.querySelector('#copy-link-btn .material-icons');
        icon.textContent = 'check';
        setTimeout(() => {
            icon.textContent = 'link';
        }, 2000);
    });
}

// ---------- Board setup ----------

function iconButton(icon, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn';
    button.title = label;
    button.setAttribute('aria-label', label);
    const span = document.createElement('span');
    span.className = 'material-icons';
    span.textContent = icon;
    button.appendChild(span);
    button.addEventListener('click', onClick);
    return button;
}

function buildBoard() {
    const board = document.getElementById('board');
    for (const column of COLUMNS) {
        const section = document.createElement('section');
        section.className = 'board-column glass p-4';

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between gap-2 mb-3';
        const title = document.createElement('h2');
        title.className = `text-lg font-bold ${column.color}`;
        title.textContent = `${column.title} ${column.emoji}`;
        const actions = document.createElement('div');
        actions.className = 'flex';
        actions.append(
            iconButton('note_add', `Add a note to ${column.title}`, () => addCard(column.id)),
            iconButton('image', `Add an image to ${column.title}`, () => pickImages(column.id)),
            iconButton('brush', `Sketch for ${column.title}`, () => openSketch(column.id))
        );
        header.append(title, actions);

        const surface = document.createElement('div');
        surface.className = 'column-surface';
        surface.id = column.id;
        surface.dataset.column = column.id;
        const empty = document.createElement('div');
        empty.className = 'column-empty';
        empty.textContent = column.empty;
        surface.appendChild(empty);
        surface.addEventListener('pointerenter', () => { lastColumn = column.id; });

        section.append(header, surface);
        board.appendChild(section);

        const option = document.createElement('option');
        option.value = column.id;
        option.textContent = column.title;
        document.getElementById('sketch-column').appendChild(option);
    }

    const pad = document.getElementById('sticky-pad');
    for (const [color, hex] of Object.entries(NOTE_COLORS)) {
        const note = document.createElement('button');
        note.type = 'button';
        note.className = 'pad-note';
        note.style.background = hex;
        note.dataset.color = color;
        note.title = `Drag a ${color} sticky onto the board (click to make it the default)`;
        note.setAttribute('aria-label', `${color} sticky note`);
        note.addEventListener('pointerdown', (event) => startPadDrag(event, color));
        note.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectColor(color);
                addCard(lastColumn);
            }
        });
        pad.appendChild(note);
    }
    selectColor(selectedColor);

    // Positions are stored relative to the column width, so re-layout on resize
    const observer = new ResizeObserver(() => layoutAll());
    document.querySelectorAll('.column-surface').forEach(surface => observer.observe(surface));
}

function selectColor(color) {
    selectedColor = color;
    document.querySelectorAll('.pad-note').forEach(note => {
        note.classList.toggle('selected', note.dataset.color === color);
    });
}

const surfaces = () => [...document.querySelectorAll('.column-surface')];
const surfaceFor = column => document.getElementById(column);

function surfaceAt(clientX, clientY) {
    return surfaces().find(surface => {
        const rect = surface.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }) ?? null;
}

// Board coordinates for an item whose top-left corner is at (left, top) on screen
function boardPosition(surface, left, top, width) {
    const rect = surface.getBoundingClientRect();
    const travel = Math.max(1, rect.width - width);
    return {
        column: surface.dataset.column,
        x: Math.min(1, Math.max(0, (left - rect.left) / travel)),
        y: Math.max(0, Math.round(top - rect.top))
    };
}

// Somewhere below everything already in the column
function freeSpot(column) {
    let bottom = 12;
    for (const card of cards.values()) {
        if (card.column !== column) continue;
        const el = cardElements.get(card.id);
        bottom = Math.max(bottom, card.y + (el?.offsetHeight ?? 120) + 14);
    }
    return { column, x: Math.random() * 0.2, y: bottom };
}

// ---------- Layout ----------

function layoutCard(el, card) {
    const surface = surfaceFor(card.column);
    if (!surface) return;
    if (el.parentElement !== surface) surface.appendChild(el);
    const travel = Math.max(0, surface.clientWidth - el.offsetWidth);
    el.style.left = `${Math.round(card.x * travel)}px`;
    el.style.top = `${card.y}px`;
    el.style.zIndex = card.z;
}

function updateSurfaceHeights() {
    for (const surface of surfaces()) {
        let bottom = 0;
        surface.querySelectorAll('.board-item').forEach(el => {
            bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
        });
        surface.style.height = `${Math.max(420, bottom + 40)}px`;
        surface.querySelector('.column-empty').classList.toggle('hidden', bottom > 0);
    }
}

function layoutAll() {
    for (const [id, el] of cardElements) {
        if (!el.classList.contains('dragging')) layoutCard(el, cards.get(id));
    }
    updateSurfaceHeights();
}

// ---------- Cards ----------

function createCardElement(card) {
    const el = document.createElement('div');
    el.className = 'board-item';
    el.dataset.id = card.id;
    el.addEventListener('pointerdown', event => startItemDrag(event, el));
    el.addEventListener('animationend', () => el.classList.remove('landed'));
    return el;
}

function createFooter(card) {
    const footer = document.createElement('div');
    footer.className = 'item-footer';
    const author = document.createElement('span');
    author.className = 'item-author';
    author.textContent = card.author;
    const actions = document.createElement('div');
    actions.className = 'item-actions';

    if (card.isSubmitted) {
        const voteBtn = document.createElement('button');
        voteBtn.type = 'button';
        voteBtn.className = 'vote-count';
        voteBtn.classList.toggle('voted', card.voters.includes(userName));
        voteBtn.textContent = `👍 ${card.votes}`;
        voteBtn.setAttribute('aria-label', `Vote (${card.votes} votes)`);
        voteBtn.addEventListener('click', () => voteCard(card.id));
        actions.appendChild(voteBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'material-icons delete-btn';
    deleteBtn.textContent = 'delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.addEventListener('click', () => deleteCard(card.id));
    actions.appendChild(deleteBtn);

    footer.append(author, actions);
    return footer;
}

function renderNote(el, card) {
    el.className = `board-item note color-${card.color}`;
    const draft = el.querySelector('textarea');
    const isMine = card.author === userName;

    // Keep the textarea (and whatever's typed in it) while the draft is open
    if (!card.isSubmitted && isMine && draft) {
        el.querySelector('.item-footer').replaceWith(createFooter(card));
        return;
    }

    el.innerHTML = '';
    if (!card.isSubmitted && isMine) {
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Type your thoughts, then Submit (Ctrl+Enter)';
        textarea.maxLength = 2000;
        textarea.value = card.content;
        textarea.addEventListener('keydown', event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                submitCard(card.id, textarea.value);
            }
        });
        const submitBtn = document.createElement('button');
        submitBtn.type = 'button';
        submitBtn.className = 'submit-button';
        submitBtn.innerHTML = '<span class="material-icons text-base">send</span>Submit';
        submitBtn.addEventListener('click', () => submitCard(card.id, textarea.value));
        el.append(textarea, submitBtn);
    } else if (!card.isSubmitted) {
        const writing = document.createElement('div');
        writing.className = 'note-writing';
        writing.textContent = `✍️ ${card.author} is writing…`;
        el.appendChild(writing);
    } else {
        const text = document.createElement('div');
        text.className = 'note-text';
        text.textContent = card.content;
        el.appendChild(text);
    }

    if (card.groupedCards && card.groupedCards.length > 0) {
        const groupedDiv = document.createElement('div');
        groupedDiv.className = 'grouped-cards';
        card.groupedCards.forEach(groupedCard => {
            const groupedCardDiv = document.createElement('div');
            groupedCardDiv.textContent = `${groupedCard.content} (by ${groupedCard.author})`;
            groupedDiv.appendChild(groupedCardDiv);
        });
        el.appendChild(groupedDiv);
    }

    el.appendChild(createFooter(card));
}

function renderMedia(el, card) {
    el.className = `board-item media ${card.type}`;
    let img = el.querySelector('img');
    if (!img) {
        el.innerHTML = '';
        img = document.createElement('img');
        img.alt = card.type === 'sketch' ? `Sketch by ${card.author}` : `Image from ${card.author}`;
        img.draggable = false;
        img.addEventListener('load', updateSurfaceHeights);
        img.src = `/api/retro-images/${encodeURIComponent(card.imageId)}`;
        el.append(img, createFooter(card));
    } else {
        el.querySelector('.item-footer').replaceWith(createFooter(card));
    }
}

function upsertCard(card, { landed = false } = {}) {
    cards.set(card.id, card);
    let el = cardElements.get(card.id);
    if (!el) {
        el = createCardElement(card);
        cardElements.set(card.id, el);
        landed = true;
    }
    const keepClasses = el.classList.contains('dragging') ? ['dragging'] : [];
    if (card.type === 'note') {
        renderNote(el, card);
    } else {
        renderMedia(el, card);
    }
    el.classList.add(...keepClasses);
    if (landed) el.classList.add('landed');

    if (!el.classList.contains('dragging')) layoutCard(el, card);
    updateSurfaceHeights();
}

function removeCard(cardId) {
    cards.delete(cardId);
    cardElements.get(cardId)?.remove();
    cardElements.delete(cardId);
    updateSurfaceHeights();
}

function loadAllCards(allCards) {
    const incoming = new Set(allCards.map(card => card.id));
    for (const id of [...cardElements.keys()]) {
        if (!incoming.has(id)) removeCard(id);
    }
    allCards.forEach(card => upsertCard(card));
}

function addCard(column, position = freeSpot(column)) {
    socket.emit('addCard', { ...position, column, color: selectedColor }, cardId => {
        const textarea = cardElements.get(cardId)?.querySelector('textarea');
        if (textarea) textarea.focus();
    });
}

function submitCard(cardId, content) {
    if (!content.trim()) {
        toast('Write something first ✍️');
        return;
    }
    socket.emit('submitCard', { cardId, content: content.trim() });
}

function deleteCard(cardId) {
    if (confirm('Are you sure you want to delete this?')) {
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

// ---------- Dragging ----------

// Shared pointer-drag: the element follows the pointer, then onDrop gets the
// surface under the pointer (or null) and the element's final screen rect.
function followPointer(event, el, { onStart, onDrop }) {
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = el.getBoundingClientRect();
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    let dragging = false;
    let hovered = null;

    const move = moveEvent => {
        if (!dragging) {
            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
            dragging = true;
            onStart?.();
            el.style.width = `${rect.width}px`;
            el.style.position = 'fixed';
            el.classList.add('dragging');
            document.body.appendChild(el);
        }
        el.style.left = `${moveEvent.clientX - offsetX}px`;
        el.style.top = `${moveEvent.clientY - offsetY}px`;

        const surface = surfaceAt(moveEvent.clientX, moveEvent.clientY);
        if (surface !== hovered) {
            hovered?.classList.remove('drop-target');
            surface?.classList.add('drop-target');
            hovered = surface;
        }
    };

    const end = endEvent => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        hovered?.classList.remove('drop-target');
        if (!dragging) {
            onDrop(null, null, false);
            return;
        }
        const finalRect = el.getBoundingClientRect();
        el.classList.remove('dragging');
        el.style.position = '';
        el.style.width = '';
        onDrop(surfaceAt(endEvent.clientX, endEvent.clientY), finalRect, true);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
}

function startItemDrag(event, el) {
    if (event.button !== 0) return;
    if (event.target.closest('textarea, button, input, a')) return;
    const card = cards.get(el.dataset.id);
    if (!card) return;
    event.preventDefault();

    followPointer(event, el, {
        onDrop: (surface, rect, moved) => {
            if (!moved) return;
            if (!surface) {
                // Dropped outside the board: put it back
                layoutCard(el, card);
                updateSurfaceHeights();
                return;
            }
            const position = boardPosition(surface, rect.left, rect.top, rect.width);
            // Show it where it landed right away; the server confirms the move
            Object.assign(card, position, { z: card.z + 1000 });
            surface.appendChild(el);
            layoutCard(el, card);
            el.classList.add('landed');
            updateSurfaceHeights();
            socket.emit('moveCard', { cardId: card.id, ...position });
        }
    });
}

function startPadDrag(event, color) {
    if (event.button !== 0) return;
    event.preventDefault();
    const source = event.currentTarget;
    const ghost = document.createElement('div');
    ghost.className = `board-item note color-${color}`;
    ghost.innerHTML = '<div class="note-writing">New note…</div>';
    const rect = source.getBoundingClientRect();
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.position = 'fixed';
    ghost.style.visibility = 'hidden';
    document.body.appendChild(ghost);

    followPointer(event, ghost, {
        onStart: () => { ghost.style.visibility = ''; },
        onDrop: (surface, finalRect, moved) => {
            ghost.remove();
            selectColor(color);
            if (!moved) {
                toast('Drag the sticky onto a column - or use ➕ on a column');
                return;
            }
            if (!surface) return;
            addCard(surface.dataset.column, boardPosition(surface, finalRect.left, finalRect.top, finalRect.width));
        }
    });
}

// ---------- Images ----------

function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

// Shrink big images so they upload quickly and stay under the size limit
async function prepareImage(file) {
    if (file.type === 'image/gif' && file.size <= MAX_IMAGE_BYTES) return file;

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    for (const quality of [0.85, 0.7, 0.5]) {
        const blob = await canvasToBlob(canvas, 'image/webp', quality);
        if (blob && blob.type === 'image/webp' && blob.size <= MAX_IMAGE_BYTES) return blob;
    }
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.7);
    if (jpeg.size <= MAX_IMAGE_BYTES) return jpeg;
    throw new Error('Image is too large');
}

async function uploadImage(blob) {
    const response = await fetch(`/api/retro-images?room=${encodeURIComponent(roomId)}`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    return data.id;
}

async function addImageFiles(files, position) {
    const images = [...files].filter(file => file.type.startsWith('image/'));
    if (images.length === 0) {
        toast('Only images can be dropped on the board');
        return;
    }
    let spot = position;
    for (const file of images) {
        try {
            const imageId = await uploadImage(await prepareImage(file));
            const target = spot ?? freeSpot(position?.column ?? lastColumn);
            socket.emit('addImage', { imageId, type: 'image', ...target });
            spot = null; // later images stack below the first
        } catch (error) {
            console.error('Image upload failed:', error);
            toast(`Couldn't add ${file.name || 'that image'}: ${error.message}`);
        }
    }
}

let imageTargetColumn = 'went-well';

function pickImages(column) {
    imageTargetColumn = column;
    document.getElementById('image-input').click();
}

document.getElementById('image-input').addEventListener('change', event => {
    addImageFiles(event.target.files, freeSpot(imageTargetColumn));
    event.target.value = '';
});

const hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files');
let dropHighlight = null;

document.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const surface = surfaceAt(event.clientX, event.clientY);
    if (surface !== dropHighlight) {
        dropHighlight?.classList.remove('drop-target');
        surface?.classList.add('drop-target');
        dropHighlight = surface;
    }
});

document.addEventListener('dragleave', event => {
    if (event.relatedTarget === null) {
        dropHighlight?.classList.remove('drop-target');
        dropHighlight = null;
    }
});

document.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dropHighlight?.classList.remove('drop-target');
    dropHighlight = null;
    const surface = surfaceAt(event.clientX, event.clientY);
    const position = surface
        ? boardPosition(surface, event.clientX - 100, event.clientY - 20, 200)
        : freeSpot(lastColumn);
    addImageFiles(event.dataTransfer.files, position);
});

document.addEventListener('paste', event => {
    if (event.target.closest('textarea, input')) return;
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length > 0) {
        event.preventDefault();
        addImageFiles(files, freeSpot(lastColumn));
    }
});

// ---------- Sketch pad ----------

const SKETCH_COLORS = ['#111827', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const SKETCH_SIZES = [3, 7, 14];
const sketch = {
    canvas: document.getElementById('sketch-canvas'),
    strokes: [],
    current: null,
    color: SKETCH_COLORS[0],
    size: SKETCH_SIZES[1],
    eraser: false
};

function buildSketchTools() {
    const colors = document.getElementById('sketch-colors');
    for (const color of SKETCH_COLORS) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'swatch';
        swatch.style.background = color;
        swatch.dataset.color = color;
        swatch.setAttribute('aria-label', `Pen color ${color}`);
        swatch.addEventListener('click', () => {
            sketch.color = color;
            sketch.eraser = false;
            renderSketchTools();
        });
        colors.appendChild(swatch);
    }
    const sizes = document.getElementById('sketch-sizes');
    for (const size of SKETCH_SIZES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'size-btn';
        button.dataset.size = size;
        button.setAttribute('aria-label', `Pen size ${size}`);
        const dot = document.createElement('span');
        dot.style.width = `${size + 2}px`;
        dot.style.height = `${size + 2}px`;
        button.appendChild(dot);
        button.addEventListener('click', () => {
            sketch.size = size;
            renderSketchTools();
        });
        sizes.appendChild(button);
    }
    renderSketchTools();

    const canvas = sketch.canvas;
    const point = event => {
        const rect = canvas.getBoundingClientRect();
        return [
            ((event.clientX - rect.left) / rect.width) * canvas.width,
            ((event.clientY - rect.top) / rect.height) * canvas.height
        ];
    };
    canvas.addEventListener('pointerdown', event => {
        canvas.setPointerCapture(event.pointerId);
        sketch.current = {
            color: sketch.eraser ? '#ffffff' : sketch.color,
            size: sketch.eraser ? sketch.size * 3 : sketch.size,
            points: [point(event)]
        };
        sketch.strokes.push(sketch.current);
        drawSketch();
    });
    canvas.addEventListener('pointermove', event => {
        if (!sketch.current) return;
        sketch.current.points.push(point(event));
        drawSketch();
    });
    const finish = () => { sketch.current = null; };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
}

function renderSketchTools() {
    document.querySelectorAll('#sketch-colors .swatch').forEach(swatch => {
        swatch.classList.toggle('selected', !sketch.eraser && swatch.dataset.color === sketch.color);
    });
    document.querySelectorAll('#sketch-sizes .size-btn').forEach(button => {
        button.classList.toggle('selected', Number(button.dataset.size) === sketch.size);
    });
    document.getElementById('sketch-eraser').classList.toggle('active', sketch.eraser);
}

function drawSketch() {
    const ctx = sketch.canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sketch.canvas.width, sketch.canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of sketch.strokes) {
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        const [first, ...rest] = stroke.points;
        if (rest.length === 0) {
            ctx.beginPath();
            ctx.arc(first[0], first[1], stroke.size / 2, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }
        ctx.beginPath();
        ctx.moveTo(...first);
        rest.forEach(p => ctx.lineTo(...p));
        ctx.stroke();
    }
}

function toggleEraser() {
    sketch.eraser = !sketch.eraser;
    renderSketchTools();
}

function undoStroke() {
    sketch.strokes.pop();
    drawSketch();
}

function clearSketch() {
    sketch.strokes = [];
    drawSketch();
}

function openSketch(column) {
    document.getElementById('sketch-column').value = column;
    sketch.strokes = [];
    drawSketch();
    document.getElementById('sketch-modal').classList.remove('hidden');
}

function closeSketch() {
    document.getElementById('sketch-modal').classList.add('hidden');
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSketch();
});

async function saveSketch() {
    if (sketch.strokes.length === 0) {
        toast('Draw something first ✏️');
        return;
    }
    const button = document.getElementById('sketch-save');
    button.disabled = true;
    try {
        let blob = await canvasToBlob(sketch.canvas, 'image/webp', 0.9);
        if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(sketch.canvas, 'image/png');
        const imageId = await uploadImage(blob);
        const column = document.getElementById('sketch-column').value;
        socket.emit('addImage', { imageId, type: 'sketch', ...freeSpot(column) });
        closeSketch();
    } catch (error) {
        console.error('Sketch upload failed:', error);
        toast(`Couldn't pin the sketch: ${error.message}`);
    } finally {
        button.disabled = false;
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
                toast('⏰ Time is up!');
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

socket.on('loadCards', ({ cards: allCards }) => loadAllCards(allCards));
socket.on('cardUpserted', ({ card }) => upsertCard(card));
socket.on('cardRemoved', ({ cardId }) => removeCard(cardId));

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

buildBoard();
buildSketchTools();
