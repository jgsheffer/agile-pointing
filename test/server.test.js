const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { createServer, accessToken, isSimilar } = require('../server');

const ACCESS_CODE = 'test-code';
const COOKIE = `agileAccess=${accessToken(ACCESS_CODE)}`;

function startServer(options = { accessCode: ACCESS_CODE }) {
  const instance = createServer(options);
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

async function joinPointing(url, room, name, extra = {}) {
  const socket = connect(url);
  const joined = waitFor(socket, 'updateParticipants', (state) =>
    state.participants.some((p) => p.name === name)
  );
  socket.emit('joinRoom', {
    room,
    name,
    avatar: '😀',
    avatarType: 'emoji',
    ...extra,
  });
  return { socket, state: await joined };
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

    test('refuses socket connections without the access cookie', async () => {
      const socket = connect(instance.url, { cookie: 'accessCode=true' });
      const error = await waitFor(socket, 'connect_error');
      assert.equal(error.message, 'unauthorized');
    });
  });
});

describe('celebration GIFs', () => {
  const giphyResponse = (urls) => ({
    ok: true,
    json: async () => ({
      data: urls.map((url) => ({ images: { fixed_height: { webp: url } } })),
    }),
  });

  async function getGif(instance, cookie = COOKIE) {
    const res = await fetch(`${instance.url}/api/celebration-gif`, {
      headers: cookie ? { cookie } : {},
    });
    return { status: res.status, body: await res.json() };
  }

  test('requires access', async () => {
    const instance = await startServer({
      accessCode: ACCESS_CODE,
      giphyApiKey: 'key',
      fetchImpl: async () => giphyResponse(['https://media1.giphy.com/a.webp']),
    });
    try {
      assert.equal((await getGif(instance, null)).status, 403);
    } finally {
      await stopServer(instance);
    }
  });

  test('returns null without an API key so the page uses its fallback list', async () => {
    const instance = await startServer({ accessCode: ACCESS_CODE, giphyApiKey: '' });
    try {
      assert.deepEqual((await getGif(instance)).body, { url: null });
    } finally {
      await stopServer(instance);
    }
  });

  test('returns a random GIPHY result and caches searches', async () => {
    const requests = [];
    const instance = await startServer({
      accessCode: ACCESS_CODE,
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
    } finally {
      await stopServer(instance);
    }
  });

  test('returns null when GIPHY is unavailable', async () => {
    const instance = await startServer({
      accessCode: ACCESS_CODE,
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

    const update = waitFor(alice.socket, 'updateVotes');
    bob.socket.emit('vote', { vote: 8 });
    const hidden = await update;
    const bobView = hidden.participants.find((p) => p.name === 'Bob');
    assert.equal(hidden.revealed, false);
    assert.equal(bobView.hasVoted, true);
    assert.equal(bobView.vote, null);
    assert.equal(bobView.avatar, undefined);

    const revealed = waitFor(alice.socket, 'votesRevealed');
    alice.socket.emit('revealVotes');
    const shown = await revealed;
    assert.equal(shown.participants.find((p) => p.name === 'Bob').vote, 8);

    const reset = waitFor(alice.socket, 'votesReset');
    bob.socket.emit('resetVotes');
    const cleared = await reset;
    assert.equal(cleared.revealed, false);
    assert.ok(cleared.participants.every((p) => !p.hasVoted));
  });

  test('records values outside the deck as Cheater', async () => {
    const carol = await joinPointing(instance.url, 'room-c', 'Carol');
    carol.socket.emit('vote', { vote: 100 });
    await waitFor(carol.socket, 'updateVotes');

    const revealed = waitFor(carol.socket, 'votesRevealed');
    carol.socket.emit('revealVotes');
    assert.equal((await revealed).participants[0].vote, 'Cheater');
  });

  test('ignores votes from sockets that have not joined the room', async () => {
    const dave = await joinPointing(instance.url, 'room-d', 'Dave');
    const outsider = connect(instance.url);
    await waitFor(outsider, 'connect');
    outsider.emit('vote', { room: 'room-d', vote: 13 });
    outsider.emit('revealVotes', 'room-d');

    const room = instance.pointingRooms.get('room-d');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(room.revealed, false);
    assert.equal(dave.state.participants.length, 1);
  });

  test('removes the participant on leaveRoom', async () => {
    const erin = await joinPointing(instance.url, 'room-e', 'Erin');
    const frank = await joinPointing(instance.url, 'room-e', 'Frank');

    const update = waitFor(erin.socket, 'updateParticipants', (state) =>
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
    const sessionId = await new Promise((resolve) => {
      const socket = connect(instance.url);
      socket.once('sessionCreated', resolve);
      socket.emit('joinRoom', {
        room: 'room-f',
        name: 'Heidi',
        avatar: '😎',
        avatarType: 'emoji',
      });
    });

    const update = waitFor(grace.socket, 'updateParticipants', (state) =>
      state.participants.every((p) => p.name !== 'Heidi')
    );
    await joinPointing(instance.url, 'room-g', 'Heidi', { sessionId });
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

  test('creates cards with server-generated ids and validates columns', async () => {
    const socket = await joinRetro(instance.url, 'RETRO1', 'Anon Panda');

    const cardId = await new Promise((resolve) =>
      socket.emit('addCard', { column: 'went-well', id: "x');alert(1)//" }, resolve)
    );
    assert.match(cardId, /^[0-9a-f-]{36}$/);

    socket.emit('addCard', { column: 'not-a-column' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const cards = instance.retroRooms.get('RETRO1').cards;
    assert.equal(cards.length, 1);
    assert.equal(cards[0].author, 'Anon Panda');
  });

  test('ignores card events from sockets that have not joined', async () => {
    await joinRetro(instance.url, 'RETRO2', 'Anon Fox');
    const outsider = connect(instance.url);
    await waitFor(outsider, 'connect');
    outsider.emit('addCard', { room: 'RETRO2', column: 'improve' });
    outsider.emit('resetRetro', { room: 'RETRO2' });

    await new Promise((resolve) => setTimeout(resolve, 100));
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

  test('groups similar cards and merges their votes', async () => {
    const socket = await joinRetro(instance.url, 'RETRO4', 'Anon Bear');
    const addAndSubmit = async (column, content) => {
      const cardId = await new Promise((resolve) =>
        socket.emit('addCard', { column }, resolve)
      );
      const loaded = waitFor(socket, 'loadCards', ({ cards }) =>
        cards.some((c) => c.id === cardId && c.isSubmitted)
      );
      socket.emit('submitCard', { cardId, content });
      await loaded;
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

  test('isSimilar compares words, not punctuation or case', () => {
    assert.equal(isSimilar('Deploys are slow', 'deploys are SLOW.'), true);
    assert.equal(isSimilar('Deploys are slow', 'Great teamwork'), false);
  });
});
