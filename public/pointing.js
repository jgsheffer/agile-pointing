// pointing.js
// Connect only once access.js confirms the access cookie is valid
const socket = io({ autoConnect: false });
window.addEventListener('access-granted', () => {
  if (!socket.connected) socket.connect();
});
socket.on('connect_error', (error) => {
  if (error.message === 'unauthorized') {
    showAccessForm();
  }
});

const DECKS = {
  fibonacci: [1, 2, 3, 5, 8, 13, '?', '☕', 'Pass'],
  tshirt: ['XS', 'S', 'M', 'L', 'XL', '?', '☕', 'Pass'],
};
const SPECIAL_VOTES = ['?', '☕', 'Pass'];
const REACTIONS = ['🎉', '👍', '🤔', '😂', '☕', '🔥', '❤️', '👀', '🚀', '😱'];
const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

// Update the currentRoom initialization to use URL parameters
let currentRoom = new URLSearchParams(window.location.search).get('room') || '';
let selectedAvatar = '';
let selectedAvatarType = 'emoji';
let sessionId = localStorage.getItem('sessionId');
let myParticipantId = null;
// Details sent with the last joinRoom, used to rejoin after a reconnect
let joinedWith = null;
// Avatars are only sent when the participant list changes, so keep them by id
const avatarCache = new Map();
const participantElements = new Map();
// Latest room state from the server
let roomState = null;
let renderedDeck = null;
let roundHistory = [];

const AVATAR_SIZE = 128;
const MAX_GIF_SIZE = 256 * 1024; // GIFs are sent as-is to keep the animation

// Used when GIPHY isn't configured or doesn't answer
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
];

const FALLBACK_GIFS = {
  celebrate: celebrationGifs,
  legendary: celebrationGifs,
  talk: letsTalkGifs,
  coffee: [],
};

const randomItem = (list) => list[Math.floor(Math.random() * list.length)];
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// ---------- Avatars ----------

function switchAvatarMode(mode) {
  selectedAvatarType = mode;
  document.querySelectorAll('.avatar-section').forEach((section) => {
    section.classList.toggle('hidden', section.dataset.section !== mode);
  });

  document.querySelectorAll('.avatar-mode-btn').forEach((btn) => {
    const selected = btn.dataset.mode === mode;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-selected', String(selected));
  });

  if (mode === 'dicebear') {
    regenerateAvatar();
  } else if (mode === 'emoji') {
    selectedAvatar = document.querySelector('.emoji-option.selected')?.dataset.emoji ?? '';
  } else if (mode === 'custom') {
    selectedAvatar = localStorage.getItem('customAvatarData') ?? '';
  }
}

function regenerateAvatar() {
  const style = document.getElementById('avatar-style').value;
  const seed = Math.random().toString(36).substring(7);
  const avatarUrl = `https://api.dicebear.com/6.x/${style}/svg?seed=${seed}`;

  const img = document.getElementById('dicebear-image');
  img.src = avatarUrl;
  selectedAvatar = avatarUrl;
  selectedAvatarType = 'dicebear';
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Crop to a square and shrink so the avatar stays small enough to share
function resizeImage(file, size = AVATAR_SIZE) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      canvas
        .getContext('2d')
        .drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      URL.revokeObjectURL(url);

      const webp = canvas.toDataURL('image/webp', 0.85);
      resolve(
        webp.startsWith('data:image/webp')
          ? webp
          : canvas.toDataURL('image/png')
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    image.src = url;
  });
}

async function handleCustomAvatarUpload(event) {
  const file = event.target.files[0];
  if (file) {
    // Check file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      alert('Please upload a valid image file (JPEG, PNG, WEBP, or GIF)');
      return;
    }

    const isGif = file.type === 'image/gif';
    if (isGif && file.size > MAX_GIF_SIZE) {
      alert('Animated GIFs must be smaller than 256 KB');
      return;
    }

    let dataUrl;
    try {
      dataUrl = isGif ? await readAsDataURL(file) : await resizeImage(file);
    } catch (error) {
      console.error('Avatar upload failed:', error);
      alert('Could not read that image. Please try another one.');
      return;
    }

    const img = document.getElementById('custom-image');
    img.src = dataUrl;
    selectedAvatar = dataUrl;
    selectedAvatarType = 'custom';
    document.getElementById('custom-preview').classList.remove('hidden');

    // Store the custom avatar data in localStorage
    localStorage.setItem('customAvatarData', dataUrl);
    localStorage.setItem('customAvatarType', file.type);

    // For GIFs, ensure proper animation display
    if (isGif) {
      img.style.imageRendering = 'auto';
      // Remove any existing background to ensure GIF transparency works
      img.parentElement.style.background = 'none';
    }
  }
}

