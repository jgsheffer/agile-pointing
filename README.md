# NetJets Agile Tools: Agile Pointing & Sprint Retro

A real-time collaborative application for agile teams, featuring Agile Pointing for story estimation and a sprint retrospective board.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D24.22.1-green.svg)
![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)

## Features

### Agile Pointing
- Fibonacci (1–13) or T-shirt (XS–XL) decks, plus `?`, `☕` (break) and `Pass` cards
- Hidden voting: the server only shares *who* has voted until votes are revealed
- Live "4 of 6 voted" progress; the Reveal button glows once everyone is in
- 3-2-1 countdown with a drumroll, then cards flip over one by one
- Results: suggested card, average, vote distribution chart and a callout for the lowest/highest voters on a wide spread
- Consensus celebration: rainbow banner, confetti made of the voters' emoji avatars, a random GIPHY GIF and a "🔥 N in a row" streak that gets bigger each time
- Shared story title and a round history you can copy at the end of the meeting
- Emoji reactions that float across everyone's screen, and 👉 nudges for people who haven't voted
- Emoji (searchable, by category), generated (DiceBear) or custom image avatars
- Synthesized sound effects with a mute toggle, number-key shortcuts, reduced-motion support
- Away indicator for disconnected participants

### Sprint Retrospective
- A large zoomable canvas: scroll wheel (or pinch) zooms around the cursor, dragging empty space pans, with zoom controls and Fit; each person's view is remembered per room
- Four columns: What Went Well, What Could Be Improved, Action Items and Kudos, each with an optional header image
- Sticky notes, images and sketches go anywhere on the canvas, inside a column or not, and stay exactly where they're dropped
- Every item can be resized from its corner handle (images and sketches keep their proportions)
- Drag colored stickies from the pad, drop image files straight from your file explorer, or paste images
- Images show as polaroids (white frame, handwritten author, a slight tilt)
- Draw straight on the board: pen colors, a 1-60px size slider (`[` / `]`), eraser, undo; "Done drawing" saves the doodle with a transparent background, exactly where it was drawn, as a movable/resizable item
- Voting, similar-note grouping and a 5-minute timer

### Shared Features
- Access code gate shared by both boards
- Pointing / Retro tabs in the header; switching keeps the same room name
- Room-based collaboration with shareable links
- Retro names: pick your own, or get a random bread ("Anon Baguette"); remembered on your device, and renaming re-labels your notes and votes
- Dark theme
- Real-time participant tracking
- Persistent sessions

## Tech Stack

### Backend
- Node.js 24+
- Express 5
- Socket.IO 4
- Helmet (security headers / Content Security Policy)
- express-rate-limit (access code attempts)

### Frontend
- HTML5
- Tailwind CSS
- Material Design
- WebSocket (Socket.IO Client, served by the app at `/socket.io/socket.io.js`)

### Additional Libraries
- canvas-confetti: Consensus celebration (including emoji confetti)

