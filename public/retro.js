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
const DEFAULT_ITEM_WIDTH = 220;
const MIN_ITEM_WIDTH = 120;
const MIN_ITEM_HEIGHT = 80;
const MAX_ITEM_SIZE = 4000;
const BOARD_MARGIN = 800; // empty canvas kept beyond the furthest item

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
        section.className = 'board-column';
        section.dataset.column = column.id;

        const header = document.createElement('div');
        header.className = 'column-header';
        header.dataset.column = column.id;

        // Optional banner image set by anyone in the room
        const banner = document.createElement('div');
        banner.className = 'column-banner hidden';
        const bannerImg = document.createElement('img');
        bannerImg.alt = `${column.title} header image`;
        bannerImg.draggable = false;
        const bannerActions = document.createElement('div');
        bannerActions.className = 'banner-actions';
        bannerActions.append(
            iconButton('wallpaper', 'Change header image', () => pickHeaderImage(column.id)),
            iconButton('hide_image', 'Remove header image', () => removeHeaderImage(column.id))
        );
        banner.append(bannerImg, bannerActions);

        const titleRow = document.createElement('div');
        titleRow.className = 'flex items-center justify-between gap-2';
        const title = document.createElement('h2');
        title.className = `font-bold ${column.color}`;
        title.textContent = `${column.title} ${column.emoji}`;
        const actions = document.createElement('div');
        actions.className = 'flex';
        actions.append(
            iconButton('note_add', `Add a note to ${column.title}`, () => addCard(column.id)),
            iconButton('image', `Add an image to ${column.title}`, () => pickImages(column.id)),
            iconButton('brush', 'Draw on the board', () => startDrawing()),
            iconButton('wallpaper', `Set a header image for ${column.title}`, () => pickHeaderImage(column.id))
        );
        titleRow.append(title, actions);
        header.append(banner, titleRow);

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
}

function selectColor(color) {
    selectedColor = color;
    document.querySelectorAll('.pad-note').forEach(note => {
        note.classList.toggle('selected', note.dataset.color === color);
    });
}

const viewport = document.getElementById('board-viewport');
const world = document.getElementById('board-world');
const itemsLayer = document.getElementById('items-layer');
const surfaces = () => [...document.querySelectorAll('.column-surface')];
const surfaceFor = column => document.getElementById(column);

// The board is drawn in "world" pixels and scaled/panned with a CSS
// transform. Items are positioned in world pixels anywhere on the board;
// their column is whichever column they were dropped on (or none).
function worldOffset(el) {
    let x = 0;
    let y = 0;
    for (let node = el; node && node !== world; node = node.offsetParent) {
        x += node.offsetLeft;
        y += node.offsetTop;
    }
    return { x, y };
}

function screenToWorld(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return {
        x: (clientX - rect.left - view.x) / view.scale,
        y: (clientY - rect.top - view.y) / view.scale
    };
}

