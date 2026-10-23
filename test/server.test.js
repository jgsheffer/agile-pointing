const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const {
  createServer,
  accessToken,
  isSimilar,
  summarizeVotes,
} = require('../server');

const ACCESS_CODE = 'test-code';
const COOKIE = `agileAccess=${accessToken(ACCESS_CODE)}`;
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
);

function startServer(options = {}) {
  const instance = createServer({
    accessCode: ACCESS_CODE,
    revealDelay: 0,
    ...options,
  });
  return new Promise((resolve) => {
    instance.server.listen(0, () => {
      instance.url = `http://localhost:${instance.server.address().port}`;
      resolve(instance);
    });
  });
}

function stopServer(instance) {
  return new Promise((resolve) => {
    instance.io.close();
    instance.server.close(() => resolve());
  });
}

const clients = [];

function connect(url, { cookie = COOKIE } = {}) {
  const socket = ioClient(url, {
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
    forceNew: true,
  });
  clients.push(socket);
  return socket;
}

function waitFor(socket, event, predicate = () => true, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeout);
    function handler(payload) {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      }
    }
    socket.on(event, handler);
  });
}

const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

async function joinPointing(url, room, name, extra = {}) {
  const socket = connect(url);
  const joined = waitFor(socket, 'joined');
  const state = waitFor(socket, 'roomState', (s) =>
    s.participants.some((p) => p.name === name)
  );
  socket.emit('joinRoom', {
    room,
    name,
    avatar: '😀',
    avatarType: 'emoji',
    ...extra,
  });
  const { sessionId, participantId } = await joined;
  return { socket, sessionId, participantId, state: await state };
}

async function joinRetro(url, room, name) {
  const socket = connect(url);
  const loaded = waitFor(socket, 'loadCards');
  socket.emit('joinRetro', { room, name });
  await loaded;
  return socket;
}

after(() => {
  for (const socket of clients) socket.disconnect();
});

