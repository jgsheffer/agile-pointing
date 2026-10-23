// server.js
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const INVALID_VOTE = 'Cheater';
const NON_SCALE_VOTES = ['?', '☕', 'Pass'];
const DECKS = {
  fibonacci: { scale: [1, 2, 3, 5, 8, 13], numeric: true },
  tshirt: { scale: ['XS', 'S', 'M', 'L', 'XL'], numeric: false },
};
const DEFAULT_DECK = 'fibonacci';
const REACTIONS = ['🎉', '👍', '🤔', '😂', '☕', '🔥', '❤️', '👀', '🚀', '😱'];

const RETRO_COLUMNS = ['went-well', 'improve', 'action-items', 'kudos'];
const NOTE_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'];
const RETRO_ITEM_TYPES = ['note', 'image', 'sketch'];

const ACCESS_COOKIE = 'agileAccess';
const ACCESS_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 365 days

const MAX_NAME_LENGTH = 40;
const MAX_STORY_LENGTH = 140;
const MAX_HISTORY = 50;
const MAX_CARD_LENGTH = 2000;
const MAX_CARDS_PER_ROOM = 500;
// Retro items live anywhere on a large canvas, in canvas pixels
const MAX_BOARD_SIZE = 20000;
const MIN_ITEM_WIDTH = 120;
const MIN_ITEM_HEIGHT = 80;
const MAX_ITEM_SIZE = 4000; // doodles drawn on the board can be wide
const MAX_AVATAR_LENGTH = 360 * 1024; // ~256KB image once base64 encoded
const MAX_SOCKET_MESSAGE = 512 * 1024;

const MAX_IMAGE_BYTES = 1024 * 1024; // 1MB per retro image
const MAX_IMAGES_PER_ROOM = 60;
const MAX_IMAGE_BYTES_PER_ROOM = 30 * 1024 * 1024;
const UNATTACHED_IMAGE_TTL = 10 * 60 * 1000; // uploads never placed on the board
const IMAGE_SIGNATURES = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.subarray(0, 4).toString('ascii') === 'GIF8',
  'image/webp': (b) =>
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP',
};

const REACTION_COOLDOWN = 250;
const NUDGE_COOLDOWN = 2000;
const DEFAULT_REVEAL_DELAY = 3000; // countdown before cards flip

const ROOM_PATTERN = /^[\w -]{1,64}$/;
const SESSION_PATTERN = /^[0-9a-f-]{36}$/;
const ID_PATTERN = /^[0-9a-f-]{36}$/;
const DICEBEAR_PATTERN =
  /^https:\/\/api\.dicebear\.com\/\d+\.x\/[a-z-]+\/svg\?seed=[A-Za-z0-9]+$/;
const CUSTOM_AVATAR_PATTERN =
  /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';
const GIF_MOODS = {
  celebrate: ['celebrate', 'celebration', 'high five', 'nailed it', 'party', 'success'],
  legendary: ['legendary', 'unstoppable', 'on fire', 'champion', 'mic drop'],
  talk: ["let's talk", 'discuss', 'hmm thinking', 'debate'],
  coffee: ['coffee break', 'need coffee', 'coffee time'],
};
const GIPHY_CACHE_TTL = 60 * 60 * 1000; // 1 hour, keeps us under the free key's limits
const GIPHY_TIMEOUT = 3000;

const INACTIVE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
const DISCONNECTED_THRESHOLD = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

// ---------- Input validation ----------

function cleanRoom(room) {
  if (typeof room !== 'string') return null;
  const trimmed = room.trim();
  return ROOM_PATTERN.test(trimmed) ? trimmed : null;
}

function cleanText(text, maxLength, { allowEmpty = false } = {}) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length > maxLength) return null;
  if (!allowEmpty && trimmed.length === 0) return null;
  return trimmed;
}

const cleanName = (name) => cleanText(name, MAX_NAME_LENGTH);
const cleanCardContent = (content) => cleanText(content, MAX_CARD_LENGTH);

function isValidAvatar(avatar, avatarType) {
  if (typeof avatar !== 'string') return false;
  switch (avatarType) {
    case 'emoji':
      return avatar.length > 0 && avatar.length <= 16;
    case 'dicebear':
      return DICEBEAR_PATTERN.test(avatar);
    case 'custom':
      return (
        avatar.length <= MAX_AVATAR_LENGTH && CUSTOM_AVATAR_PATTERN.test(avatar)
      );
    default:
      return false;
  }
}