function insideViewport(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function elementAt(elements, clientX, clientY) {
    if (!insideViewport(clientX, clientY)) return null;
    const point = screenToWorld(clientX, clientY);
    return elements.find(el => {
        const offset = worldOffset(el);
        return point.x >= offset.x && point.x <= offset.x + el.offsetWidth &&
            point.y >= offset.y && point.y <= offset.y + el.offsetHeight;
    }) ?? null;
}

// The whole column (header included) counts when dropping things on it
const columnAt = (clientX, clientY) =>
    elementAt([...document.querySelectorAll('.board-column')], clientX, clientY)?.dataset.column ?? null;
const headerAt = (clientX, clientY) =>
    elementAt([...document.querySelectorAll('.column-header')], clientX, clientY);

// Where an item lands when its top-left corner is at a world point
function spotAt(clientX, clientY, left, top) {
    return {
        column: columnAt(clientX, clientY),
        x: Math.max(0, Math.round(left)),
        y: Math.max(0, Math.round(top))
    };
}

// Last place the pointer was over the board, for pasted images
let lastPointer = null;
viewport.addEventListener('pointermove', event => {
    lastPointer = { x: event.clientX, y: event.clientY };
});

// Middle of what you're looking at (or the last pointer spot on the board)
function spotInView() {
    const rect = viewport.getBoundingClientRect();
    const target = lastPointer && insideViewport(lastPointer.x, lastPointer.y)
        ? lastPointer
        : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const point = screenToWorld(target.x, target.y);
    return spotAt(target.x, target.y, point.x - DEFAULT_ITEM_WIDTH / 2, point.y - 40);
}

// Below everything already in a column, or in view for the open board
function freeSpot(column) {
    const surface = column && surfaceFor(column);
    if (!surface) return spotInView();
    const offset = worldOffset(surface);
    let bottom = offset.y + 16;
    for (const card of cards.values()) {
        if (card.column !== column) continue;
        const el = cardElements.get(card.id);
        bottom = Math.max(bottom, card.y + (el?.offsetHeight ?? 120) + 16);
    }
    return { column, x: Math.round(offset.x + 16 + Math.random() * 120), y: Math.round(bottom) };
}

// ---------- Layout ----------

function layoutCard(el, card) {
    if (el.parentElement !== itemsLayer) itemsLayer.appendChild(el);
    el.style.left = `${card.x}px`;
    el.style.top = `${card.y}px`;
    el.style.zIndex = card.z;
    if (!el.classList.contains('resizing')) {
        el.style.width = card.w ? `${card.w}px` : '';
        el.style.height = card.type === 'note' && card.h ? `${card.h}px` : '';
    }
}

// Columns grow to hold their items, and the board grows past the furthest one
function updateSurfaceHeights() {
    const bottoms = new Map();
    let right = 0;
    let bottom = 0;
    for (const [id, el] of cardElements) {
        const card = cards.get(id);
        const itemBottom = el.offsetTop + el.offsetHeight;
        right = Math.max(right, el.offsetLeft + el.offsetWidth);
        bottom = Math.max(bottom, itemBottom);
        if (card?.column) bottoms.set(card.column, Math.max(bottoms.get(card.column) ?? 0, itemBottom));
    }
    for (const surface of surfaces()) {
        const columnBottom = bottoms.get(surface.dataset.column);
        const top = worldOffset(surface).y;
        const needed = columnBottom ? columnBottom - top + 400 : 0;
        surface.style.height = `${Math.max(900, needed)}px`;
        surface.querySelector('.column-empty').classList.toggle('hidden', Boolean(columnBottom));
    }
    const columns = document.getElementById('board');
    world.style.width = `${Math.max(worldOffset(columns).x + columns.offsetWidth + BOARD_MARGIN, right + BOARD_MARGIN)}px`;
    world.style.height = `${Math.max(2400, bottom + BOARD_MARGIN)}px`;
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

// Bottom-right handle; notes resize freely, images keep their aspect ratio
function ensureResizeHandle(el) {
    if (el.querySelector(':scope > .resize-handle')) return;
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.title = 'Drag to resize';
    handle.addEventListener('pointerdown', event => startResize(event, el));
    el.appendChild(handle);
}

function startResize(event, el) {
    if (event.button !== 0) return;
    const card = cards.get(el.dataset.id);
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();

    const isNote = card.type === 'note';
    const start = { x: event.clientX, y: event.clientY, w: el.offsetWidth, h: el.offsetHeight };
    const clampSize = (value, min) => Math.round(Math.min(MAX_ITEM_SIZE, Math.max(min, value)));
    el.classList.add('resizing');

    const move = moveEvent => {
        const w = clampSize(start.w + (moveEvent.clientX - start.x) / view.scale, MIN_ITEM_WIDTH);
        el.style.width = `${w}px`;
        if (isNote) {
            el.style.height = `${clampSize(start.h + (moveEvent.clientY - start.y) / view.scale, MIN_ITEM_HEIGHT)}px`;
        }
    };
    const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        el.classList.remove('resizing');
        card.w = el.offsetWidth;
        card.h = isNote ? el.offsetHeight : null;
        updateSurfaceHeights();
        socket.emit('resizeCard', { cardId: card.id, w: card.w, h: card.h });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
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

// A small tilt that stays the same for each photo
function tiltFor(id) {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return ((Math.abs(hash) % 70) - 35) / 10; // -3.5deg .. 3.5deg
}

function renderMedia(el, card) {
    el.className = `board-item media ${card.type}`;
    if (card.type === 'image') el.style.setProperty('--tilt', `${tiltFor(card.id)}deg`);
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
    ensureResizeHandle(el);

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

// With no position the app picks a spot (and pans to it); a dropped note
// keeps exactly the spot it was dropped on and the view stays put
function addCard(column, position = null) {
    const spot = position ?? freeSpot(column);
    socket.emit('addCard', { ...spot, color: selectedColor }, cardId => {
        const el = cardElements.get(cardId);
        if (!el) return;
        if (!position) bringIntoView(el);
        el.querySelector('textarea')?.focus({ preventScroll: true });
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

// Moves an element around the board under the pointer, then calls onDrop
// with the element's world spot (null if it was dropped off the board).
function dragInWorld(event, el, { grab, onStart, onDrop }) {
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let hovered = null;

    const move = moveEvent => {
        if (!dragging) {
            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
            dragging = true;
            onStart?.();
            el.classList.add('dragging');
            if (el.parentElement !== itemsLayer) itemsLayer.appendChild(el);
        }
        const point = screenToWorld(moveEvent.clientX, moveEvent.clientY);
        el.style.left = `${point.x - grab.x}px`;
        el.style.top = `${point.y - grab.y}px`;

        const column = columnAt(moveEvent.clientX, moveEvent.clientY);
        const surface = column && surfaceFor(column);
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
            onDrop(null, false);
            return;
        }
        el.classList.remove('dragging');
        const onBoard = insideViewport(endEvent.clientX, endEvent.clientY);
        const spot = onBoard
            ? spotAt(endEvent.clientX, endEvent.clientY, parseFloat(el.style.left), parseFloat(el.style.top))
            : null;
        onDrop(spot, true);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
}

function startItemDrag(event, el) {
    if (event.button !== 0) return;
    if (event.target.closest('textarea, button, input, a, .resize-handle')) return;
    const card = cards.get(el.dataset.id);
    if (!card) return;
    event.preventDefault();
    event.stopPropagation(); // don't pan the board as well

    const point = screenToWorld(event.clientX, event.clientY);
    dragInWorld(event, el, {
        grab: { x: point.x - card.x, y: point.y - card.y },
        onDrop: (spot, moved) => {
            if (!moved) return;
            if (!spot) {
                // Dropped off the board (e.g. on the toolbar): put it back
                layoutCard(el, card);
                return;
            }
            // Show it where it landed right away; the server confirms the move
            Object.assign(card, spot, { z: card.z + 1000 });
            layoutCard(el, card);
            el.classList.add('landed');
            updateSurfaceHeights();
            socket.emit('moveCard', { cardId: card.id, ...spot });
        }
    });
}

function startPadDrag(event, color) {
    if (event.button !== 0) return;
    event.preventDefault();
    const ghost = document.createElement('div');
    ghost.className = `board-item note color-${color}`;
    ghost.innerHTML = '<div class="note-writing">New note…</div>';
    ghost.style.visibility = 'hidden';

    dragInWorld(event, ghost, {
        grab: { x: DEFAULT_ITEM_WIDTH / 2, y: 24 },
        onStart: () => { ghost.style.visibility = ''; },
        onDrop: (spot, moved) => {
            ghost.remove();
            selectColor(color);
            if (!moved) {
                toast('Drag the sticky anywhere on the board - or use ➕ on a column');
                return;
            }
            if (spot) addCard(spot.column, spot);
        }
    });
}

// ---------- Zoom & pan ----------

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;
const VIEW_KEY = `retroView:${roomId}`;
const view = { x: 0, y: 0, scale: 1 };
const clampZoom = scale => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    renderDrawing();
    document.getElementById('zoom-level').textContent = `${Math.round(view.scale * 100)}%`;
    try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
        // Not remembered, still works for this visit
    }
}

// Zoom around a screen point so whatever is under it stays put
function zoomAt(clientX, clientY, factor) {
    const rect = viewport.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const next = clampZoom(view.scale * factor);
    const ratio = next / view.scale;
    view.x = cx - (cx - view.x) * ratio;
    view.y = cy - (cy - view.y) * ratio;
    view.scale = next;
    applyView();
}

function viewportCenter() {
    const rect = viewport.getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
}

function zoomBy(factor) {
    zoomAt(...viewportCenter(), factor);
}

function setZoom(scale) {
    zoomAt(...viewportCenter(), scale / view.scale);
}

// Fit the columns plus a strip of open canvas on each side, so it's clear
// there's room to put things outside the columns too
function fitBoard() {
    const columns = document.getElementById('board');
    const offset = worldOffset(columns);
    const margin = 240;
    const width = columns.offsetWidth + margin * 2;
    view.scale = clampZoom(Math.min(1, (viewport.clientWidth - 32) / width));
    view.x = (viewport.clientWidth - columns.offsetWidth * view.scale) / 2 - offset.x * view.scale;
    view.y = 24 - (offset.y - 80) * view.scale;
    applyView();
}

// Pan so an element is on screen (used for newly added notes)
function bringIntoView(el) {
    const offset = worldOffset(el);
    const left = offset.x * view.scale + view.x;
    const top = offset.y * view.scale + view.y;
    const right = left + el.offsetWidth * view.scale;
    const bottom = top + el.offsetHeight * view.scale;
    if (left >= 0 && top >= 0 && right <= viewport.clientWidth && bottom <= viewport.clientHeight) return;
    view.x = viewport.clientWidth / 2 - (offset.x + el.offsetWidth / 2) * view.scale;
    view.y = viewport.clientHeight / 3 - offset.y * view.scale;
    applyView();
}

function initViewport() {
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(VIEW_KEY));
    } catch {
        saved = null;
    }
    if (saved && [saved.x, saved.y, saved.scale].every(Number.isFinite)) {
        Object.assign(view, saved, { scale: clampZoom(saved.scale) });
        applyView();
    } else {
        fitBoard();
    }

    // The browser can scroll the (overflow: hidden) viewport itself, e.g. to
    // show a text cursor; fold that into the pan so the board never jumps
    viewport.addEventListener('scroll', () => {
        if (viewport.scrollLeft === 0 && viewport.scrollTop === 0) return;
        view.x -= viewport.scrollLeft;
        view.y -= viewport.scrollTop;
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
        applyView();
    });

    // The scroll wheel zooms (trackpad pinches arrive as ctrl+wheel)
    viewport.addEventListener('wheel', event => {
        event.preventDefault();
        const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
        zoomAt(event.clientX, event.clientY, Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });

    // Drag empty space (or use the middle button anywhere) to pan; pinch to zoom on touch
    const pointers = new Map();
    let pan = null;
    let pinch = null;

    viewport.addEventListener('pointerdown', event => {
        const onControl = event.target.closest('.board-item, .resize-handle, button, textarea, input, select, a, .zoom-controls, .draw-toolbar');
        if (event.button === 2 || (event.button === 0 && onControl)) return;
        event.preventDefault();
        viewport.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = {
                distance: Math.hypot(a.x - b.x, a.y - b.y),
                mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
            };
            pan = null;
        } else {
            pan = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
            viewport.classList.add('panning');
        }
    });

    viewport.addEventListener('pointermove', event => {
        if (!pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pinch && pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            view.x += mid.x - pinch.mid.x;
            view.y += mid.y - pinch.mid.y;
            zoomAt(mid.x, mid.y, distance / pinch.distance);
            pinch = { distance, mid };
        } else if (pan) {
            view.x = pan.viewX + event.clientX - pan.x;
            view.y = pan.viewY + event.clientY - pan.y;
            applyView();
        }
    });

    const release = event => {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 0) {
            pan = null;
            viewport.classList.remove('panning');
        }
    };
    viewport.addEventListener('pointerup', release);
    viewport.addEventListener('pointercancel', release);

    document.addEventListener('keydown', event => {
        if (event.target.closest('textarea, input, select') || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === '+' || event.key === '=') zoomBy(1.25);
        else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.25);
        else if (event.key === '0') fitBoard();
        else if (event.key === '1') setZoom(1);
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
    for (const [index, file] of images.entries()) {
        try {
            const imageId = await uploadImage(await prepareImage(file));
            // Several images fan out a little so they don't hide each other
            const spot = { ...position, x: position.x + index * 40, y: position.y + index * 40 };
            socket.emit('addImage', { imageId, type: 'image', ...spot });
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

function highlightDrop(target) {
    if (target === dropHighlight) return;
    dropHighlight?.classList.remove('drop-target');
    target?.classList.add('drop-target');
    dropHighlight = target;
}

document.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const header = headerAt(event.clientX, event.clientY);
    const column = columnAt(event.clientX, event.clientY);
    highlightDrop(header ?? (column && surfaceFor(column)));
});

document.addEventListener('dragleave', event => {
    if (event.relatedTarget === null) highlightDrop(null);
});

// Files dragged in from the desktop/file explorer land where they're dropped
document.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    highlightDrop(null);

    // Dropping on a column header sets its banner image
    const header = headerAt(event.clientX, event.clientY);
    if (header) {
        const image = [...event.dataTransfer.files].find(file => file.type.startsWith('image/'));
        if (image) setHeaderImage(header.dataset.column, image);
        return;
    }

    let position = spotInView();
    if (insideViewport(event.clientX, event.clientY)) {
        const point = screenToWorld(event.clientX, event.clientY);
        position = spotAt(event.clientX, event.clientY, point.x - DEFAULT_ITEM_WIDTH / 2, point.y - 30);
    }
    addImageFiles(event.dataTransfer.files, position);
});

document.addEventListener('paste', event => {
    if (event.target.closest('textarea, input')) return;
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length > 0) {
        event.preventDefault();
        addImageFiles(files, spotInView());
    }
});

// ---------- Column header images ----------

let headerTargetColumn = null;

function pickHeaderImage(column) {
    headerTargetColumn = column;
    document.getElementById('header-image-input').click();
}

document.getElementById('header-image-input').addEventListener('change', event => {
    const [file] = event.target.files;
    if (file && headerTargetColumn) setHeaderImage(headerTargetColumn, file);
    event.target.value = '';
});

async function setHeaderImage(column, file) {
    try {
        const imageId = await uploadImage(await prepareImage(file));
        socket.emit('setColumnImage', { column, imageId });
    } catch (error) {
        console.error('Header image upload failed:', error);
        toast(`Couldn't set the header image: ${error.message}`);
    }
}

function removeHeaderImage(column) {
    socket.emit('setColumnImage', { column, imageId: null });
}

function renderHeaders(headers) {
    for (const column of COLUMNS) {
        const banner = document.querySelector(`.column-header[data-column="${column.id}"] .column-banner`);
        const img = banner.querySelector('img');
        const imageId = headers[column.id];
        if (imageId) {
            const src = `/api/retro-images/${encodeURIComponent(imageId)}`;
            if (img.getAttribute('src') !== src) img.src = src;
            banner.classList.remove('hidden');
        } else {
            img.removeAttribute('src');
            banner.classList.add('hidden');
        }
    }
}

// ---------- Drawing on the board ----------

const DRAW_COLORS = ['#111827', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const DRAW_SIZES = [3, 7, 14]; // on-screen pixels, so pens feel the same at any zoom
const drawLayer = document.getElementById('draw-layer');
const drawing = {
    active: false,
    saving: false,
    strokes: [], // { color, size, erase, points: [[x, y], ...] } in world pixels
    current: null,
    color: DRAW_COLORS[2],
    size: DRAW_SIZES[1],
    eraser: false
};

function buildDrawTools() {
    const colors = document.getElementById('draw-colors');
    for (const color of DRAW_COLORS) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'swatch';
        swatch.style.background = color;
        swatch.dataset.color = color;
        swatch.setAttribute('aria-label', `Pen color ${color}`);
        swatch.addEventListener('click', () => {
            drawing.color = color;
            drawing.eraser = false;
            renderDrawTools();
        });
        colors.appendChild(swatch);
    }
    const sizes = document.getElementById('draw-sizes');
    for (const size of DRAW_SIZES) {
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
            drawing.size = size;
            renderDrawTools();
        });
        sizes.appendChild(button);
    }
    renderDrawTools();

    drawLayer.addEventListener('pointerdown', event => {
        // Middle-button drags fall through to the board so you can still pan
        if (event.button !== 0 || drawing.saving) return;
        event.preventDefault();
        event.stopPropagation();
        drawLayer.setPointerCapture(event.pointerId);
        const point = screenToWorld(event.clientX, event.clientY);
        drawing.current = {
            color: drawing.color,
            size: (drawing.eraser ? drawing.size * 3 : drawing.size) / view.scale,
            erase: drawing.eraser,
            points: [[point.x, point.y]]
        };
        drawing.strokes.push(drawing.current);
        renderDrawing();
    });
    drawLayer.addEventListener('pointermove', event => {
        if (!drawing.current) return;
        const point = screenToWorld(event.clientX, event.clientY);
        drawing.current.points.push([point.x, point.y]);
        renderDrawing();
    });
    const finish = () => { drawing.current = null; };
    drawLayer.addEventListener('pointerup', finish);
    drawLayer.addEventListener('pointercancel', finish);

    window.addEventListener('resize', () => {
        sizeDrawLayer();
        renderDrawing();
    });
    document.addEventListener('keydown', event => {
        if (!drawing.active) return;
        if (event.key === 'Escape') cancelDrawing();
        if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            undoStroke();
        }
    });
}