document
  .getElementById('avatar-upload')
  ?.addEventListener('change', handleCustomAvatarUpload);

// ---------- Emoji picker ----------

let emojiCategory = 0;

function renderEmojiTabs() {
  const tabs = document.getElementById('emoji-tabs');
  tabs.innerHTML = '';
  EMOJI_CATEGORIES.forEach((category, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'emoji-tab';
    tab.textContent = category.icon;
    tab.title = category.name;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-label', category.name);
    tab.addEventListener('click', () => {
      emojiCategory = index;
      document.getElementById('emoji-search').value = '';
      renderEmojiGrid();
    });
    tabs.appendChild(tab);
  });
}

function renderEmojiGrid() {
  const query = document.getElementById('emoji-search').value.trim().toLowerCase();
  const emojis = query
    ? EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter(([, words]) =>
        words.includes(query)
      )
    : EMOJI_CATEGORIES[emojiCategory].emojis;

  document.querySelectorAll('.emoji-tab').forEach((tab, index) => {
    const selected = !query && index === emojiCategory;
    tab.classList.toggle('selected', selected);
    tab.setAttribute('aria-selected', String(selected));
  });

  const grid = document.getElementById('emoji-grid');
  grid.innerHTML = '';
  for (const [emoji, words] of emojis) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'emoji-option';
    option.dataset.emoji = emoji;
    option.textContent = emoji;
    option.title = words.split(' ')[0];
    option.setAttribute('role', 'option');
    option.addEventListener('click', () => selectEmoji(emoji));
    grid.appendChild(option);
  }
  if (emojis.length === 0) {
    grid.textContent = 'No matches - try another word';
  }
  markSelectedEmoji();
}

function markSelectedEmoji() {
  document.querySelectorAll('.emoji-option').forEach((el) => {
    const selected = selectedAvatarType === 'emoji' && el.dataset.emoji === selectedAvatar;
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-selected', String(selected));
  });
}

function selectEmoji(emoji) {
  selectedAvatar = emoji;
  selectedAvatarType = 'emoji';
  markSelectedEmoji();
}

document.getElementById('emoji-search').addEventListener('input', renderEmojiGrid);

