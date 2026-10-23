// server.js
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const VOTE_VALUES = [1, 2, 3, 5, 8, 13, 'Pass'];
const INVALID_VOTE = 'Cheater';
const RETRO_COLUMNS = ['went-well', 'improve', 'action-items'];

const ACCESS_COOKIE = 'agileAccess';
const ACCESS_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 365 days

const MAX_NAME_LENGTH = 40;
const MAX_CARD_LENGTH = 2000;
const MAX_CARDS_PER_ROOM = 500;
const MAX_AVATAR_LENGTH = 360 * 1024; // ~256KB image once base64 encoded
const MAX_SOCKET_MESSAGE = 512 * 1024;

const ROOM_PATTERN = /^[\w -]{1,64}$/;
const SESSION_PATTERN = /^[0-9a-f-]{36}$/;
const DICEBEAR_PATTERN =
  /^https:\/\/api\.dicebear\.com\/\d+\.x\/[a-z-]+\/svg\?seed=[A-Za-z0-9]+$/;
const CUSTOM_AVATAR_PATTERN =
  /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';
const CELEBRATION_QUERIES = [
  'celebrate',
  'celebration',
  'high five',
  'nailed it',
  'party',
  'success',
];
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

function cleanName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH
    ? trimmed
    : null;
}

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

function cleanVote(vote) {
  return VOTE_VALUES.includes(vote) ? vote : INVALID_VOTE;
}

function cleanCardContent(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_CARD_LENGTH
    ? trimmed
    : null;
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
  for (const column of RETRO_COLUMNS) {
    const submitted = cards
      .filter((c) => c.column === column && c.isSubmitted)
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
      ...cards.filter(
        (c) => c.column === column && !(c.isSubmitted && merged.has(c.id))
      )
    );
  }
  return result;
}

// ---------- Celebration GIFs ----------

function isGiphyUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && hostname.endsWith('.giphy.com');
  } catch {
    return false;
  }
}