function renderDrawTools() {
    document.querySelectorAll('#draw-colors .swatch').forEach(swatch => {
        swatch.classList.toggle('selected', !drawing.eraser && swatch.dataset.color === drawing.color);
    });
    document.querySelectorAll('#draw-sizes .size-btn').forEach(button => {
        button.classList.toggle('selected', Number(button.dataset.size) === drawing.size);
    });
    document.getElementById('draw-eraser').classList.toggle('active', drawing.eraser);
}

function sizeDrawLayer() {
    const ratio = window.devicePixelRatio || 1;
    drawLayer.width = Math.round(viewport.clientWidth * ratio);
    drawLayer.height = Math.round(viewport.clientHeight * ratio);
}

// Eraser strokes cut through ink, so the saved doodle stays transparent
function paintStrokes(ctx, strokes) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
        ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        const [first, ...rest] = stroke.points;
        ctx.beginPath();
        if (rest.length === 0) {
            ctx.arc(first[0], first[1], stroke.size / 2, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }
        ctx.moveTo(...first);
        rest.forEach(p => ctx.lineTo(...p));
        ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
}

// Draw the in-progress doodle over the board, following zoom and pan
function renderDrawing() {
    if (!drawing.active) return;
    const ratio = window.devicePixelRatio || 1;
    const ctx = drawLayer.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, drawLayer.width, drawLayer.height);
    ctx.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, ratio * view.x, ratio * view.y);
    paintStrokes(ctx, drawing.strokes);
}