// ---------- Room management ----------

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function copyRoomLink() {
  const roomLink = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoom)}`;
  navigator.clipboard.writeText(roomLink).then(() => {
    toast('🔗 Room link copied - share it with your team');
  });
}

function updateRoomHeader(roomId, show = true) {
  // Same room name on the retro board, so the team stays together
  document.getElementById('nav-retro').href = show
    ? `/retro.html?room=${encodeURIComponent(roomId)}`
    : '/retro.html';
  document.getElementById('header-room-info').classList.toggle('hidden', !show);
  document.getElementById('header-room-id').textContent = show ? roomId : '';
  document.getElementById('leave-btn').classList.toggle('hidden', !show);
  document.getElementById('reaction-bar').classList.toggle('hidden', !show);
}

function joinRoom() {
  const name = document.getElementById('name').value.trim();
  let room = (document.getElementById('room').value || currentRoom).trim();
  if (!room) {
    room = generateRoomId();
    document.getElementById('room').value = room;
  }
  if (!name || !selectedAvatar) {
    alert('Please enter your name and pick an avatar.');
    return;
  }
  if (!/^[\w -]{1,64}$/.test(room)) {
    alert('Room IDs can only use letters, numbers, spaces, - and _.');
    return;
  }

  // Update URL with room parameter
  const newUrl = `${window.location.pathname}?room=${encodeURIComponent(room)}`;
  window.history.pushState({}, '', newUrl);
  if (room !== currentRoom || !joinedWith) clearVoteUI();
  currentRoom = room;
  joinedWith = {
    room,
    name,
    avatar: selectedAvatar,
    avatarType: selectedAvatarType,
  };
  socket.emit('joinRoom', { ...joinedWith, sessionId });
  document.getElementById('join-form').classList.add('hidden');
  document.getElementById('voting-area').classList.remove('hidden');
  updateRoomHeader(room, true);
  localStorage.setItem(
    'pokerSession',
    JSON.stringify({
      name,
      room,
      avatar: selectedAvatar,
      avatarType: selectedAvatarType,
    })
  );
}

function leaveRoom() {
  socket.emit('leaveRoom');
  currentRoom = '';
  joinedWith = null;
  roomState = null;
  myParticipantId = null;
  avatarCache.clear();
  participantElements.clear();
  document.getElementById('participants').innerHTML = '';
  clearVoteUI();
  document.getElementById('voting-area').classList.add('hidden');
  document.getElementById('join-form').classList.remove('hidden');
  updateRoomHeader('', false);
  localStorage.removeItem('pokerSession');
}

['name', 'room'].forEach((id) => {
  document.getElementById(id).addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinRoom();
  });
});

// ---------- Voting ----------

let currentVote = null;
// Bumped on every reset so late async results from an earlier round are dropped
let voteRound = 0;
let resultsShownForRound = -1;

const votingLocked = () => !roomState || roomState.revealed || roomState.revealing;
const sameVote = (a, b) => a !== null && String(a) === String(b);

function renderDeck(deck) {
  renderedDeck = deck;
  const container = document.getElementById('voting-buttons');
  container.innerHTML = '';
  DECKS[deck].forEach((value, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vote-button';
    if (SPECIAL_VOTES.includes(value)) button.classList.add('special');
    button.dataset.value = String(value);
    button.textContent = value;
    button.title =
      value === '☕' ? 'I need a break' : value === '?' ? 'Not sure' : `Vote ${value}`;
    if (index < 9) {
      const shortcut = document.createElement('span');
      shortcut.className = 'shortcut';
      shortcut.textContent = index + 1;
      shortcut.setAttribute('aria-hidden', 'true');
      button.appendChild(shortcut);
    }
    button.addEventListener('click', () => vote(value));
    container.appendChild(button);
  });
  updateDeckButtons();
}

function updateDeckButtons() {
  const locked = votingLocked();
  document.querySelectorAll('.vote-button').forEach((button) => {
    const selected = sameVote(currentVote, button.dataset.value);
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = locked;
  });
}

function vote(value) {
  if (votingLocked()) return;
  const previousVote = currentVote;
  currentVote = value;
  updateDeckButtons();
  Sound.click();

  const button = document.querySelector(
    `.vote-button[data-value="${CSS.escape(String(value))}"]`
  );
  if (button && !prefersReducedMotion) {
    // Add ripple effect
    const ripple = document.createElement('div');
    ripple.className = 'absolute inset-0 bg-white rounded-xl';
    ripple.style.animation = 'ripple 0.6s linear';
    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);

    // Add micro-confetti burst from the button
    const rect = button.getBoundingClientRect();
    confetti({
      particleCount: 20,
      spread: 30,
      startVelocity: 20,
      origin: {
        x: (rect.left + rect.right) / 2 / window.innerWidth,
        y: rect.top / window.innerHeight,
      },
      colors: ['#60A5FA', '#3B82F6', '#A78BFA'],
      shapes: ['circle'],
      scalar: 0.75,
      disableForReducedMotion: true,
    });

    if (previousVote !== value) spawnVoteParticles(button, value);
  }

  socket.emit('vote', { vote: value });
}

// Floating copies of the value drifting away from the button
function spawnVoteParticles(button, value) {
  const rect = button.getBoundingClientRect();
  const centerX = (rect.left + rect.right) / 2 + window.scrollX;
  const centerY = (rect.top + rect.bottom) / 2 + window.scrollY;
  for (let i = 0; i < 3; i++) {
    const particle = document.createElement('div');
    particle.textContent = value;
    particle.className =
      'absolute text-2xl font-bold text-blue-400 pointer-events-none';
    particle.style.left = `${centerX}px`;
    particle.style.top = `${centerY}px`;
    particle.style.transform = 'scale(0)';
    particle.style.opacity = '0';
    particle.style.zIndex = '45';
    document.body.appendChild(particle);

    const angle = Math.random() * Math.PI * 2;
    const distance = 80 + Math.random() * 50;
    requestAnimationFrame(() => {
      particle.style.transition = 'all 1s cubic-bezier(0.4, 0, 0.2, 1)';
      particle.style.transform = 'scale(1)';
      particle.style.opacity = '1';
      particle.style.left = `${centerX + Math.cos(angle) * distance}px`;
      particle.style.top = `${centerY + Math.sin(angle) * distance}px`;
    });
    setTimeout(() => {
      particle.style.opacity = '0';
      setTimeout(() => particle.remove(), 1000);
    }, 500);
  }
}

function revealVotes() {
  socket.emit('revealVotes');
}

function resetVotes() {
  socket.emit('resetVotes');
}

function onRevealButton() {
  if (roomState?.revealed) {
    resetVotes();
  } else {
    revealVotes();
  }
}

function changeDeck(deck) {
  if (roomState && deck !== roomState.deck) {
    socket.emit('setDeck', { deck });
  }
}

// Number keys pick cards, unless you're typing somewhere
document.addEventListener('keydown', (event) => {
  if (!roomState || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest('input, textarea, select')) return;
  const index = Number(event.key) - 1;
  const deck = DECKS[roomState.deck];
  if (Number.isInteger(index) && index >= 0 && index < deck.length) {
    vote(deck[index]);
  }
});

// Clears this client's selection and results; runs for everyone on a reset
function clearVoteUI() {
  voteRound++;
  currentVote = null;
  updateDeckButtons();
  document.getElementById('results').classList.add('hidden');
  document.getElementById('consensus').classList.add('hidden');
  document.getElementById('giphy-image').classList.add('hidden');
  document.getElementById('countdown-overlay').classList.add('hidden');
}

// ---------- Story ----------

let storyTimer = null;
document.getElementById('story-input').addEventListener('input', (event) => {
  clearTimeout(storyTimer);
  storyTimer = setTimeout(() => {
    storyTimer = null;
    socket.emit('setStory', { story: event.target.value });
  }, 300);
});

// ---------- Rendering room state ----------

function renderState(state, { animateReveal = false } = {}) {
  roomState = state;
  if (state.deck !== renderedDeck) {
    renderDeck(state.deck);
  }
  document.getElementById('deck-select').value = state.deck;

  const storyInput = document.getElementById('story-input');
  // Don't overwrite text that's being typed or is about to be sent
  if (document.activeElement !== storyInput && !storyTimer) {
    storyInput.value = state.story;
  }

  const me = state.participants.find((p) => p.id === myParticipantId);
  if (me && !me.hasVoted) currentVote = null;
  updateDeckButtons();

  renderProgress(state);
  renderRevealButton(state);
  renderStreak(state.streak);
  renderParticipants(state, animateReveal);

  if (state.revealed && resultsShownForRound !== voteRound) {
    resultsShownForRound = voteRound;
    const flipTime = animateReveal ? state.participants.length * 150 + 600 : 0;
    const round = voteRound;
    setTimeout(() => {
      if (round === voteRound) showResults(state, { celebrate: animateReveal });
    }, flipTime);
  }
}

function renderProgress(state) {
  const online = state.participants.filter((p) => p.online || p.hasVoted);
  const voted = online.filter((p) => p.hasVoted).length;
  const text = document.getElementById('vote-progress-text');
  text.textContent = state.revealed
    ? `${plural(voted, 'vote')} revealed`
    : `${voted} of ${online.length} voted`;
  document.getElementById('vote-progress-bar').style.width =
    online.length > 0 ? `${(voted / online.length) * 100}%` : '0%';
}

function renderRevealButton(state) {
  const button = document.getElementById('reveal-btn');
  const icon = button.querySelector('.material-icons');
  const label = button.querySelector('.label');
  const online = state.participants.filter((p) => p.online);
  const everyoneVoted = online.length > 0 && online.every((p) => p.hasVoted);

  button.disabled = state.revealing;
  button.classList.toggle('ready', everyoneVoted && !state.revealed && !state.revealing);
  if (state.revealing) {
    icon.textContent = 'hourglass_top';
    label.textContent = 'Revealing…';
  } else if (state.revealed) {
    icon.textContent = 'skip_next';
    label.textContent = 'Next story';
  } else {
    icon.textContent = 'visibility';
    label.textContent = everyoneVoted ? "Everyone's in - reveal!" : 'Reveal votes';
  }
  document.getElementById('reset-btn').classList.toggle('hidden', state.revealed);
}

function renderStreak(streak) {
  const badge = document.getElementById('streak-badge');
  badge.classList.toggle('hidden', streak < 2);
  badge.textContent = `🔥 ${streak} in a row!`;
}

function createAvatarElement(avatar, avatarType) {
  const container = document.createElement('div');
  container.className = 'avatar';

  if (avatarType === 'emoji') {
    container.textContent = avatar;
  } else if (avatarType === 'dicebear' || avatarType === 'custom') {
    const img = document.createElement('img');
    img.src = avatar;
    img.alt = '';
    // For GIFs, remove background gradient so transparency shows
    if (avatarType === 'custom' && avatar.startsWith('data:image/gif;')) {
      container.classList.add('transparent');
      img.style.imageRendering = 'auto';
    }
    container.appendChild(img);
  }
  return container;
}

function createParticipantElement(id) {
  const div = document.createElement('div');
  div.className = 'participant modern-card entering';
  div.dataset.id = id;
  div.addEventListener('animationend', (event) => {
    if (event.animationName === 'enter') div.classList.remove('entering');
    if (event.animationName === 'wiggle') div.classList.remove('wiggle');
  });

  const info = document.createElement('div');
  info.className = 'min-w-0';
  const name = document.createElement('div');
  name.className = 'participant-name';
  const tag = document.createElement('div');
  tag.className = 'participant-tag';
  info.append(name, tag);

  const slot = document.createElement('div');
  slot.className = 'vote-slot';
  const flipper = document.createElement('div');
  flipper.className = 'flipper';
  const front = document.createElement('div');
  front.className = 'face front';
  const back = document.createElement('div');
  back.className = 'face back';
  flipper.append(front, back);
  slot.appendChild(flipper);

  const nudge = document.createElement('button');
  nudge.type = 'button';
  nudge.className = 'nudge-btn';
  nudge.textContent = '👉 nudge';
  nudge.addEventListener('click', () => sendNudge(id));

  div.append(document.createElement('div'), info, slot, nudge);
  return div;
}

function updateParticipantElement(div, p, state, flipDelay) {
  const { avatar = '', avatarType } = avatarCache.get(p.id) ?? {};
  const avatarKey = `${avatarType}:${avatar.length}:${avatar.slice(-32)}`;
  if (div.dataset.avatarKey !== avatarKey) {
    div.dataset.avatarKey = avatarKey;
    div.firstElementChild.replaceWith(createAvatarElement(avatar, avatarType));
  }

  const isMe = p.id === myParticipantId;
  div.classList.toggle('is-me', isMe);
  div.classList.toggle('voted', p.hasVoted);
  div.classList.toggle('offline', !p.online);
  div.querySelector('.participant-name').textContent = p.name;
  div.querySelector('.participant-tag').textContent = [
    isMe && 'You',
    !p.online && 'Away',
  ]
    .filter(Boolean)
    .join(' · ');

  const front = div.querySelector('.face.front');
  const frontState = p.hasVoted ? 'voted' : 'thinking';
  if (front.dataset.state !== frontState) {
    front.dataset.state = frontState;
    front.innerHTML = '';
    if (p.hasVoted) {
      const icon = document.createElement('span');
      icon.className = 'material-icons text-green-400 text-4xl';
      icon.textContent = 'check_circle';
      front.appendChild(icon);
    } else {
      const thinking = document.createElement('span');
      thinking.className = 'thinking';
      thinking.append(...Array.from({ length: 3 }, () => document.createElement('span')));
      front.appendChild(thinking);
    }
  }
  front.setAttribute('aria-label', p.hasVoted ? 'Voted' : 'Still thinking');

  const back = div.querySelector('.face.back');
  const results = state.results;
  back.textContent = p.vote ?? '';
  back.classList.toggle('small', String(p.vote ?? '').length > 2);
  back.classList.toggle('is-low', Boolean(results?.low.some((v) => v.name === p.name)));
  back.classList.toggle('is-high', Boolean(results?.high.some((v) => v.name === p.name)));

  const flipper = div.querySelector('.flipper');
  const shouldFlip = state.revealed && p.vote !== null;
  if (!shouldFlip) {
    flipper.classList.remove('flipped');
  } else if (flipDelay === null) {
    flipper.classList.add('flipped');
  } else {
    setTimeout(() => flipper.classList.add('flipped'), flipDelay);
  }

  const nudge = div.querySelector('.nudge-btn');
  nudge.classList.toggle('hidden', isMe || p.hasVoted || !p.online || state.revealed);
  nudge.setAttribute('aria-label', `Nudge ${p.name} to vote`);
}

function renderParticipants(state, animateReveal) {
  const container = document.getElementById('participants');
  const seen = new Set();
  let flipIndex = 0;

  state.participants.forEach((p) => {
    if (p.avatar !== undefined) {
      avatarCache.set(p.id, { avatar: p.avatar, avatarType: p.avatarType });
    }
    seen.add(p.id);
    let div = participantElements.get(p.id);
    if (!div) {
      div = createParticipantElement(p.id);
      participantElements.set(p.id, div);
    }
    const flipDelay =
      animateReveal && p.vote !== null ? flipIndex++ * 150 : null;
    updateParticipantElement(div, p, state, flipDelay);
    // appendChild moves existing nodes, keeping the server's order
    container.appendChild(div);
  });

  for (const [id, div] of participantElements) {
    if (!seen.has(id)) {
      div.remove();
      participantElements.delete(id);
    }
  }
}

// ---------- Results ----------

function showResults(state, { celebrate }) {
  const { results, streak } = state;
  const resultsDiv = document.getElementById('results');
  resultsDiv.classList.remove('hidden', 'show');
  void resultsDiv.offsetWidth; // restart the entrance animation
  resultsDiv.classList.add('show');

  document.getElementById('suggested-vote').textContent = results.suggested ?? '-';
  const averageWrap = document.getElementById('average-wrap');
  averageWrap.classList.toggle('hidden', results.average === null);
  if (results.average !== null) {
    countUp(document.getElementById('average-vote'), results.average);
  }

  renderChart(results);
  renderBreakdown(results);
  renderCallout(results);

  document.getElementById('consensus').classList.toggle('hidden', !results.consensus);

  const mood = gifMood(results, streak);
  showGif(mood);

  if (!celebrate) return;
  if (results.consensus) {
    Sound.tada();
    celebrateConsensus(state);
  } else if (results.talk) {
    Sound.hmm();
  }
}

function countUp(element, value) {
  if (prefersReducedMotion) {
    element.textContent = value.toFixed(2);
    return;
  }
  const steps = 30;
  let step = 0;
  const interval = setInterval(() => {
    step++;
    element.textContent = ((value * step) / steps).toFixed(2);
    if (step === steps) clearInterval(interval);
  }, 40);
}

function renderChart(results) {
  const chart = document.getElementById('vote-chart');
  chart.innerHTML = '';
  const max = Math.max(1, ...results.distribution.map((d) => d.count));

  for (const { value, count } of results.distribution) {
    const row = document.createElement('div');
    row.className = 'chart-row';
    row.classList.toggle('is-suggested', sameVote(value, results.suggested));

    const label = document.createElement('span');
    label.className = 'text-right';
    label.textContent = value;
    const track = document.createElement('div');
    track.className = 'chart-bar-track';
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    track.appendChild(bar);
    const total = document.createElement('span');
    total.className = 'text-gray-400';
    total.textContent = count;

    row.append(label, track, total);
    chart.appendChild(row);
    requestAnimationFrame(() => {
      bar.style.width = `${(count / max) * 100}%`;
    });
  }
}

function renderBreakdown(results) {
  const parts = [plural(results.counted, 'estimate')];
  if (results.pass) parts.push(`${results.pass} ${results.pass === 1 ? 'pass' : 'passes'}`);
  if (results.unsure) parts.push(`${results.unsure} unsure`);
  if (results.coffee) parts.push(`${results.coffee} ☕`);
  document.getElementById('vote-breakdown').textContent = parts.join(' · ');
}

function renderCallout(results) {
  const callout = document.getElementById('results-callout');
  callout.innerHTML = '';
  const describe = (voters) => voters.map((v) => `${v.name} (${v.vote})`).join(', ');

  if (results.talk) {
    const line = document.createElement('p');
    line.textContent = `🎤 ${describe(results.low)} and ${describe(results.high)}, you're up - tell us your thinking!`;
    callout.appendChild(line);
  }
  if (results.coffee) {
    const line = document.createElement('p');
    line.textContent = `☕ ${results.coffee === 1 ? 'Someone could' : `${results.coffee} people could`} use a break.`;
    callout.appendChild(line);
  }
  callout.classList.toggle('coffee', !results.talk && results.coffee > 0);
  callout.classList.toggle('hidden', callout.childElementCount === 0);
}