// Returns a random celebration GIF URL from GIPHY, or null if unavailable
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

  return async function randomCelebrationGif() {
    if (!apiKey) return null;

    const query =
      CELEBRATION_QUERIES[Math.floor(Math.random() * CELEBRATION_QUERIES.length)];
    let entry = cache.get(query);
    if (!entry || Date.now() - entry.fetchedAt > GIPHY_CACHE_TTL) {
      try {
        entry = { urls: await search(query), fetchedAt: Date.now() };
        cache.set(query, entry);
      } catch (error) {
        console.error('Failed to fetch celebration GIFs:', error.message);
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
} = {}) {
  const app = express();
  const server = http.createServer(app);
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

  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': [
            "'self'",
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com',
          ],
          // Inline onclick="" handlers in the HTML pages
          'script-src-attr': ["'unsafe-inline'"],
          'style-src': [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com',
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

  const randomCelebrationGif = createGifPicker({
    apiKey: giphyApiKey,
    fetchImpl,
  });

  app.get('/api/celebration-gif', async (req, res) => {
    if (!hasAccess(req.headers.cookie)) {
      return res.status(403).json({ error: 'Access code required' });
    }
    res.json({ url: await randomCelebrationGif() });
  });

  app.get('/:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Data stores
  // room -> { participants: Map<sessionId, participant>, revealed: boolean }
  const pointingRooms = new Map();
  // room -> { cards: [], participants: Map<socketId, name>, lastActivity }
  const retroRooms = new Map();
  // sessionId -> { room, socketId, disconnectedAt }
  const sessions = new Map();

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

  // Votes stay hidden until the room is revealed; avatars are only sent when
  // the participant list changes, since custom images can be large.
  function participantView(room, { withAvatars }) {
    return {
      revealed: room.revealed,
      participants: Array.from(room.participants.values()).map((p) => ({
        id: p.id,
        name: p.name,
        ...(withAvatars && { avatar: p.avatar, avatarType: p.avatarType }),
        hasVoted: p.vote !== null,
        vote: room.revealed ? p.vote : null,
      })),
    };
  }

  function broadcastPointing(roomId, event, { withAvatars = false } = {}) {
    const room = pointingRooms.get(roomId);
    if (room) {
      io.to(roomId).emit(event, participantView(room, { withAvatars }));
    }
  }

  function removePointingParticipant(roomId, sessionId) {
    const room = pointingRooms.get(roomId);
    if (!room) return;
    room.participants.delete(sessionId);
    if (room.participants.size === 0) {
      pointingRooms.delete(roomId);
    } else {
      broadcastPointing(roomId, 'updateParticipants', { withAvatars: true });
    }
  }

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

  io.use((socket, next) => {
    if (hasAccess(socket.handshake.headers.cookie)) {
      next();
    } else {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    console.log('New client connected', socket.id);
    socket.data.pointing = null; // { room, sessionId }
    socket.data.retro = null; // { room, name }

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

    // Agile Pointing handlers
    on('joinRoom', (payload = {}) => {
      const room = cleanRoom(payload.room);
      const name = cleanName(payload.name);
      const { avatar, avatarType } = payload;
      if (!room || !name || !isValidAvatar(avatar, avatarType)) {
        socket.emit('joinError', 'Invalid room, name, or avatar.');
        return;
      }

      let sessionId =
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
        pointingRooms.set(room, { participants: new Map(), revealed: false });
      }
      const roomData = pointingRooms.get(room);
      const existing = roomData.participants.get(sessionId);
      roomData.participants.set(sessionId, {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        avatar,
        avatarType,
        vote: existing?.vote ?? null,
      });

      sessions.set(sessionId, {
        room,
        socketId: socket.id,
        disconnectedAt: null,
      });
      socket.data.pointing = { room, sessionId };
      socket.join(room);

      socket.emit('sessionCreated', sessionId);
      broadcastPointing(room, 'updateParticipants', { withAvatars: true });
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

    on('vote', (payload = {}) => {
      const membership = socket.data.pointing;
      const room = membership && pointingRooms.get(membership.room);
      const participant = room?.participants.get(membership.sessionId);
      if (!participant) return;

      participant.vote = cleanVote(payload.vote);
      broadcastPointing(membership.room, 'updateVotes');
    });

    on('revealVotes', () => {
      const membership = socket.data.pointing;
      const room = membership && pointingRooms.get(membership.room);
      if (!room) return;

      room.revealed = true;
      broadcastPointing(membership.room, 'votesRevealed');
    });

    on('resetVotes', () => {
      const membership = socket.data.pointing;
      const room = membership && pointingRooms.get(membership.room);
      if (!room) return;

      room.revealed = false;
      for (const participant of room.participants.values()) {
        participant.vote = null;
      }
      broadcastPointing(membership.room, 'votesReset');
    });

    // Retro handlers
    const withRetroRoom = (handler) => (payload = {}, ack) => {
      const membership = socket.data.retro;
      const roomData = membership && retroRooms.get(membership.room);
      if (!roomData) return;

      if (handler(roomData, payload, membership, ack) !== false) {
        roomData.lastActivity = Date.now();
        io.to(membership.room).emit('loadCards', { cards: roomData.cards });
      }
    };

    on('joinRetro', (payload = {}) => {
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
        });
        console.log(`Created new retro room: ${room}`);
      }
      const roomData = retroRooms.get(room);
      roomData.participants.set(socket.id, name);
      roomData.lastActivity = Date.now();

      // Send existing cards to the new participant
      socket.emit('loadCards', { cards: roomData.cards });

      io.to(room).emit('participantJoined', { name });
      io.to(room).emit('updateParticipants', {
        participants: retroParticipantNames(roomData),
      });
      logRoomState(room, 'join');
    });

    on(
      'addCard',
      withRetroRoom((roomData, { column }, membership, ack) => {
        if (!RETRO_COLUMNS.includes(column)) return false;
        if (roomData.cards.length >= MAX_CARDS_PER_ROOM) return false;

        const card = {
          id: crypto.randomUUID(),
          content: '',
          column,
          votes: 0,
          voters: [],
          author: membership.name,
          isSubmitted: false,
          groupedCards: [],
        };
        roomData.cards.push(card);
        // Defer so the creator receives loadCards before the ack
        if (typeof ack === 'function') setImmediate(() => ack(card.id));
      })
    );

    on(
      'submitCard',
      withRetroRoom((roomData, { cardId, content }) => {
        const card = roomData.cards.find((c) => c.id === cardId);
        const cleaned = cleanCardContent(content);
        if (!card || !cleaned) return false;

        card.content = cleaned;
        card.isSubmitted = true;
      })
    );

    on(
      'deleteCard',
      withRetroRoom((roomData, { cardId }) => {
        const before = roomData.cards.length;
        roomData.cards = roomData.cards.filter((card) => card.id !== cardId);
        if (roomData.cards.length === before) return false;
      })
    );

    on(
      'voteCard',
      withRetroRoom((roomData, { cardId }, membership) => {
        const card = roomData.cards.find((c) => c.id === cardId);
        if (!card || !card.isSubmitted) return false;

        const voterIndex = card.voters.indexOf(membership.name);
        if (voterIndex === -1) {
          card.voters.push(membership.name);
        } else {
          card.voters.splice(voterIndex, 1);
        }
        card.votes = card.voters.length;
      })
    );

    on(
      'moveCard',
      withRetroRoom((roomData, { cardId, newColumn }) => {
        const card = roomData.cards.find((c) => c.id === cardId);
        if (!card || !RETRO_COLUMNS.includes(newColumn)) return false;

        card.column = newColumn;
      })
    );

    on(
      'resetRetro',
      withRetroRoom((roomData) => {
        roomData.cards = [];
      })
    );

    on(
      'groupSimilarCards',
      withRetroRoom((roomData) => {
        roomData.cards = groupSimilarCards(roomData.cards);
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
        console.log(`Cleaned up inactive retro room: ${roomId}`);
      }
    });
  }, CLEANUP_INTERVAL);
  cleanupTimer.unref();

  server.on('close', () => clearInterval(cleanupTimer));

  return { app, server, io, pointingRooms, retroRooms, sessions };
}

if (require.main === module) {
  const { server } = createServer();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = { createServer, accessToken, groupSimilarCards, isSimilar };