function startDrawing() {
    if (drawing.active) return;
    drawing.active = true;
    drawing.strokes = [];
    drawLayer.classList.remove('hidden');
    document.getElementById('draw-toolbar').classList.remove('hidden');
    document.getElementById('draw-btn').classList.add('active');
    viewport.classList.add('drawing');
    sizeDrawLayer();
    renderDrawing();
    toast('✏️ Draw anywhere on the board, then hit "Done drawing"');
}

function stopDrawing() {
    drawing.active = false;
    drawing.saving = false;
    drawing.current = null;
    drawing.strokes = [];
    drawLayer.classList.add('hidden');
    document.getElementById('draw-toolbar').classList.add('hidden');
    document.getElementById('draw-btn').classList.remove('active');
    viewport.classList.remove('drawing');
    const done = document.getElementById('draw-done');
    done.disabled = false;
    done.innerHTML = '<span class="material-icons">check</span>Done drawing';
}

function cancelDrawing() {
    if (drawing.saving) return;
    const hasInk = drawing.strokes.some(stroke => !stroke.erase);
    if (hasInk && !confirm('Throw away this drawing?')) return;
    stopDrawing();
}

function toggleEraser() {
    drawing.eraser = !drawing.eraser;
    renderDrawTools();
}

function undoStroke() {
    drawing.strokes.pop();
    renderDrawing();
}