function gifMood(results, streak) {
  if (results.coffee > 0 && results.coffee >= results.total / 2) return 'coffee';
  if (results.consensus) return streak >= 3 ? 'legendary' : 'celebrate';
  if (results.talk) return 'talk';
  return null;
}

// Random GIF from GIPHY via the server, or one from the static lists
async function getGif(mood) {
  try {
    const response = await fetch(`/api/gif?mood=${mood}`);
    if (response.ok) {
      const { url } = await response.json();
      if (url) return url;
    }
  } catch (error) {
    console.error('Could not fetch a GIF:', error);
  }
  const fallback = FALLBACK_GIFS[mood];
  return fallback.length > 0 ? randomItem(fallback) : null;
}

function showGif(mood) {
  const giphyImage = document.getElementById('giphy-image');
  giphyImage.classList.add('hidden');
  if (!mood) return;

  const round = voteRound;
  getGif(mood).then((url) => {
    // Votes were reset while the GIF was loading
    if (round !== voteRound || !url) return;

    giphyImage.src = url;
    giphyImage.alt = mood === 'talk' ? "Let's talk" : 'Celebration';
    giphyImage.style.opacity = '0';
    giphyImage.classList.remove('hidden');
    setTimeout(() => {
      giphyImage.style.transition = 'opacity 0.5s ease-in';
      giphyImage.style.opacity = '1';
    }, 100);
  });
}

