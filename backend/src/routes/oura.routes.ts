import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';
import { OuraService } from '../services/oura.service';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
const ouraService = new OuraService();

/**
 * GET /api/oura/connect-url — PROTECTED
 * Returns OAuth authorize URL with state=userId for SPA redirect.
 */
router.get('/connect-url', authMiddleware, (req: Request, res: Response) => {
  try {
    if (!ouraService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Oura not configured. Set OURA_CLIENT_ID and OURA_CLIENT_SECRET.',
      });
    }
    const userId = (req as any).userId as string;
    const url = ouraService.getAuthUrl(userId);
    return res.json({ success: true, url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Auth setup failed';
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/oura/callback — UNPROTECTED OAuth redirect from Oura.
 * state must be the connecting user's UUID (from connect-url).
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.status(400).send(`<h1>❌ Oura Auth Denied</h1><p>${error}</p>`);
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).send('<h1>❌ No authorization code received</h1>');
  }
  const userId = typeof state === 'string' && state.length > 0
    ? state
    : (process.env.OWNER_USER_ID || '');
  if (!userId) {
    return res.status(400).send('<h1>❌ Missing OAuth state (user id)</h1>');
  }

  try {
    await ouraService.exchangeCode(code, userId);
    const frontend = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || '/')
      .replace(/\/$/, '');
    res.send(`
      <h1>✅ Oura Connected!</h1>
      <p>Sleep and readiness will sync to your journal.</p>
      <p><a href="${frontend}">Return to dashboard</a></p>
      <style>body { font-family: sans-serif; padding: 2rem; background: #1a1a2e; color: #e0d5f5; }
      a { color: #c9a84c; }</style>
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[OURA] Code exchange failed: ${msg}`);
    res.status(500).send(`<h1>❌ Auth Failed</h1><p>${msg}</p>`);
  }
});

router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const connected = await ouraService.hasTokens(userId);
  res.json({
    success: true,
    provider: 'oura',
    configured: ouraService.isConfigured(),
    connected,
  });
});

router.get('/sleep/today', authMiddleware, async (req: Request, res: Response) => {
  if (!ouraService.isConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'Oura not configured. Set OURA_CLIENT_ID and OURA_CLIENT_SECRET.',
    });
  }

  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  const userId = (req as any).userId as string;
  const dateStr = clientDate ?? new Date().toLocaleDateString('en-CA');

  try {
    const db = getDataService();
    const entry = await db.getJournalEntry(userId, dateStr);
    if (entry?.fitbit_score && entry.fitbit_score > 0) {
      return res.json({
        success: true,
        source: 'cache',
        provider: 'oura',
        sleep: {
          score: entry.fitbit_score,
          hours: entry.sleep_hours ?? 0,
          vitality: entry.fitbit_score / 10,
          startTime: entry.sleep_start ?? undefined,
          endTime: entry.sleep_end ?? undefined,
          deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0, efficiency: 0,
        },
      });
    }

    const sleep = await ouraService.getSleepData(dateStr, userId);
    if (sleep.score > 0) {
      await db.upsertJournalEntry(userId, {
        user_id: userId,
        entry_date: dateStr,
        fitbit_score: sleep.score,
        sleep_hours: sleep.hours,
        sleep_start: sleep.startTime,
        sleep_end: sleep.endTime,
      });
    }
    return res.json({ success: true, source: 'oura', provider: 'oura', sleep });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[OURA] sleep/today failed: ${msg}`);
    const needsAuth = /not connected|refresh failed|401/i.test(msg);
    return res.status(needsAuth ? 401 : 500).json({
      success: false,
      error: msg,
      requiresAuth: needsAuth,
    });
  }
});

router.get('/readiness/today', authMiddleware, async (req: Request, res: Response) => {
  if (!ouraService.isConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'Oura not configured. Set OURA_CLIENT_ID and OURA_CLIENT_SECRET.',
    });
  }

  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  const userId = (req as any).userId as string;
  const dateStr = clientDate ?? new Date().toLocaleDateString('en-CA');

  try {
    const readiness = await ouraService.getReadiness(dateStr, userId);
    return res.json({ success: true, provider: 'oura', readiness });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[OURA] readiness/today failed: ${msg}`);
    return res.status(500).json({ success: false, error: msg });
  }
});

export default router;
