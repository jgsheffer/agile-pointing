# NetJets Agile Tools: Agile Pointing & Sprint Retro

A real-time collaborative application for agile teams, featuring Agile Pointing for story estimation and a sprint retrospective board.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

### Agile Pointing
- Real-time story point estimation using Fibonacci sequence
- Anonymous voting with reveal/reset functionality
- Visual consensus indicators with confetti effect
- Participant status tracking
- Room-based collaboration

### Sprint Retrospective
- Three-column retrospective board
- Real-time card creation and editing
- Voting system for prioritization
- Drag-and-drop card organization
- PDF export functionality
- 5-minute discussion timer
- Similar card grouping

### Shared Features
- Room-based collaboration with shareable links
- Anonymous animal-based naming system
- Dark theme with Material Design
- Real-time participant tracking
- Persistent sessions

## Tech Stack

### Backend
- Node.js
- Express
- Socket.IO

### Frontend
- HTML5
- Tailwind CSS
- Material Design
- WebSocket (Socket.IO Client)

### Additional Libraries
- UUID: Session management
- jsPDF & html2canvas: PDF generation
- Dragula: Drag-and-drop functionality

## Project Structure
```plaintext
project-root/
├── server.js                # Main server file
├── package.json
└── public/
    ├── index.html          # Agile Pointing interface
    ├── retro.html          # Retrospective interface
    └── retro.js            # Retrospective logic
```

## Data Structures

### Server-Side Storage
```javascript
// Agile Pointing Rooms
const pointingRooms = new Map();  // roomId -> Map<sessionId, participantData>

// Retro Rooms
const retroRooms = new Map();     // roomId -> { cards[], participants: Set }

// Sessions
const sessions = new Map();       // sessionId -> sessionData
```

### Card Structure
```javascript
{
    id: string,
    content: string,
    column: string,
    votes: number,
    author: string,
    voters: string[],
    isSubmitted: boolean,
    groupedCards?: Array<{content: string, author: string}>
}
```

## Socket Events

### Agile Pointing
- `joinRoom`
- `vote`
- `revealVotes`
- `resetVotes`

### Retrospective
- `joinRetro`
- `addCard`
- `submitCard`
- `voteCard`
- `deleteCard`
- `moveCard`
- `resetRetro`
- `groupSimilarCards`

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd [project-directory]
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
node server.js
```

## Dependencies

### NPM Packages
```json
{
  "dependencies": {
    "express": "^4.17.1",
    "socket.io": "^4.5.1",
    "uuid": "^8.3.2"
  },
  "devDependencies": {
    "nodemon": "^2.0.20"
  }
}
```

### CDN Resources
```html
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.5.1/socket.io.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dragula/3.7.3/dragula.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
```

## Usage

### Accessing the Application
- Agile Pointing: `http://localhost:3000`
- Retrospective: `http://localhost:3000/retro.html`
- Room-specific: Add `?room=ROOMID` to any URL

### Creating a Room
1. Visit either the Agile Pointing or retro page
2. Room is automatically created with random ID
3. Share the room link with participants

### Agile Pointing
1. Join with anonymous animal name
2. Vote on story points using Fibonacci numbers
3. Reveal votes when everyone has voted
4. Reset for next story

### Retrospective
1. Add cards to appropriate columns
2. Submit cards to make them visible to others
3. Vote on cards for prioritization
4. Use timer for timeboxed discussions
5. Export to PDF when complete

## Development Notes

### Persistence
- In-memory storage with 24-hour retention
- Room cleanup runs hourly
- Session persistence via localStorage
- Cards persist until room reset

### Performance
- Real-time updates via WebSocket
- Efficient card sorting by vote count
- Optimized PDF generation with pagination

### Security
- Anonymous participation
- Room-based isolation
- No data persistence beyond session

## Production Considerations

### Scaling
- Implement database storage
- Add Redis for session management
- Configure load balancing
- Set up monitoring and logging

### Security
- Add rate limiting
- Implement authentication
- Add input validation
- Enable CORS protection

### Reliability
- Add error recovery
- Implement backup systems
- Add health checks
- Set up alerting

## License

MIT License - See LICENSE file for details

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Support

For support, please open an issue in the repository.