// Confetti made of the agreeing voters' own emoji avatars, bigger with streaks
function celebrateConsensus(state) {
  const emojis = new Set(['🎉']);
  for (const p of state.participants) {
    const cached = avatarCache.get(p.id);
    if (cached?.avatarType === 'emoji' && sameVote(p.vote, state.results.suggested)) {
      emojis.add(cached.avatar);
    }
  }
  const emojiShapes = [...emojis]
    .slice(0, 8)
    .map((text) => confetti.shapeFromText({ text, scalar: 2 }));

  const intensity = 1 + Math.min(state.streak, 5) * 0.35;
  const duration = Math.min(6000, 3000 + state.streak * 500);
  const animationEnd = Date.now() + duration;
  const defaults = {
    startVelocity: 30,
    spread: 360,
    ticks: 70,
    zIndex: 50,
    disableForReducedMotion: true,
  };
  const randomInRange = (min, max) => Math.random() * (max - min) + min;

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) {
      clearInterval(interval);
      return;
    }
    const particleCount = 40 * intensity * (timeLeft / duration);
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
    });
    confetti({
      ...defaults,
      particleCount: particleCount / 3,
      shapes: emojiShapes,
      scalar: 2,
      origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
    });
  }, 250);
}

// ---------- Countdown ----------