function deckValues(deck) {
  return [...DECKS[deck].scale, ...NON_SCALE_VOTES];
}

function cleanVote(vote, deck) {
  return deckValues(deck).includes(vote) ? vote : INVALID_VOTE;
}

function clamp(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

// ---------- Pointing results ----------

// Closest scale value to a position on the scale; ties round up
function nearestOnScale(scale, target, toNumber) {
  let best = scale[0];
  for (const value of scale) {
    const diff = Math.abs(toNumber(value) - target);
    const bestDiff = Math.abs(toNumber(best) - target);
    if (diff < bestDiff || (diff === bestDiff && toNumber(value) > toNumber(best))) {
      best = value;
    }
  }
  return best;
}

function summarizeVotes(votes, deck) {
  const { scale, numeric } = DECKS[deck];
  const onScale = votes.filter((v) => scale.includes(v.vote));
  const count = (value) => votes.filter((v) => v.vote === value).length;

  const distribution = [...deckValues(deck), INVALID_VOTE]
    .map((value) => ({ value, count: count(value) }))
    .filter((d) => d.count > 0 || scale.includes(d.value));

  let average = null;
  let suggested = null;
  if (onScale.length > 0) {
    if (numeric) {
      average =
        Math.round(
          (onScale.reduce((sum, v) => sum + v.vote, 0) / onScale.length) * 100
        ) / 100;
      suggested = nearestOnScale(scale, average, Number);
    } else {
      const meanIndex =
        onScale.reduce((sum, v) => sum + scale.indexOf(v.vote), 0) /
        onScale.length;
      suggested = nearestOnScale(scale, meanIndex, (v) => scale.indexOf(v));
    }
  }

  const indexes = onScale.map((v) => scale.indexOf(v.vote));
  const minIndex = Math.min(...indexes);
  const maxIndex = Math.max(...indexes);
  const consensus = onScale.length >= 2 && minIndex === maxIndex;
  // A spread of more than two cards is worth a conversation
  const talk = onScale.length >= 2 && maxIndex - minIndex > 2;
  const at = (index) =>
    onScale
      .filter((v) => scale.indexOf(v.vote) === index)
      .map((v) => ({ name: v.name, vote: v.vote }));

  return {
    average,
    suggested,
    consensus,
    talk,
    low: talk ? at(minIndex) : [],
    high: talk ? at(maxIndex) : [],
    distribution,
    counted: onScale.length,
    total: votes.length,
    coffee: count('☕'),
    unsure: count('?'),
    pass: count('Pass'),
  };
}

// ---------- Access control ----------

function accessToken(accessCode) {
  return crypto
    .createHmac('sha256', accessCode)
    .update('agile-pointing-access')
    .digest('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// ---------- Retro card grouping ----------

function normalizeWords(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter(Boolean)
  );
}

function isSimilar(a, b) {
  const wordsA = normalizeWords(a);
  const wordsB = normalizeWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) shared++;
  }
  // Jaccard similarity of the two word sets
  return shared / (wordsA.size + wordsB.size - shared) >= 0.6;
}

function groupSimilarCards(cards) {
  const result = [];
  // null is the open board outside the columns
  for (const column of [...RETRO_COLUMNS, null]) {
    const submitted = cards
      .filter((c) => c.column === column && c.isSubmitted && c.type === 'note')
      .sort((a, b) => b.votes - a.votes);
    const merged = new Set();

    for (const card of submitted) {
      if (merged.has(card.id)) continue;
      for (const other of submitted) {
        if (other === card || merged.has(other.id)) continue;
        if (!isSimilar(card.content, other.content)) continue;

        card.groupedCards.push(
          { content: other.content, author: other.author },
          ...other.groupedCards
        );
        for (const voter of other.voters) {
          if (!card.voters.includes(voter)) card.voters.push(voter);
        }
        card.votes = card.voters.length;
        merged.add(other.id);
      }
    }

    result.push(
      ...cards.filter((c) => c.column === column && !merged.has(c.id))
    );
  }
  return result;
}

// ---------- GIFs ----------

function isGiphyUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && hostname.endsWith('.giphy.com');
  } catch {
    return false;
  }
}

