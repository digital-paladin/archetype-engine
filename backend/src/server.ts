import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import chokidar from 'chokidar';
import { FileWatcherService } from './services/fileWatcher.service';
import { characterRouter } from './routes/character.routes';
import characterProjectionRouter from './routes/characterProjection.routes';
import { activityRouter, setSocketIO } from './routes/activity.routes';
import authRouter from './routes/auth.routes';
import actionLogRouter from './routes/actionLog.routes';
import dailyMetricsRouter from './routes/dailyMetrics.routes';
import consumeRouter, { setConsumeSocketIO } from './routes/consume.routes';
import foodEstimateRouter from './routes/foodEstimate.routes';
import fitbitRouter from './routes/fitbit.routes';
import acmRouter from './routes/acm.routes';
import questsRouter from './routes/quests.routes';
import fastingRouter from './routes/fasting.routes';
import statusEffectsRouter from './routes/statusEffects.routes';
import vaultRouter from './routes/vault.routes';
import courageRouter from './routes/courage.routes';
import consolidationRouter from './routes/consolidation.routes';
import { rewardsCatalogRouter } from './routes/rewardsCatalog.routes';
import inventoryRouter from './routes/inventory.routes';
import treasuryRouter from './routes/treasury.routes';
import todoistRouter from './routes/todoist.routes';
import { authMiddleware } from './middleware/auth.middleware';
import { FitbitService } from './services/fitbit.service';
import { getDataService } from './services/data/dataService';
import { schedule as cronSchedule } from 'node-cron';

// Load environment variables
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:4201', 'http://localhost:4300'];


// CORS middleware (must be first)
const allowedOrigins = CORS_ORIGIN.map(origin => origin.trim().replace(/\/$/, ''));
console.log('[CORS] Allowed origins:', allowedOrigins);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Create HTTP server and Socket.IO instance
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST']
  }
});

// Other middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Digital Paladin Backend'
  });
});

// Auth routes (no auth required for login)
app.use('/api/auth', authRouter);

// Fitbit routes — registered BEFORE global authMiddleware so /auth and /callback are reachable
// without a token. /sleep/today and /status apply authMiddleware internally.
app.use('/api/fitbit', fitbitRouter);

// Apply authentication middleware to all other API routes
app.use('/api', authMiddleware);

// Protected API Routes
app.use('/api/character', characterRouter);
app.use('/api', characterProjectionRouter);
app.use('/api/activities', activityRouter);
app.use('/api/action-log', actionLogRouter);
app.use('/api/daily-metrics', dailyMetricsRouter);
app.use('/api/consume', consumeRouter);
app.use('/api/food-estimate', foodEstimateRouter);
app.use('/api/acm', acmRouter);
app.use('/api/quests', questsRouter);
app.use('/api/fasting', fastingRouter);
app.use('/api/status-effects', statusEffectsRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/courage', courageRouter);
app.use('/api/consolidation', consolidationRouter);
app.use('/api/rewards-catalog', rewardsCatalogRouter);
app.use('/api/treasury', treasuryRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/todoist', todoistRouter);

// GET /api/journal/today — ensure today's entry exists in Supabase, return status
app.get('/api/journal/today', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const dateStr = `${today} (${days[now.getDay()]})`;

    if (userId) {
      const db = getDataService();
      const existing = await db.getJournalEntry(userId, today);
      if (!existing) {
        await db.upsertJournalEntry(userId, { user_id: userId, entry_date: today });
        console.log(`[JOURNAL] Created new entry for ${today} (user ${userId})`);
      }
    }

    res.json({ success: true, date: dateStr });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Configure Socket.IO for activity routes
setSocketIO(io);
setConsumeSocketIO(io);

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// Initialize file watcher

// Use environment variable for file paths
const CHARACTER_FILE_PATH = process.env.CHARACTER_FILE_PATH || path.join(__dirname, '../../character-progression/character-sheet.md');
console.log(`[WATCHER DEBUG] Character sheet path: ${CHARACTER_FILE_PATH}`);

const fileWatcher = new FileWatcherService(CHARACTER_FILE_PATH, io);
fileWatcher.start();

// Journal file watcher (local dev only) — emits 'journal:updated' to clients when journal changes on disk
const JOURNAL_WATCH_PATH = process.env.JOURNAL_PATH || path.join(__dirname, '../character-progression/progression-report/daily manual journal compendium(final version).md');
if (process.env.NODE_ENV !== 'production' && require('fs').existsSync(JOURNAL_WATCH_PATH)) {
  console.log('[JOURNAL WATCHER] 👁️  Watching journal at:', JOURNAL_WATCH_PATH);
  const emitJournalUpdate = () => io.emit('journal:updated', { timestamp: new Date().toISOString() });
  chokidar.watch(JOURNAL_WATCH_PATH, {
    persistent: true, ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 100 },
  }).on('change', () => {
    console.log('[JOURNAL WATCHER] 📝 Journal changed — broadcasting journal:updated');
    emitJournalUpdate();
  }).on('add', emitJournalUpdate)
    .on('error', (err) => console.error('[JOURNAL WATCHER] ❌ Watcher error:', err));
} else {
  console.log('[JOURNAL WATCHER] Skipping disk watcher — journal persisted in Supabase');
}

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const PORT_NUMBER = Number(PORT);
httpServer.listen(PORT_NUMBER, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT_NUMBER}`);
  console.log(`📡 WebSocket ready for real-time updates`);
  console.log(`📡 Supabase Realtime: active`);
  console.log(`📓 Journal: ${process.env.JOURNAL_PATH || 'local path'}`);
});

{
  // Daily Fitbit sleep sync — 11:50pm CST every night
  const fitbitCronService = new FitbitService();

  cronSchedule('50 23 * * *', async () => {
    console.log('\n[CRON] ═══ Daily Fitbit sleep sync triggered ═══');
    console.log(`[CRON] Time: ${new Date().toISOString()}`);

    if (!fitbitCronService.isConfigured()) {
      console.warn('[CRON] ⚠ Fitbit not configured — skipping');
      return;
    }

    const ownerUserId = process.env.OWNER_USER_ID;
    if (!ownerUserId) {
      console.warn('[CRON] ⚠ OWNER_USER_ID not set — skipping journal update');
      return;
    }

    try {
      const db = getDataService();
      const today = new Date().toLocaleDateString('en-CA');
      const cached = await db.getJournalEntry(ownerUserId, today);
      if (cached && cached.fitbit_score && cached.fitbit_score > 0) {
        console.log(`[CRON] ✓ Sleep already synced today (score=${cached.fitbit_score}) — skipping`);
        return;
      }

      const sleep = await fitbitCronService.getSleepData('today', ownerUserId);
      console.log(`[CRON] ✅ Fetched sleep: score=${sleep.score} hrs=${sleep.hours}`);

      await db.upsertJournalEntry(ownerUserId, {
        user_id: ownerUserId,
        entry_date: today,
        fitbit_score: sleep.score,
        sleep_hours: sleep.hours,
      });
      console.log('[CRON] ✅ Supabase journal_entries updated with sleep data');
    } catch (err) {
      console.error(`[CRON] ❌ Daily sync failed: ${err instanceof Error ? err.message : err}`);
    }
    console.log('[CRON] ═══════════════════════════════════════════\n');
  }, { timezone: 'America/Chicago' });

  console.log('[CRON] 📅 Daily Fitbit sleep sync scheduled at 11:50pm CST');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, shutting down gracefully...');
  fileWatcher.stop();
  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