function showCountdown(seconds) {
  const overlay = document.getElementById('countdown-overlay');
  if (seconds <= 0) return;
  Sound.drumroll(seconds);
  overlay.classList.remove('hidden');

  const round = voteRound;
  for (let i = 0; i < seconds; i++) {
    setTimeout(() => {
      if (round !== voteRound) return;
      overlay.innerHTML = '';
      const number = document.createElement('div');
      number.className = 'countdown-number gradient-text';
      number.textContent = seconds - i;
      overlay.appendChild(number);
    }, i * 1000);
  }
  setTimeout(() => overlay.classList.add('hidden'), seconds * 1000);
}

// ---------- Reactions & nudges ----------

let lastReactionAt = 0;

function renderReactionBar() {
  const bar = document.getElementById('reaction-bar');
  for (const emoji of REACTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reaction-btn';
    button.textContent = emoji;
    button.setAttribute('aria-label', `React with ${emoji}`);
    button.addEventListener('click', () => sendReaction(emoji));
    bar.appendChild(button);
  }
}

function sendReaction(emoji) {
  const now = Date.now();
  if (now - lastReactionAt < 250) return;
  lastReactionAt = now;
  socket.emit('react', { emoji });
}

function spawnReaction(emoji, from) {
  const layer = document.getElementById('reaction-layer');
  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.style.left = `${10 + Math.random() * 80}%`;
  el.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 120)}px`);
  const icon = document.createElement('span');
  icon.className = 'emoji';
  icon.textContent = emoji;
  const label = document.createElement('span');
  label.className = 'from';
  label.textContent = from;
  el.append(icon, label);
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

let lastNudgeAt = 0;

function sendNudge(targetId) {
  const now = Date.now();
  if (now - lastNudgeAt < 2000) {
    toast('Give them a second 😄');
    return;
  }
  lastNudgeAt = now;
  socket.emit('nudge', { targetId });
}

function toast(message) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- History ----------

function renderHistory(history) {
  roundHistory = history;
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  for (const round of history) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const estimate = document.createElement('span');
    estimate.className = 'history-estimate';
    estimate.textContent = round.suggested ?? '-';
    const story = document.createElement('span');
    story.className = 'flex-1 min-w-0 truncate';
    story.textContent = round.story || 'Untitled story';
    const meta = document.createElement('span');
    meta.className = 'text-sm text-gray-400 whitespace-nowrap';
    meta.textContent = `${round.consensus ? '🎉 ' : ''}${plural(round.votes, 'vote')} · ${new Date(round.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    item.append(estimate, story, meta);
    list.appendChild(item);
  }
  document.getElementById('history-count').textContent = history.length
    ? `(${history.length})`
    : '';
  document.getElementById('history-empty').classList.toggle('hidden', history.length > 0);
  document.getElementById('copy-history-btn').classList.toggle('hidden', history.length === 0);
}