// Returns a random GIF URL from GIPHY for a mood, or null if unavailable
function createGifPicker({ apiKey, fetchImpl }) {
  const cache = new Map(); // query -> { urls, fetchedAt }
  // Everyone in a room asks at once on reveal, so share one in-flight request
  const inflight = new Map(); // query -> Promise<string[]>

  function search(query) {
    if (!inflight.has(query)) {
      inflight.set(
        query,
        fetchGifs(query).finally(() => inflight.delete(query))
      );
    }
    return inflight.get(query);
  }

  async function fetchGifs(query) {
    const params = new URLSearchParams({
      api_key: apiKey,
      q: query,
      limit: '50',
      rating: 'g',
    });
    const response = await fetchImpl(`${GIPHY_SEARCH_URL}?${params}`, {
      signal: AbortSignal.timeout(GIPHY_TIMEOUT),
    });
    if (!response.ok) {
      throw new Error(`GIPHY responded with ${response.status}`);
    }
    const { data = [] } = await response.json();
    return data
      .map((gif) => gif.images?.fixed_height?.webp ?? gif.images?.original?.url)
      .filter(isGiphyUrl);
  }

  return async function randomGif(mood = 'celebrate') {
    const queries = GIF_MOODS[mood];
    if (!apiKey || !queries) return null;

    const query = queries[Math.floor(Math.random() * queries.length)];
    let entry = cache.get(query);
    if (!entry || Date.now() - entry.fetchedAt > GIPHY_CACHE_TTL) {
      try {
        entry = { urls: await search(query), fetchedAt: Date.now() };
        cache.set(query, entry);
      } catch (error) {
        console.error('Failed to fetch GIFs:', error.message);
        // Fall back to stale results if we have any
        if (!entry) return null;
      }
    }

    const { urls } = entry;
    return urls.length > 0 ? urls[Math.floor(Math.random() * urls.length)] : null;
  };
}

// ---------- Server ----------