describe('access control', () => {
  test('denies everything when ACCESS_CODE is not set', async () => {
    const instance = await startServer({ accessCode: '' });
    try {
      const res = await fetch(`${instance.url}/validate-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.deepEqual(await res.json(), { valid: false });
    } finally {
      await stopServer(instance);
    }
  });

  describe('with ACCESS_CODE set', () => {
    let instance;
    before(async () => {
      instance = await startServer();
    });
    after(() => stopServer(instance));

    test('rejects a wrong code without setting a cookie', async () => {
      const res = await fetch(`${instance.url}/validate-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: 'nope' }),
      });
      assert.deepEqual(await res.json(), { valid: false });
      assert.equal(res.headers.get('set-cookie'), null);
    });

    test('accepts the right code and sets an httpOnly cookie', async () => {
      const res = await fetch(`${instance.url}/validate-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: ACCESS_CODE }),
      });
      assert.deepEqual(await res.json(), { valid: true });
      const cookie = res.headers.get('set-cookie');
      assert.match(cookie, /agileAccess=/);
      assert.match(cookie, /HttpOnly/);

      const status = await fetch(`${instance.url}/access-status`, {
        headers: { cookie: COOKIE },
      });
      assert.deepEqual(await status.json(), { valid: true });
    });

    test('ignores the old client-side accessCode cookie', async () => {
      const status = await fetch(`${instance.url}/access-status`, {
        headers: { cookie: 'accessCode=true' },
      });
      assert.deepEqual(await status.json(), { valid: false });
    });

    test('tells clients which server run they are talking to', async () => {
      const first = await waitFor(connect(instance.url), 'serverInfo');
      const again = await waitFor(connect(instance.url), 'serverInfo');
      assert.equal(first.buildId, again.buildId);

      const restarted = await startServer();
      try {
        const other = await waitFor(connect(restarted.url), 'serverInfo');
        assert.notEqual(other.buildId, first.buildId);
      } finally {
        await stopServer(restarted);
      }
    });

    test('refuses socket connections without the access cookie', async () => {
      const socket = connect(instance.url, { cookie: 'accessCode=true' });
      const error = await waitFor(socket, 'connect_error');
      assert.equal(error.message, 'unauthorized');
    });
  });
});

describe('GIFs', () => {
  const giphyResponse = (urls) => ({
    ok: true,
    json: async () => ({
      data: urls.map((url) => ({ images: { fixed_height: { webp: url } } })),
    }),
  });

  async function getGif(instance, { cookie = COOKIE, mood = 'celebrate' } = {}) {
    const res = await fetch(`${instance.url}/api/gif?mood=${mood}`, {
      headers: cookie ? { cookie } : {},
    });
    return { status: res.status, body: await res.json() };
  }

  test('requires access', async () => {
    const instance = await startServer({
      giphyApiKey: 'key',
      fetchImpl: async () => giphyResponse(['https://media1.giphy.com/a.webp']),
    });
    try {
      assert.equal((await getGif(instance, { cookie: null })).status, 403);
    } finally {
      await stopServer(instance);
    }
  });

  test('rejects unknown moods', async () => {
    const instance = await startServer({ giphyApiKey: 'key' });
    try {
      assert.equal((await getGif(instance, { mood: 'anything' })).status, 400);
    } finally {
      await stopServer(instance);
    }
  });

  test('returns null without an API key so the page uses its fallback list', async () => {
    const instance = await startServer({ giphyApiKey: '' });
    try {
      assert.deepEqual((await getGif(instance)).body, { url: null });
    } finally {
      await stopServer(instance);
    }
  });

  test('returns a random GIPHY result per mood and caches searches', async () => {
    const requests = [];
    const instance = await startServer({
      giphyApiKey: 'key',
      fetchImpl: async (url) => {
        requests.push(new URL(url));
        return giphyResponse([
          'https://media1.giphy.com/a.webp',
          'https://media2.giphy.com/b.webp',
          'https://evil.example.com/c.webp',
        ]);
      },
    });
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => getGif(instance))
      );
      for (const { body } of results) {
        assert.match(body.url, /^https:\/\/media[12]\.giphy\.com\//);
      }
      // One request per search term at most, however many people ask
      const queries = requests.map((url) => url.searchParams.get('q'));
      assert.equal(new Set(queries).size, queries.length);
      assert.equal(requests[0].searchParams.get('rating'), 'g');

      await getGif(instance, { mood: 'coffee' });
      assert.match(requests.at(-1).searchParams.get('q'), /coffee/);
    } finally {
      await stopServer(instance);
    }
  });

  test('returns null when GIPHY is unavailable', async () => {
    const instance = await startServer({
      giphyApiKey: 'key',
      fetchImpl: async () => ({ ok: false, status: 429 }),
    });
    try {
      assert.deepEqual((await getGif(instance)).body, { url: null });
    } finally {
      await stopServer(instance);
    }
  });
});

describe('vote summaries', () => {
  const votes = (...values) => values.map((vote, i) => ({ name: `P${i}`, vote }));

  test('suggests the nearest card to the average, rounding ties up', () => {
    const summary = summarizeVotes(votes(3, 5, 8, 'Pass', '☕'), 'fibonacci');
    assert.equal(summary.average, 5.33);
    assert.equal(summary.suggested, 5);
    assert.equal(summary.counted, 3);
    assert.equal(summary.coffee, 1);
    assert.equal(summary.pass, 1);
    assert.equal(summarizeVotes(votes(3, 5), 'fibonacci').suggested, 5);
  });

  test('calls out the lowest and highest voters on a wide spread', () => {
    const summary = summarizeVotes(votes(2, 5, 13), 'fibonacci');
    assert.equal(summary.talk, true);
    assert.deepEqual(summary.low, [{ name: 'P0', vote: 2 }]);
    assert.deepEqual(summary.high, [{ name: 'P2', vote: 13 }]);
  });

  test('detects consensus and ignores non-scale cards', () => {
    assert.equal(summarizeVotes(votes(5, 5, '?'), 'fibonacci').consensus, true);
    assert.equal(summarizeVotes(votes(5), 'fibonacci').consensus, false);
  });

  test('handles t-shirt sizes without an average', () => {
    const summary = summarizeVotes(votes('S', 'M', 'L'), 'tshirt');
    assert.equal(summary.average, null);
    assert.equal(summary.suggested, 'M');
  });
});

describe('agile pointing', () => {
  let instance;
  before(async () => {
    instance = await startServer();
  });
  after(() => stopServer(instance));

  test('survives events for rooms that do not exist', async () => {
    const socket = connect(instance.url);
    await waitFor(socket, 'connect');
    socket.emit('revealVotes', 'no-such-room');
    socket.emit('resetVotes', 'no-such-room');
    socket.emit('vote', null);
    socket.emit('joinRoom', null);

    const res = await fetch(`${instance.url}/access-status`);
    assert.equal(res.status, 200);
  });

  test('rejects names or avatars that are not allowed', async () => {
    const socket = connect(instance.url);
    const error = waitFor(socket, 'joinError');
    socket.emit('joinRoom', {
      room: 'room-a',
      name: 'Mallory',
      avatar: '<img src=x onerror=alert(1)>',
      avatarType: 'dicebear',
    });
    assert.match(await error, /Invalid/);
  });

  test('hides votes until they are revealed', async () => {
    const alice = await joinPointing(instance.url, 'room-b', 'Alice');
    const bob = await joinPointing(instance.url, 'room-b', 'Bob');

    const update = waitFor(alice.socket, 'roomState', (s) =>
      s.participants.some((p) => p.hasVoted)
    );
    bob.socket.emit('vote', { vote: 8 });
    const hidden = await update;
    const bobView = hidden.participants.find((p) => p.name === 'Bob');
    assert.equal(hidden.revealed, false);
    assert.equal(bobView.hasVoted, true);
    assert.equal(bobView.vote, null);
    assert.equal(bobView.avatar, undefined);
    assert.equal(bobView.online, true);

    const revealed = waitFor(alice.socket, 'votesRevealed');
    alice.socket.emit('revealVotes');
    const shown = await revealed;
    assert.equal(shown.participants.find((p) => p.name === 'Bob').vote, 8);
    assert.equal(shown.results.suggested, 8);

    const reset = waitFor(alice.socket, 'votesReset');
    bob.socket.emit('resetVotes');
    const cleared = await reset;
    assert.equal(cleared.revealed, false);
    assert.ok(cleared.participants.every((p) => !p.hasVoted));
  });

  test('locks votes once revealed', async () => {
    const carol = await joinPointing(instance.url, 'room-lock', 'Carol');
    carol.socket.emit('vote', { vote: 3 });
    await waitFor(carol.socket, 'roomState', (s) => s.participants[0].hasVoted);
    const revealed = waitFor(carol.socket, 'votesRevealed');
    carol.socket.emit('revealVotes');
    await revealed;

    carol.socket.emit('vote', { vote: 13 });
    await pause();
    const [participant] = instance.pointingRooms.get('room-lock').participants.values();
    assert.equal(participant.vote, 3);
  });

  test('counts down before revealing', async () => {
    const slow = await startServer({ revealDelay: 150 });
    try {
      const dana = await joinPointing(slow.url, 'room-count', 'Dana');
      const countdown = waitFor(dana.socket, 'revealCountdown');
      const revealing = waitFor(dana.socket, 'roomState', (s) => s.revealing);
      dana.socket.emit('revealVotes');
      assert.equal((await countdown).seconds, 0);
      assert.equal((await revealing).revealed, false);
      const revealed = await waitFor(dana.socket, 'votesRevealed');
      assert.equal(revealed.revealing, false);
      assert.equal(revealed.revealed, true);
    } finally {
      await stopServer(slow);
    }
  });

  test('records values outside the deck as Cheater', async () => {
    const carol = await joinPointing(instance.url, 'room-c', 'Carol');
    carol.socket.emit('vote', { vote: 100 });
    await waitFor(carol.socket, 'roomState', (s) => s.participants[0].hasVoted);

    const revealed = waitFor(carol.socket, 'votesRevealed');
    carol.socket.emit('revealVotes');
    assert.equal((await revealed).participants[0].vote, 'Cheater');
  });

  test('tracks consensus streaks and history across rounds', async () => {
    const erin = await joinPointing(instance.url, 'room-streak', 'Erin');
    const finn = await joinPointing(instance.url, 'room-streak', 'Finn');

    for (const expected of [1, 2]) {
      erin.socket.emit('vote', { vote: 5 });
      finn.socket.emit('vote', { vote: 5 });
      await waitFor(erin.socket, 'roomState', (s) =>
        s.participants.every((p) => p.hasVoted)
      );
      const revealed = waitFor(erin.socket, 'votesRevealed');
      erin.socket.emit('revealVotes');
      assert.equal((await revealed).streak, expected);

      const history = waitFor(erin.socket, 'history');
      erin.socket.emit('resetVotes');
      assert.equal((await history).length, expected);
    }

    erin.socket.emit('vote', { vote: 1 });
    finn.socket.emit('vote', { vote: 13 });
    await waitFor(erin.socket, 'roomState', (s) =>
      s.participants.every((p) => p.hasVoted)
    );
    const broken = waitFor(erin.socket, 'votesRevealed');
    erin.socket.emit('revealVotes');
    const { streak, results } = await broken;
    assert.equal(streak, 0);
    assert.equal(results.talk, true);
  });

  test('shares the story and clears it for the next round', async () => {
    const gus = await joinPointing(instance.url, 'room-story', 'Gus');
    const updated = waitFor(gus.socket, 'roomState', (s) => s.story === 'Login page');
    gus.socket.emit('setStory', { story: '  Login page  ' });
    await updated;

    gus.socket.emit('revealVotes');
    await waitFor(gus.socket, 'votesRevealed');
    const history = waitFor(gus.socket, 'history');
    const reset = waitFor(gus.socket, 'votesReset');
    gus.socket.emit('resetVotes');
    assert.equal((await history)[0].story, 'Login page');
    assert.equal((await reset).story, '');
  });

  test('switches decks and validates votes against the current deck', async () => {
    const hana = await joinPointing(instance.url, 'room-deck', 'Hana');
    const switched = waitFor(hana.socket, 'votesReset', (s) => s.deck === 'tshirt');
    hana.socket.emit('setDeck', { deck: 'tshirt' });
    await switched;

    hana.socket.emit('vote', { vote: 'M' });
    await waitFor(hana.socket, 'roomState', (s) => s.participants[0].hasVoted);
    const revealed = waitFor(hana.socket, 'votesRevealed');
    hana.socket.emit('revealVotes');
    const { participants, results } = await revealed;
    assert.equal(participants[0].vote, 'M');
    assert.equal(results.suggested, 'M');
  });

  test('broadcasts allowed reactions only', async () => {
    const ivy = await joinPointing(instance.url, 'room-react', 'Ivy');
    const jon = await joinPointing(instance.url, 'room-react', 'Jon');

    const reaction = waitFor(jon.socket, 'reaction');
    ivy.socket.emit('react', { emoji: '<script>' });
    await pause(300);
    ivy.socket.emit('react', { emoji: '🎉' });
    assert.deepEqual(await reaction, { emoji: '🎉', from: 'Ivy' });
  });

  test('nudges participants who have not voted', async () => {
    const kai = await joinPointing(instance.url, 'room-nudge', 'Kai');
    const lee = await joinPointing(instance.url, 'room-nudge', 'Lee');

    const nudge = waitFor(lee.socket, 'nudge');
    kai.socket.emit('nudge', { targetId: lee.participantId });
    assert.deepEqual(await nudge, { targetId: lee.participantId, from: 'Kai' });
  });

  test('marks participants offline when they disconnect', async () => {
    const mo = await joinPointing(instance.url, 'room-away', 'Mo');
    const ned = await joinPointing(instance.url, 'room-away', 'Ned');

    const update = waitFor(mo.socket, 'roomState', (s) =>
      s.participants.some((p) => p.name === 'Ned' && !p.online)
    );
    ned.socket.disconnect();
    await update;
  });

  test('ignores votes from sockets that have not joined the room', async () => {
    const dave = await joinPointing(instance.url, 'room-d', 'Dave');
    const outsider = connect(instance.url);
    await waitFor(outsider, 'connect');
    outsider.emit('vote', { room: 'room-d', vote: 13 });
    outsider.emit('revealVotes', 'room-d');

    await pause();
    const room = instance.pointingRooms.get('room-d');
    assert.equal(room.revealed, false);
    assert.equal(dave.state.participants.length, 1);
  });

  test('removes the participant on leaveRoom', async () => {
    const erin = await joinPointing(instance.url, 'room-e', 'Erin');
    const frank = await joinPointing(instance.url, 'room-e', 'Frank');

    const update = waitFor(erin.socket, 'roomState', (state) =>
      state.participants.every((p) => p.name !== 'Frank')
    );
    frank.socket.emit('leaveRoom');
    assert.deepEqual(
      (await update).participants.map((p) => p.name),
      ['Erin']
    );
  });

  test('moves a session to the new room instead of leaving a ghost', async () => {
    const grace = await joinPointing(instance.url, 'room-f', 'Grace');
    const heidi = await joinPointing(instance.url, 'room-f', 'Heidi');

    const update = waitFor(grace.socket, 'roomState', (state) =>
      state.participants.every((p) => p.name !== 'Heidi')
    );
    await joinPointing(instance.url, 'room-g', 'Heidi', {
      sessionId: heidi.sessionId,
    });
    assert.deepEqual(
      (await update).participants.map((p) => p.name),
      ['Grace']
    );
  });
});

describe('retro', () => {
  let instance;
  before(async () => {
    instance = await startServer();
  });
  after(() => stopServer(instance));

  const addCard = (socket, payload) =>
    new Promise((resolve) => socket.emit('addCard', payload, resolve));

  async function upload(room, { body = PNG_BYTES, type = 'image/png', cookie = COOKIE } = {}) {
    const res = await fetch(
      `${instance.url}/api/retro-images?room=${encodeURIComponent(room)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': type, ...(cookie && { cookie }) },
        body,
      }
    );
    return { status: res.status, body: await res.json() };
  }

  test('creates notes with server-generated ids, positions and colors', async () => {
    const socket = await joinRetro(instance.url, 'RETRO1', 'Anon Panda');

    const cardId = await addCard(socket, {
      column: 'kudos',
      color: 'pink',
      x: 1.7,
      y: 120,
      id: "x');alert(1)//",
    });
    assert.match(cardId, /^[0-9a-f-]{36}$/);

    socket.emit('addCard', { column: 'not-a-column' });
    socket.emit('addCard', { column: 'went-well', color: 'url(evil)' });
    await pause();
    const cards = instance.retroRooms.get('RETRO1').cards;
    assert.equal(cards.length, 2);
    assert.deepEqual(
      { column: cards[0].column, color: cards[0].color, x: cards[0].x, y: cards[0].y },
      { column: 'kudos', color: 'pink', x: 1.7, y: 120 }
    );
    assert.equal(cards[0].author, 'Anon Panda');
    assert.equal(cards[1].color, 'yellow');
  });

  test('moves notes freely between columns and brings them to the front', async () => {
    const socket = await joinRetro(instance.url, 'RETRO-MOVE', 'Anon Lynx');
    const first = await addCard(socket, { column: 'went-well', x: 0, y: 0 });
    await addCard(socket, { column: 'went-well', x: 0.5, y: 10 });

    const moved = waitFor(socket, 'cardUpserted', ({ card }) => card.id === first);
    socket.emit('moveCard', { cardId: first, column: 'improve', x: 0.25, y: 300 });
    const { card } = await moved;
    assert.equal(card.column, 'improve');
    assert.equal(card.x, 0.25);
    assert.equal(card.y, 300);
    assert.equal(card.z, 3);
  });

  test('places items anywhere on the board, outside the columns too', async () => {
    const socket = await joinRetro(instance.url, 'RETRO-FREE', 'Anon Ibis');
    const cardId = await addCard(socket, { column: null, x: 4200, y: 99999 });
    const card = instance.retroRooms.get('RETRO-FREE').cards[0];
    assert.equal(card.id, cardId);
    assert.equal(card.column, null);
    assert.equal(card.x, 4200);
    assert.equal(card.y, 20000);

    const moved = waitFor(socket, 'cardUpserted', ({ card: c }) => c.column === 'improve');
    socket.emit('moveCard', { cardId, column: 'improve', x: 900, y: 300 });
    await moved;
    const freed = waitFor(socket, 'cardUpserted', ({ card: c }) => c.column === null);
    socket.emit('moveCard', { cardId, column: null, x: -50, y: 10 });
    assert.equal((await freed).card.x, 0);
  });

  test('resizes notes freely and images by width only, within limits', async () => {
    const socket = await joinRetro(instance.url, 'RETRO-SIZE', 'Anon Yak');
    const noteId = await addCard(socket, { column: 'went-well' });

    let resized = waitFor(socket, 'cardUpserted', ({ card }) => card.w !== null);
    socket.emit('resizeCard', { cardId: noteId, w: 5000, h: 10 });
    assert.deepEqual(
      (({ w, h }) => ({ w, h }))((await resized).card),
      { w: 1600, h: 80 }
    );

    const { body } = await upload('RETRO-SIZE');
    const imageId = await new Promise((resolve) =>
      socket.emit('addImage', { imageId: body.id, type: 'image', column: null, x: 10, y: 10 }, resolve)
    );
    resized = waitFor(socket, 'cardUpserted', ({ card }) => card.id === imageId && card.w === 480);
    socket.emit('resizeCard', { cardId: imageId, w: 480, h: 900 });
    assert.equal((await resized).card.h, null);
  });

  test('ignores card events from sockets that have not joined', async () => {
    await joinRetro(instance.url, 'RETRO2', 'Anon Fox');
    const outsider = connect(instance.url);
    await waitFor(outsider, 'connect');
    outsider.emit('addCard', { room: 'RETRO2', column: 'improve' });
    outsider.emit('resetRetro', { room: 'RETRO2' });

    await pause();
    assert.equal(instance.retroRooms.get('RETRO2').cards.length, 0);
  });

  test('removes participants when they disconnect', async () => {
    const owl = await joinRetro(instance.url, 'RETRO3', 'Anon Owl');
    const wolf = await joinRetro(instance.url, 'RETRO3', 'Anon Wolf');

    const update = waitFor(owl, 'updateParticipants', ({ participants }) =>
      participants.length === 1
    );
    wolf.disconnect();
    assert.deepEqual((await update).participants, ['Anon Owl']);
  });

  test('groups similar notes and merges their votes', async () => {
    const socket = await joinRetro(instance.url, 'RETRO4', 'Anon Bear');
    const addAndSubmit = async (column, content) => {
      const cardId = await addCard(socket, { column });
      const submitted = waitFor(socket, 'cardUpserted', ({ card }) =>
        card.id === cardId && card.isSubmitted
      );
      socket.emit('submitCard', { cardId, content });
      await submitted;
      return cardId;
    };

    const first = await addAndSubmit('improve', 'Standups run too long');
    await addAndSubmit('improve', 'standups run too long!');
    await addAndSubmit('improve', 'More pairing');
    socket.emit('voteCard', { cardId: first });

    const grouped = waitFor(socket, 'loadCards', ({ cards }) => cards.length === 2);
    socket.emit('groupSimilarCards');
    const { cards } = await grouped;
    const merged = cards.find((c) => c.id === first);
    assert.equal(merged.groupedCards.length, 1);
    assert.equal(merged.votes, 1);
  });

  test('uploads images, places them on the board and deletes them with the card', async () => {
    const socket = await joinRetro(instance.url, 'RETRO-IMG', 'Anon Seal');

    assert.equal((await upload('RETRO-IMG', { cookie: null })).status, 403);
    assert.equal((await upload('NO-SUCH-ROOM')).status, 404);
    assert.equal(
      (await upload('RETRO-IMG', { body: Buffer.from('<svg></svg>'), type: 'image/png' })).status,
      415
    );
    assert.equal(
      (await upload('RETRO-IMG', { body: Buffer.from('<svg></svg>'), type: 'image/svg+xml' })).status,
      415
    );

    const { status, body } = await upload('RETRO-IMG');
    assert.equal(status, 201);

    const placed = waitFor(socket, 'cardUpserted');
    socket.emit('addImage', { imageId: body.id, type: 'sketch', column: 'kudos', x: 0.1, y: 40 });
    const { card } = await placed;
    assert.equal(card.type, 'sketch');
    assert.equal(card.imageId, body.id);
    assert.equal(card.isSubmitted, true);

    // The same upload can't be placed twice
    socket.emit('addImage', { imageId: body.id, type: 'image', column: 'kudos' });
    await pause();
    assert.equal(instance.retroRooms.get('RETRO-IMG').cards.length, 1);

    const image = await fetch(`${instance.url}/api/retro-images/${body.id}`, {
      headers: { cookie: COOKIE },
    });
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG_BYTES);

    const removed = waitFor(socket, 'cardRemoved');
    socket.emit('deleteCard', { cardId: card.id });
    await removed;
    const gone = await fetch(`${instance.url}/api/retro-images/${body.id}`, {
      headers: { cookie: COOKIE },
    });
    assert.equal(gone.status, 404);
  });

  test('sets, replaces and removes column header images, keeping them on reset', async () => {
    const socket = await joinRetro(instance.url, 'RETRO-HEAD', 'Anon Crow');
    const imageStatus = async (id) =>
      (await fetch(`${instance.url}/api/retro-images/${id}`, { headers: { cookie: COOKIE } })).status;

    const first = (await upload('RETRO-HEAD')).body.id;
    let headers = waitFor(socket, 'columnHeaders', (h) => h.headers.kudos === first);
    socket.emit('setColumnImage', { column: 'kudos', imageId: first });
    await headers;

    // Header images can't also be placed as cards
    socket.emit('addImage', { imageId: first, type: 'image', column: 'kudos' });
    socket.emit('setColumnImage', { column: 'nope', imageId: first });

    const second = (await upload('RETRO-HEAD')).body.id;
    headers = waitFor(socket, 'columnHeaders', (h) => h.headers.kudos === second);
    socket.emit('setColumnImage', { column: 'kudos', imageId: second });
    await headers;
    assert.equal(await imageStatus(first), 404);
    assert.equal(instance.retroRooms.get('RETRO-HEAD').cards.length, 0);

    const reset = waitFor(socket, 'loadCards');
    socket.emit('resetRetro');
    await reset;
    assert.equal(await imageStatus(second), 200);

    // A newcomer gets the headers when joining
    const late = connect(instance.url);
    const lateHeaders = waitFor(late, 'columnHeaders');
    late.emit('joinRetro', { room: 'RETRO-HEAD', name: 'Anon Late' });
    assert.equal((await lateHeaders).headers.kudos, second);

    headers = waitFor(socket, 'columnHeaders', (h) => h.headers.kudos === null);
    socket.emit('setColumnImage', { column: 'kudos', imageId: null });
    await headers;
    assert.equal(await imageStatus(second), 404);
  });

  test('rejects images over the size limit', async () => {
    await joinRetro(instance.url, 'RETRO-BIG', 'Anon Moose');
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(1024 * 1024 + 1)]);
    assert.equal((await upload('RETRO-BIG', { body: big })).status, 413);
  });

  test('isSimilar compares words, not punctuation or case', () => {
    assert.equal(isSimilar('Deploys are slow', 'deploys are SLOW.'), true);
    assert.equal(isSimilar('Deploys are slow', 'Great teamwork'), false);
  });
});