function copyHistory() {
  const text = [...roundHistory]
    .reverse()
    .map((round) => `${round.story || 'Untitled story'}\t${round.suggested ?? '-'}`)
    .join('\n');
  navigator.clipboard.writeText(text).then(() => toast('📋 History copied'));
}

// ---------- Sound ----------

function renderSoundToggle() {
  const button = document.getElementById('sound-toggle');
  button.querySelector('.material-icons').textContent = Sound.muted ? 'volume_off' : 'volume_up';
  const label = Sound.muted ? 'Unmute sounds' : 'Mute sounds';
  button.title = label;
  button.setAttribute('aria-label', label);
}

function toggleSound() {
  Sound.toggle();
  renderSoundToggle();
  Sound.pop();
}

// ---------- Session management ----------

function checkExistingSession() {
  const session = JSON.parse(localStorage.getItem('pokerSession'));
  if (session) {
    document.getElementById('name').value = session.name;
    // A shared link's room wins over the one you were last in
    document.getElementById('room').value = currentRoom || session.room;

    // Restore custom avatar if it exists
    const customAvatarData = localStorage.getItem('customAvatarData');
    const customAvatarType = localStorage.getItem('customAvatarType');

    if (session.avatarType === 'custom' && customAvatarData) {
      const img = document.getElementById('custom-image');
      img.src = customAvatarData;
      document.getElementById('custom-preview').classList.remove('hidden');
      switchAvatarMode('custom');

      // Handle GIF specific settings
      if (customAvatarType === 'image/gif') {
        img.style.imageRendering = 'auto';
        img.parentElement.style.background = 'none';
      }
    } else if (session.avatarType === 'emoji') {
      selectEmoji(session.avatar);
    } else if (session.avatarType === 'dicebear') {
      switchAvatarMode('dicebear');
      selectedAvatar = session.avatar;
      document.getElementById('dicebear-image').src = session.avatar;
    }

    joinRoom();
  }
}