function createServer({
  accessCode = process.env.ACCESS_CODE,
  giphyApiKey = process.env.GIPHY_API_KEY,
  fetchImpl = fetch,
  revealDelay = DEFAULT_REVEAL_DELAY,
} = {}) {
  const app = express();
  const server = http.createServer(app);
  // Changes on every start; pages that reconnect to a newer server reload so
  // nobody keeps running old code (room data doesn't survive a restart anyway)
  const buildId = crypto.randomUUID();
  const io = new Server(server, { maxHttpBufferSize: MAX_SOCKET_MESSAGE });

  if (!accessCode) {
    console.warn(
      'ACCESS_CODE is not set - all access will be denied until it is configured.'
    );
  }
  const expectedToken = accessCode ? accessToken(accessCode) : null;
  const hasAccess = (cookieHeader) =>
    expectedToken !== null &&
    safeEqual(readCookie(cookieHeader, ACCESS_COOKIE) ?? '', expectedToken);
  const requireAccess = (req, res, next) =>
    hasAccess(req.headers.cookie)
      ? next()
      : res.status(403).json({ error: 'Access code required' });

  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
          // Inline onclick="" handlers in the HTML pages
          'script-src-attr': ["'unsafe-inline'"],
          'style-src': [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net',
            'https://fonts.googleapis.com',
          ],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://api.dicebear.com',
            'https://*.giphy.com',
          ],
          'media-src': ["'self'", 'data:'],
          'worker-src': ["'self'", 'blob:'],
          'upgrade-insecure-requests': null,
        },
      },
    })
  );
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  const accessLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  app.get('/access-status', (req, res) => {
    res.json({ valid: hasAccess(req.headers.cookie) });
  });

  app.post('/validate-access', accessLimiter, (req, res) => {
    const submitted = req.body?.accessCode;
    if (!accessCode || typeof submitted !== 'string') {
      return res.json({ valid: false });
    }
    if (!safeEqual(submitted, accessCode)) {
      return res.json({ valid: false });
    }

    res.cookie(ACCESS_COOKIE, expectedToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: ACCESS_COOKIE_MAX_AGE,
      path: '/',
    });
    res.json({ valid: true });
  });

  const randomGif = createGifPicker({ apiKey: giphyApiKey, fetchImpl });

  app.get('/api/gif', requireAccess, async (req, res) => {
    const mood = typeof req.query.mood === 'string' ? req.query.mood : 'celebrate';
    if (!GIF_MOODS[mood]) {
      return res.status(400).json({ error: 'Unknown mood' });
    }
    res.json({ url: await randomGif(mood) });
  });

  // Data stores
  // room -> { participants: Map<sessionId, participant>, revealed, revealing,
  //           revealTimer, story, deck, streak, results, history }
  const pointingRooms = new Map();
  // room -> { cards: [], participants: Map<socketId, name>, lastActivity, zCounter }
  const retroRooms = new Map();
  // sessionId -> { room, socketId, disconnectedAt }
  const sessions = new Map();
  // imageId -> { room, buffer, contentType, createdAt, cardId }
  const retroImages = new Map();

  // ---------- Retro images ----------

  function roomImageUsage(room) {
    let count = 0;
    let bytes = 0;
    for (const image of retroImages.values()) {
      if (image.room === room) {
        count++;
        bytes += image.buffer.length;
      }
    }
    return { count, bytes };
  }

  const isHeaderImage = (image) => image.cardId?.startsWith('header:') ?? false;

  function deleteImages(predicate) {
    for (const [id, image] of retroImages) {
      if (predicate(image)) retroImages.delete(id);
    }
  }

  app.post(
    '/api/retro-images',
    requireAccess,
    uploadLimiter,
    express.raw({ type: Object.keys(IMAGE_SIGNATURES), limit: MAX_IMAGE_BYTES }),
    (req, res) => {
      const room = cleanRoom(req.query.room);
      const contentType = req.headers['content-type'];
      if (!room || !retroRooms.has(room)) {
        return res.status(404).json({ error: 'Unknown retro room' });
      }
      if (
        !Buffer.isBuffer(req.body) ||
        req.body.length === 0 ||
        !IMAGE_SIGNATURES[contentType]?.(req.body)
      ) {
        return res.status(415).json({ error: 'Unsupported image' });
      }

      const usage = roomImageUsage(room);
      if (
        usage.count >= MAX_IMAGES_PER_ROOM ||
        usage.bytes + req.body.length > MAX_IMAGE_BYTES_PER_ROOM
      ) {
        return res.status(413).json({ error: 'This board is full of images' });
      }

      const id = crypto.randomUUID();
      retroImages.set(id, {
        room,
        buffer: req.body,
        contentType,
        createdAt: Date.now(),
        cardId: null,
      });
      res.status(201).json({ id });
    }
  );

  app.get('/api/retro-images/:id', requireAccess, (req, res) => {
    const image = retroImages.get(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.set({
      'Content-Type': image.contentType,
      'Cache-Control': 'private, max-age=86400, immutable',
    });
    res.send(image.buffer);
  });

  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Image is too large' });
    }
    next(error);
  });

  app.get('/:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  function logRoomState(roomId, action, roomType = 'retro') {
    const rooms = roomType === 'retro' ? retroRooms : pointingRooms;
    const room = rooms.get(roomId);
    console.log(`[${action}] ${roomType} room ${roomId}:`, {
      participants: room
        ? Array.from(room.participants.values()).map((p) => p.name ?? p)
        : [],
      cardCount: room && roomType === 'retro' ? room.cards.length : 'N/A',
      timestamp: new Date().toISOString(),
    });
  }

  // ---------- Pointing ----------

  // Votes stay hidden until the room is revealed; avatars are only sent when
  // the participant list changes, since custom images can be large.
  function pointingState(roomId, room, { withAvatars }) {
    return {
      room: roomId,
      revealed: room.revealed,
      revealing: room.revealing,
      story: room.story,
      deck: room.deck,
      streak: room.streak,
      results: room.revealed ? room.results : null,
      participants: Array.from(room.participants, ([sessionId, p]) => ({
        id: p.id,
        name: p.name,
        ...(withAvatars && { avatar: p.avatar, avatarType: p.avatarType }),
        online: Boolean(sessions.get(sessionId)?.socketId),
        hasVoted: p.vote !== null,
        vote: room.revealed ? p.vote : null,
      })),
    };
  }

  function broadcastPointing(roomId, event = 'roomState', { withAvatars = false } = {}) {
    const room = pointingRooms.get(roomId);
    if (room) {
      io.to(roomId).emit(event, pointingState(roomId, room, { withAvatars }));
    }
  }

  function removePointingParticipant(roomId, sessionId) {
    const room = pointingRooms.get(roomId);
    if (!room) return;
    room.participants.delete(sessionId);
    if (room.participants.size === 0) {
      clearTimeout(room.revealTimer);
      pointingRooms.delete(roomId);
    } else {
      broadcastPointing(roomId, 'roomState', { withAvatars: true });
    }
  }

  function revealPointing(roomId) {
    const room = pointingRooms.get(roomId);
    if (!room) return;

    room.revealing = false;
    room.revealTimer = null;
    room.revealed = true;
    room.results = summarizeVotes(
      Array.from(room.participants.values()).filter((p) => p.vote !== null),
      room.deck
    );
    room.streak = room.results.consensus ? room.streak + 1 : 0;
    broadcastPointing(roomId, 'votesRevealed');
  }

  function clearPointingVotes(room) {
    clearTimeout(room.revealTimer);
    room.revealTimer = null;
    room.revealing = false;
    room.revealed = false;
    room.results = null;
    for (const participant of room.participants.values()) {
      participant.vote = null;
    }
  }

  // ---------- Retro ----------

  function retroParticipantNames(room) {
    return [...new Set(room.participants.values())];
  }

  function leaveRetro(socket) {
    const membership = socket.data.retro;
    if (!membership) return;
    socket.data.retro = null;
    socket.leave(membership.room);

    const room = retroRooms.get(membership.room);
    if (!room) return;
    room.participants.delete(socket.id);
    room.lastActivity = Date.now();
    if (!retroParticipantNames(room).includes(membership.name)) {
      io.to(membership.room).emit('participantLeft', { name: membership.name });
    }
    io.to(membership.room).emit('updateParticipants', {
      participants: retroParticipantNames(room),
    });
  }

  // Items can sit in a column or anywhere else on the board (column null)
  const isPlacementColumn = (column) =>
    column === null || RETRO_COLUMNS.includes(column);

  function placement(roomData, { column = null, x, y }) {
    return {
      column,
      x: clamp(x, 0, MAX_BOARD_SIZE, 0),
      y: clamp(y, 0, MAX_BOARD_SIZE, 0),
      z: ++roomData.zCounter,
    };
  }

  io.use((socket, next) => {
    if (hasAccess(socket.handshake.headers.cookie)) {
      next();
    } else {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    console.log('New client connected', socket.id);
    socket.emit('serverInfo', { buildId });
    socket.data.pointing = null; // { room, sessionId }
    socket.data.retro = null; // { room, name }
    socket.data.lastReaction = 0;
    socket.data.lastNudge = 0;

    // Wraps a handler so a bad payload can never take the whole server down
    const on = (event, handler) => {
      socket.on(event, (payload, ...rest) => {
        try {
          const data = payload && typeof payload === 'object' ? payload : {};
          handler(data, ...rest);
        } catch (error) {
          console.error(`Error handling "${event}" from ${socket.id}:`, error);
        }
      });
    };

    const currentPointing = () => {
      const membership = socket.data.pointing;
      const room = membership && pointingRooms.get(membership.room);
      return room ? { ...membership, roomData: room } : null;
    };

    // Agile Pointing handlers
    on('joinRoom', (payload) => {
      const room = cleanRoom(payload.room);
      const name = cleanName(payload.name);
      const { avatar, avatarType } = payload;
      if (!room || !name || !isValidAvatar(avatar, avatarType)) {
        socket.emit('joinError', 'Invalid room, name, or avatar.');
        return;
      }

      const sessionId =
        typeof payload.sessionId === 'string' &&
        SESSION_PATTERN.test(payload.sessionId) &&
        sessions.has(payload.sessionId)
          ? payload.sessionId
          : crypto.randomUUID();

      // Moving to a different room: drop the old membership first
      const current = socket.data.pointing;
      if (current && (current.room !== room || current.sessionId !== sessionId)) {
        socket.leave(current.room);
        if (current.sessionId !== sessionId) {
          removePointingParticipant(current.room, current.sessionId);
          sessions.delete(current.sessionId);
        }
      }
      const previous = sessions.get(sessionId);
      if (previous && previous.room !== room) {
        removePointingParticipant(previous.room, sessionId);
      }

      if (!pointingRooms.has(room)) {
        pointingRooms.set(room, {
          participants: new Map(),
          revealed: false,
          revealing: false,
          revealTimer: null,
          story: '',
          deck: DEFAULT_DECK,
          streak: 0,
          results: null,
          history: [],
        });
      }
      const roomData = pointingRooms.get(room);
      const existing = roomData.participants.get(sessionId);
      const participant = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        avatar,
        avatarType,
        vote: existing?.vote ?? null,
      };
      roomData.participants.set(sessionId, participant);

      sessions.set(sessionId, {
        room,
        socketId: socket.id,
        disconnectedAt: null,
      });
      socket.data.pointing = { room, sessionId };
      socket.join(room);

      socket.emit('joined', { sessionId, participantId: participant.id });
      socket.emit('history', roomData.history);
      broadcastPointing(room, 'roomState', { withAvatars: true });
      logRoomState(room, 'join', 'pointing');
    });

    on('leaveRoom', () => {
      const membership = socket.data.pointing;
      if (!membership) return;
      socket.data.pointing = null;
      socket.leave(membership.room);
      sessions.delete(membership.sessionId);
      removePointingParticipant(membership.room, membership.sessionId);
      logRoomState(membership.room, 'leave', 'pointing');
    });

    on('vote', (payload) => {
      const current = currentPointing();
      const participant = current?.roomData.participants.get(current.sessionId);
      // Cards are locked once the countdown starts
      if (!participant || current.roomData.revealed || current.roomData.revealing) {
        return;
      }

      participant.vote = cleanVote(payload.vote, current.roomData.deck);
      broadcastPointing(current.room);
    });

    on('revealVotes', () => {
      const current = currentPointing();
      if (!current) return;
      const { roomData, room } = current;
      if (roomData.revealed || roomData.revealing) return;

      if (revealDelay > 0) {
        roomData.revealing = true;
        io.to(room).emit('revealCountdown', {
          seconds: Math.round(revealDelay / 1000),
        });
        broadcastPointing(room);
        roomData.revealTimer = setTimeout(() => revealPointing(room), revealDelay);
      } else {
        revealPointing(room);
      }
    });

    on('resetVotes', () => {
      const current = currentPointing();
      if (!current) return;
      const { roomData, room } = current;

      // Finishing a revealed round records it and moves on to the next story
      if (roomData.revealed) {
        roomData.history.unshift({
          story: roomData.story,
          suggested: roomData.results.suggested,
          average: roomData.results.average,
          consensus: roomData.results.consensus,
          votes: roomData.results.total,
          deck: roomData.deck,
          at: Date.now(),
        });
        roomData.history.length = Math.min(roomData.history.length, MAX_HISTORY);
        roomData.story = '';
        io.to(room).emit('history', roomData.history);
      }
      clearPointingVotes(roomData);
      broadcastPointing(room, 'votesReset');
    });

    on('setStory', (payload) => {
      const current = currentPointing();
      const story = cleanText(payload.story, MAX_STORY_LENGTH, { allowEmpty: true });
      if (!current || story === null) return;

      current.roomData.story = story;
      broadcastPointing(current.room);
    });

    on('setDeck', (payload) => {
      const current = currentPointing();
      if (!current || !DECKS[payload.deck]) return;
      if (current.roomData.deck === payload.deck) return;

      current.roomData.deck = payload.deck;
      clearPointingVotes(current.roomData);
      broadcastPointing(current.room, 'votesReset');
    });

    on('react', (payload) => {
      const current = currentPointing();
      if (!current || !REACTIONS.includes(payload.emoji)) return;
      const now = Date.now();
      if (now - socket.data.lastReaction < REACTION_COOLDOWN) return;
      socket.data.lastReaction = now;

      const participant = current.roomData.participants.get(current.sessionId);
      io.to(current.room).emit('reaction', {
        emoji: payload.emoji,
        from: participant.name,
      });
    });

    on('nudge', (payload) => {
      const current = currentPointing();
      if (!current || typeof payload.targetId !== 'string') return;
      const now = Date.now();
      if (now - socket.data.lastNudge < NUDGE_COOLDOWN) return;

      const from = current.roomData.participants.get(current.sessionId);
      const target = Array.from(current.roomData.participants.values()).find(
        (p) => p.id === payload.targetId
      );
      if (!target || target === from || target.vote !== null) return;
      socket.data.lastNudge = now;

      io.to(current.room).emit('nudge', { targetId: target.id, from: from.name });
    });

    // Retro handlers
    // Handlers return { upsert: card }, { remove: cardId }, { reload: true }
    // or nothing when the event was ignored.
    const withRetroRoom = (handler) => (payload, ack) => {
      const membership = socket.data.retro;
      const roomData = membership && retroRooms.get(membership.room);
      if (!roomData) return;

      const change = handler(roomData, payload, membership, ack);
      if (!change) return;
      roomData.lastActivity = Date.now();
      if (change.upsert) {
        io.to(membership.room).emit('cardUpserted', { card: change.upsert });
      } else if (change.remove) {
        io.to(membership.room).emit('cardRemoved', { cardId: change.remove });
      } else {
        io.to(membership.room).emit('loadCards', { cards: roomData.cards });
      }
    };

    const findCard = (roomData, cardId) =>
      roomData.cards.find((c) => c.id === cardId);

    on('joinRetro', (payload) => {
      const room = cleanRoom(payload.room);
      const name = cleanName(payload.name);
      if (!room || !name) return;

      leaveRetro(socket);
      console.log(`${name} joining retro room ${room}`);
      socket.join(room);
      socket.data.retro = { room, name };

      if (!retroRooms.has(room)) {
        retroRooms.set(room, {
          cards: [],
          participants: new Map(),
          lastActivity: Date.now(),
          zCounter: 0,
          headers: {}, // column -> imageId shown above the column
        });
        console.log(`Created new retro room: ${room}`);
      }
      const roomData = retroRooms.get(room);
      roomData.participants.set(socket.id, name);
      roomData.lastActivity = Date.now();

      // Send existing cards to the new participant
      socket.emit('loadCards', { cards: roomData.cards });
      socket.emit('columnHeaders', { headers: roomData.headers });

      io.to(room).emit('participantJoined', { name });
      io.to(room).emit('updateParticipants', {
        participants: retroParticipantNames(roomData),
      });
      logRoomState(room, 'join');
    });

    const newCard = (roomData, membership, fields) => ({
      id: crypto.randomUUID(),
      type: 'note',
      content: '',
      color: 'yellow',
      votes: 0,
      voters: [],
      author: membership.name,
      isSubmitted: false,
      groupedCards: [],
      w: null, // null = default size
      h: null, // notes only; images keep their aspect ratio
      ...fields,
    });

    on(
      'addCard',
      withRetroRoom((roomData, payload, membership, ack) => {
        if (!isPlacementColumn(payload.column ?? null)) return;
        if (roomData.cards.length >= MAX_CARDS_PER_ROOM) return;

        const card = newCard(roomData, membership, {
          color: NOTE_COLORS.includes(payload.color) ? payload.color : 'yellow',
          ...placement(roomData, payload),
        });
        roomData.cards.push(card);
        // Defer so the creator receives the card before the ack
        if (typeof ack === 'function') setImmediate(() => ack(card.id));
        return { upsert: card };
      })
    );

    on(
      'addImage',
      withRetroRoom((roomData, payload, membership, ack) => {
        const image = retroImages.get(payload.imageId);
        if (!isPlacementColumn(payload.column ?? null)) return;
        if (!['image', 'sketch'].includes(payload.type)) return;
        if (!image || image.room !== membership.room || image.cardId) return;
        if (roomData.cards.length >= MAX_CARDS_PER_ROOM) return;

        const card = newCard(roomData, membership, {
          type: payload.type,
          imageId: payload.imageId,
          isSubmitted: true,
          // Doodles arrive at the size they were drawn
          w: clamp(payload.w, MIN_ITEM_WIDTH, MAX_ITEM_SIZE, null),
          ...placement(roomData, payload),
        });
        image.cardId = card.id;
        roomData.cards.push(card);
        if (typeof ack === 'function') setImmediate(() => ack(card.id));
        return { upsert: card };
      })
    );

    on(
      'submitCard',
      withRetroRoom((roomData, { cardId, content }) => {
        const card = findCard(roomData, cardId);
        const cleaned = cleanCardContent(content);
        if (!card || card.type !== 'note' || !cleaned) return;

        card.content = cleaned;
        card.isSubmitted = true;
        return { upsert: card };
      })
    );

    on(
      'deleteCard',
      withRetroRoom((roomData, { cardId }) => {
        const card = findCard(roomData, cardId);
        if (!card) return;

        roomData.cards = roomData.cards.filter((c) => c !== card);
        if (card.imageId) retroImages.delete(card.imageId);
        return { remove: card.id };
      })
    );

    on(
      'voteCard',
      withRetroRoom((roomData, { cardId }, membership) => {
        const card = findCard(roomData, cardId);
        if (!card || !card.isSubmitted) return;

        const voterIndex = card.voters.indexOf(membership.name);
        if (voterIndex === -1) {
          card.voters.push(membership.name);
        } else {
          card.voters.splice(voterIndex, 1);
        }
        card.votes = card.voters.length;
        return { upsert: card };
      })
    );

    on(
      'moveCard',
      withRetroRoom((roomData, payload) => {
        const card = findCard(roomData, payload.cardId);
        const column = payload.column ?? null;
        if (!card || !isPlacementColumn(column)) return;

        Object.assign(card, placement(roomData, { ...card, ...payload, column }));
        return { upsert: card };
      })
    );

    on(
      'resizeCard',
      withRetroRoom((roomData, payload) => {
        const card = findCard(roomData, payload.cardId);
        if (!card) return;

        card.w = clamp(payload.w, MIN_ITEM_WIDTH, MAX_ITEM_SIZE, card.w);
        card.h =
          card.type === 'note'
            ? clamp(payload.h, MIN_ITEM_HEIGHT, MAX_ITEM_SIZE, card.h)
            : null;
        return { upsert: card };
      })
    );

    on(
      'resetRetro',
      withRetroRoom((roomData, payload, membership) => {
        roomData.cards = [];
        // Column header images are part of the board's look, so they stay
        deleteImages(
          (image) => image.room === membership.room && !isHeaderImage(image)
        );
        return { reload: true };
      })
    );

    on('setColumnImage', (payload) => {
      const membership = socket.data.retro;
      const roomData = membership && retroRooms.get(membership.room);
      if (!roomData || !RETRO_COLUMNS.includes(payload.column)) return;

      const { column, imageId } = payload;
      if (imageId !== null) {
        const image = retroImages.get(imageId);
        if (!image || image.room !== membership.room || image.cardId) return;
        image.cardId = `header:${column}`;
      }

      const previous = roomData.headers[column];
      if (previous && previous !== imageId) retroImages.delete(previous);
      roomData.headers[column] = imageId;
      roomData.lastActivity = Date.now();
      io.to(membership.room).emit('columnHeaders', { headers: roomData.headers });
    });

    on(
      'groupSimilarCards',
      withRetroRoom((roomData) => {
        roomData.cards = groupSimilarCards(roomData.cards);
        return { reload: true };
      })
    );

    socket.on('disconnect', () => {
      console.log('Client disconnected', socket.id);
      leaveRetro(socket);

      // Mark session as disconnected but keep it in the room for a while so
      // a page refresh can pick it back up
      const membership = socket.data.pointing;
      const session = membership && sessions.get(membership.sessionId);
      if (session && session.socketId === socket.id) {
        session.disconnectedAt = Date.now();
        session.socketId = null;
        broadcastPointing(membership.room);
        console.log(`Session ${membership.sessionId} marked as disconnected`);
      }
    });
  });

  // Clean up inactive rooms and sessions periodically
  const cleanupTimer = setInterval(() => {
    const now = Date.now();

    sessions.forEach((session, sessionId) => {
      if (
        session.disconnectedAt &&
        now - session.disconnectedAt > DISCONNECTED_THRESHOLD
      ) {
        removePointingParticipant(session.room, sessionId);
        sessions.delete(sessionId);
        console.log(`Cleaned up inactive session ${sessionId}`);
      }
    });

    retroRooms.forEach((room, roomId) => {
      if (
        room.participants.size === 0 &&
        now - room.lastActivity > INACTIVE_THRESHOLD
      ) {
        retroRooms.delete(roomId);
        deleteImages((image) => image.room === roomId);
        console.log(`Cleaned up inactive retro room: ${roomId}`);
      }
    });

    deleteImages(
      (image) => !image.cardId && now - image.createdAt > UNATTACHED_IMAGE_TTL
    );
  }, CLEANUP_INTERVAL);
  cleanupTimer.unref();

  server.on('close', () => {
    clearInterval(cleanupTimer);
    for (const room of pointingRooms.values()) clearTimeout(room.revealTimer);
  });

  return { app, server, io, pointingRooms, retroRooms, sessions, retroImages };
}

if (require.main === module) {
  const { server } = createServer();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = {
  createServer,
  accessToken,
  groupSimilarCards,
  isSimilar,
  summarizeVotes,
  DECKS,
  REACTIONS,
};