function clearDrawing() {
    drawing.strokes = [];
    renderDrawing();
}

function columnAtWorld(point) {
    const column = [...document.querySelectorAll('.board-column')].find(el => {
        const offset = worldOffset(el);
        return point.x >= offset.x && point.x <= offset.x + el.offsetWidth &&
            point.y >= offset.y && point.y <= offset.y + el.offsetHeight;
    });
    return column?.dataset.column ?? null;
}

// Save the doodle as a transparent image trimmed to the ink, placed exactly
// where it was drawn, then it's a normal movable/resizable item
async function finishDrawing() {
    if (drawing.saving) return;
    const ink = drawing.strokes.filter(stroke => !stroke.erase);
    if (ink.length === 0) {
        stopDrawing();
        return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const stroke of ink) {
        for (const [x, y] of stroke.points) {
            minX = Math.min(minX, x - stroke.size / 2);
            minY = Math.min(minY, y - stroke.size / 2);
            maxX = Math.max(maxX, x + stroke.size / 2);
            maxY = Math.max(maxY, y + stroke.size / 2);
        }
    }
    const pad = 4;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    // Very small doodles get transparent room so they aren't scaled up
    if (maxX - minX < MIN_ITEM_WIDTH) {
        const extra = (MIN_ITEM_WIDTH - (maxX - minX)) / 2;
        minX -= extra;
        maxX += extra;
    }
    const width = maxX - minX;
    const height = maxY - minY;

    drawing.saving = true;
    const done = document.getElementById('draw-done');
    done.disabled = true;
    done.innerHTML = '<span class="material-icons">hourglass_top</span>Saving…';

    try {
        let blob = null;
        // Sharp on zoomed-in screens, but never more than 4000px on a side
        let resolution = Math.min(2, 4000 / Math.max(width, height));
        for (let attempt = 0; attempt < 4; attempt++, resolution /= 2) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.ceil(width * resolution));
            canvas.height = Math.max(1, Math.ceil(height * resolution));
            const ctx = canvas.getContext('2d');
            ctx.setTransform(resolution, 0, 0, resolution, -minX * resolution, -minY * resolution);
            paintStrokes(ctx, drawing.strokes);
            blob = await canvasToBlob(canvas, 'image/png');
            if (blob && blob.size <= MAX_IMAGE_BYTES) break;
        }
        if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error('Drawing is too large');

        const imageId = await uploadImage(blob);
        const placement = {
            column: columnAtWorld({ x: minX + width / 2, y: minY + height / 2 }),
            x: Math.max(0, Math.round(minX)),
            y: Math.max(0, Math.round(minY)),
            w: Math.round(width)
        };
        // Keep the ink on screen until the saved doodle replaces it
        const fallback = setTimeout(() => {
            stopDrawing();
            toast("Couldn't save the drawing - please try again");
        }, 8000);
        socket.emit('addImage', { imageId, type: 'sketch', ...placement }, () => {
            clearTimeout(fallback);
            stopDrawing();
        });
    } catch (error) {
        console.error('Drawing upload failed:', error);
        toast(`Couldn't save the drawing: ${error.message}`);
        drawing.saving = false;
        done.disabled = false;
        done.innerHTML = '<span class="material-icons">check</span>Done drawing';
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

// Reload when we reconnect to a restarted server so the page runs its latest code
let knownBuildId = null;
socket.on('serverInfo', ({ buildId }) => {
    if (knownBuildId && knownBuildId !== buildId) {
        window.location.reload();
        return;
    }
    knownBuildId = buildId;
});

socket.on('loadCards', ({ cards: allCards }) => loadAllCards(allCards));
socket.on('cardUpserted', ({ card }) => upsertCard(card));
socket.on('cardRemoved', ({ cardId }) => removeCard(cardId));
socket.on('columnHeaders', ({ headers }) => renderHeaders(headers));

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
buildDrawTools();
updateSurfaceHeights();
initViewport();