// ---------- Socket event handlers ----------

// Reload when we reconnect to a restarted server so the page runs its latest code
let knownBuildId = null;
socket.on('serverInfo', ({ buildId }) => {
  if (knownBuildId && knownBuildId !== buildId) {
    window.location.reload();
    return;
  }
  knownBuildId = buildId;
});

socket.on('joined', ({ sessionId: newSessionId, participantId }) => {
  sessionId = newSessionId;
  myParticipantId = participantId;
  localStorage.setItem('sessionId', sessionId);
});

socket.on('joinError', (message) => {
  alert(message);
  leaveRoom();
});

// Rejoin after a dropped connection so the server knows which room we're in
socket.io.on('reconnect', () => {
  if (joinedWith) {
    socket.emit('joinRoom', { ...joinedWith, sessionId });
  }
});

// Updates for a room we just left can still be in flight
const isCurrentRoom = (state) => joinedWith !== null && state.room === currentRoom;

socket.on('roomState', (state) => {
  if (isCurrentRoom(state)) renderState(state);
});

socket.on('revealCountdown', ({ seconds }) => showCountdown(seconds));

socket.on('votesRevealed', (state) => {
  if (!isCurrentRoom(state)) return;
  document.getElementById('countdown-overlay').classList.add('hidden');
  renderState(state, { animateReveal: true });
});

socket.on('votesReset', (state) => {
  if (!isCurrentRoom(state)) return;
  clearVoteUI();
  renderState(state);
});

socket.on('history', renderHistory);

socket.on('reaction', ({ emoji, from }) => spawnReaction(emoji, from));

socket.on('nudge', ({ targetId, from }) => {
  const card = participantElements.get(targetId);
  if (card && !prefersReducedMotion) card.classList.add('wiggle');
  if (targetId === myParticipantId) {
    toast(`👉 ${from} nudged you - time to vote!`);
    Sound.nudge();
    navigator.vibrate?.(200);
  }
});

// ---------- Initialize ----------

renderEmojiTabs();
renderEmojiGrid();
renderReactionBar();
renderSoundToggle();
switchAvatarMode('emoji');
renderHistory([]);
window.onload = checkExistingSession;
