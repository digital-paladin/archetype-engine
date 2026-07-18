# Archetype Engine Backend

Node.js + Express backend that parses `character-sheet.md` and serves character data via REST API + WebSocket.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` file:**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env`:**
   ```
   PORT=3000
   CHARACTER_FILE_PATH=../character-sheet.md
   CORS_ORIGIN=http://localhost:4200
   ```

## Development

**Start dev server (auto-reload on code changes):**
```bash
npm run dev
```

Server runs at: `http://localhost:3000`

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and timestamp.

### Get Full Character Data
```
GET /api/character
```
Returns complete character data (XP, levels, vitality, sleep debt, skill trees, phase info).

### Get Skill Trees Only
```
GET /api/character/skill-trees
```
Returns array of skill trees (faster endpoint).

### Get Stats Only
```
GET /api/character/stats
```
Returns vitality, sleep debt, and phase info.

### Get History (Paginated)
```
GET /api/character/history?limit=10&offset=0
```
Returns paginated history entries (TODO: Week 9-10).

### Update XP (Future)
```
POST /api/character/xp-update
Body: {
  "tree": "redteamer",
  "pendingXP": 28,
  "breakdown": { ... },
  "timestamp": "2025-11-23T18:00:00Z"
}
```
For Copilot to trigger UI updates (TODO: Future enhancement).

## WebSocket Events

**Client connects:**
- Server logs connection ID
- Client receives real-time updates when `character-sheet.md` changes

**Event: `character:updated`**
```json
{
  "data": { /* CharacterData object */ },
  "timestamp": "2025-11-23T18:30:00Z"
}
```

**Event: `character:error`**
```json
{
  "message": "Failed to parse character file",
  "timestamp": "2025-11-23T18:30:00Z"
}
```

## Project Structure

```
backend/
├── src/
│   ├── server.ts                 # Express app entry point
│   ├── models/
│   │   └── character.model.ts    # TypeScript interfaces
│   ├── parser/
│   │   └── characterParser.ts    # Markdown → JSON parser (TODO Week 1-2)
│   ├── routes/
│   │   └── character.routes.ts   # API endpoints
│   └── services/
│       └── fileWatcher.service.ts # Watches character-sheet.md changes
├── dist/                         # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
├── nodemon.json
└── .env
```

## Week 1-2 TODO

- [ ] Implement `characterParser.ts` regex patterns
- [ ] Extract XP values from each skill tree section
- [ ] Extract vitality and sleep debt
- [ ] Extract phase information
- [ ] Parse active buffs for each tree
- [ ] Write unit tests for parser
- [ ] Test with actual `character-sheet.md`

## Testing

```bash
npm test
```

(Tests not yet implemented - TODO Week 1-2)

## Build for Production

```bash
npm run build
npm start
```

## Troubleshooting

**Port already in use:**
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Change PORT in .env
PORT=3001
```

**File watcher not detecting changes:**
- Check `CHARACTER_FILE_PATH` in `.env` is correct
- Ensure file exists and has read permissions
- Try absolute path instead of relative

**CORS errors from frontend:**
- Verify `CORS_ORIGIN` in `.env` matches frontend URL
- Default: `http://localhost:4200` (Angular dev server)