## Project Structure
```plaintext
project-root/
├── server.js               # Express + Socket.IO server (exports createServer)
├── package.json
├── test/
│   └── server.test.js      # node:test suite
└── public/
    ├── index.html          # Agile Pointing interface + access code form
    ├── styles.css          # Agile Pointing styles
    ├── access.js           # Access code check / submission
    ├── emoji-data.js       # Avatar emoji picker data
    ├── sounds.js           # WebAudio sound effects
    ├── pointing.js         # Agile Pointing logic
    ├── retro.html          # Retrospective interface
    ├── retro.css           # Retrospective styles
    └── retro.js            # Retrospective logic
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `ACCESS_CODE` | Yes | Code users must enter. If unset, all access is denied. Changing it signs everyone out. |
| `GIPHY_API_KEY` | No | Enables random GIFs from GIPHY for results (get a free key at developers.giphy.com). Without it, built-in lists are used. |
| `PORT` | No | Port to listen on (default `3000`). |
| `TRUST_PROXY` | No | Set to the number of proxies in front of the app (e.g. `1`) so rate limiting and secure cookies see the real client IP/protocol. |

## Access Control

1. The user enters the access code on the main page.
2. `POST /validate-access` checks it (rate limited to 10 attempts per 15 minutes per IP) and sets an `httpOnly` cookie containing an HMAC derived from `ACCESS_CODE`.
3. `GET /access-status` tells the page whether the cookie is valid.
4. Socket.IO connections without a valid cookie are rejected, so no room data is available without access.

The retro page redirects to `/?next=/retro.html?room=...` when access is missing and returns after the code is entered.

## HTTP Endpoints

All of these except the access endpoints require the access cookie.

| Endpoint | Description |
|---|---|
| `GET /access-status` | `{ valid }` for the current cookie |
| `POST /validate-access` | `{ accessCode }` → sets the access cookie |
| `GET /api/gif?mood=` | Random GIPHY URL for `celebrate`, `legendary`, `talk` or `coffee` (cached for an hour), or `null` |
| `POST /api/retro-images?room=` | Raw PNG/JPEG/WebP/GIF body, up to 1 MB → `{ id }`; 60 images / 30 MB per room |
| `GET /api/retro-images/:id` | The uploaded image |

## Data Structures

### Server-Side Storage
```javascript
// Agile Pointing Rooms
// roomId -> { participants: Map<sessionId, participant>, revealed, revealing,
//             story, deck, streak, results, history }
const pointingRooms = new Map();

// Retro Rooms
// roomId -> { cards: Card[], participants: Map<socketId, name>, lastActivity,
//             zCounter, headers: { [column]: imageId } }
const retroRooms = new Map();

// Sessions (pointing reconnects)
// sessionId -> { room, socketId, disconnectedAt }
const sessions = new Map();

// Retro images, kept in memory and deleted with their card or room
// imageId -> { room, buffer, contentType, createdAt, cardId }
const retroImages = new Map();
```

### Retro Item Structure
```javascript
{
    id: string,              // generated by the server
    type: 'note' | 'image' | 'sketch',
    content: string,         // notes only, up to 2000 characters
    color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'orange',
    imageId?: string,        // images and sketches
    column: 'went-well' | 'improve' | 'action-items' | 'kudos' | null, // null = open board
    x: number,               // canvas pixels from the left (0-20000)
    y: number,               // canvas pixels from the top (0-20000)
    z: number,               // stacking order, raised on every move
    w: number | null,        // width (120-4000), null for the default
    h: number | null,        // notes only; images keep their aspect ratio
    votes: number,
    author: string,
    voters: string[],
    isSubmitted: boolean,
    groupedCards: Array<{content: string, author: string}>
}
```

## Socket Events

Every event acts on the room the socket joined; room names sent with later events are ignored.

### Agile Pointing
- `joinRoom` `{ room, name, avatar, avatarType, sessionId? }` → `joined` `{ sessionId, participantId }` and `history`
- `leaveRoom`
- `vote` `{ vote }`: values outside the room's deck are recorded as `Cheater`; ignored once the reveal starts
- `revealVotes`: starts a 3 second `revealCountdown`, then `votesRevealed`
- `resetVotes`: after a reveal, records the round in `history` and clears the story ("Next story")
- `setStory` `{ story }` (up to 140 characters)
- `setDeck` `{ deck: 'fibonacci' | 'tshirt' }` (clears votes)
- `react` `{ emoji }` → `reaction` `{ emoji, from }` for one of 🎉 👍 🤔 😂 ☕ 🔥 ❤️ 👀 🚀 😱
- `nudge` `{ targetId }` → `nudge` `{ targetId, from }`

State arrives as `roomState`, `votesRevealed` and `votesReset`, each with `{ room, revealed, revealing, story, deck, streak, results, participants }`. Votes are `null` until revealed, avatars are only included when the participant list changes, and `results` holds the suggested card, average, distribution and low/high voters.

### Retrospective
- `joinRetro` `{ room, name }`
- `renameRetro` `{ name }` (acknowledged with the accepted name; re-labels your notes and votes)
- `addCard` `{ column, color, x, y }` (acknowledged with the new card id; `column` may be `null`)
- `addImage` `{ imageId, type: 'image' | 'sketch', column, x, y, w? }` after uploading (doodles send the width they were drawn at)
- `submitCard` `{ cardId, content }`
- `voteCard` `{ cardId }`
- `deleteCard` `{ cardId }` (also deletes the image)
- `moveCard` `{ cardId, column, x, y }`
- `resizeCard` `{ cardId, w, h }`
- `setColumnImage` `{ column, imageId | null }` → `columnHeaders` `{ headers }` (also sent on join)
- `resetRetro` (clears the board; header images stay)
- `groupSimilarCards`

Changes arrive as `cardUpserted` / `cardRemoved`, and the full board as `loadCards` on join, reset and grouping.

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd [project-directory]
```

2. Use Node 24 or newer (an `.nvmrc` is included):
```bash
nvm use
```

3. Install dependencies:
```bash
npm install
```

4. Start the server:
```bash
ACCESS_CODE=your-code npm start
```

5. Run the tests:
```bash
npm test
```

## Usage

### Accessing the Application
- Agile Pointing: `http://localhost:3000`
- Retrospective: `http://localhost:3000/retro.html`
- Room-specific: Add `?room=ROOMID` to any URL

Room IDs can use letters, numbers, spaces, `-` and `_` (up to 64 characters).

### Creating a Room
1. Visit either the Agile Pointing or retro page
2. Room is automatically created with random ID
3. Share the room link with participants

### Agile Pointing
1. Enter your name and choose an avatar (press Enter to join)
2. Optionally type the story you're estimating
3. Pick a card (or press its number key)
4. Reveal votes when everyone has voted
5. Talk through the results, then click "Next story"

Custom avatars are cropped and resized to 128×128 in the browser. Animated GIFs are kept as-is and must be under 256 KB.

### Retrospective
1. Drag a sticky from the pad anywhere on the board (or use ➕ on a column), type, then Submit (Ctrl+Enter)
2. Drop image files from your file explorer, paste or upload images, or hit ✏️ Draw, doodle anywhere and click "Done drawing"
3. Drag anything around the board and resize it from its corner; scroll to zoom, drag empty space to pan (`+` / `-` / `0` to fit / `1` for 100%)
4. Optionally give a column a header image (🖼 button, or drop an image on the header)
5. Vote on items for prioritization
6. Use timer for timeboxed discussions
7. Group similar notes to merge duplicates (and their votes)

## Development Notes

### Persistence
- In-memory storage only; everything is lost on restart
- Open pages reload themselves when they reconnect to a restarted server, so nobody keeps running old code
- Disconnected pointing sessions are kept for 30 minutes so a refresh rejoins
- Empty retro rooms (and their images) are removed after 24 hours of inactivity
- Uploaded images that are never placed on the board are removed after 10 minutes
- Cleanup runs hourly

### Security
- Access code enforced on the server for both HTTP and Socket.IO
- All socket input is validated (room IDs, names, avatars, votes, columns, colors, positions, card content)
- Uploaded images are checked against their file signatures; SVG is not accepted
- User content is rendered with `textContent` rather than HTML
- Helmet sets a Content Security Policy and other security headers

## Production Considerations

### Scaling
- Implement database storage
- Add Redis (and the Socket.IO Redis adapter) to run more than one instance
- Configure load balancing with sticky sessions
- Set up monitoring and logging

### Reliability
- Add health checks
- Set up alerting

## License

Apache License 2.0 - See LICENSE file for details

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Support

For support, please open an issue in the repository.
