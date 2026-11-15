import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';
import { OuraError } from '../services/ouraErrors';
import { escapeHtml, safeFrontendUrl, signOuraState, verifyOuraState } from '../services/ouraOAuthState';
import { ouraTokenKeyConfigured } from '../services/ouraTokenCrypto';
import { OuraService } from '../services/oura.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireTier } from '../middleware/requireTier.middleware';
import { chicagoDay } from '../services/activityOccurredAt';
import { isRealIsoDate } from '../services/recoveryQuests.service';

const router = Router();
const ouraService = new OuraService();

function userIdOf(req: Request): string {
  return (req as Request & { userId: string }).userId;
}

function requestedDate(value: unknown): string | null {
  if (value === undefined) return chicagoDay(new Date());
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return chicagoDay(new Date());
  return isRealIsoDate(trimmed) ? trimmed : null;
}

function sendOuraError(res: Response, err: unknown) {
  if (err instanceof OuraError) {
    console.error(`[OURA] ${err.code}`);
    return res.status(err.httpStatus).json({
      success: false,
      error: err.safeMessage,
      code: err.code,
      requiresAuth: err.code === 'revoked' || err.code === 'not_connected',
    });
  }
  console.error(`[OURA] failed: ${err instanceof Error ? err.name : 'error'}`);
  return res.status(500).json({ success: false, error: 'Oura request failed.' });
}

function page(title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:sans-serif;padding:2rem;background:#1a1a2e;color:#e0d5f5">
<h1>${escapeHtml(title)}</h1>${bodyHtml}</body></html>`;
}

/**
 * GET /api/oura/connect-url — signed OAuth state for the signed-in user.
 * The state is not the user id, and it is not accepted from the browser.
 */
router.get('/connect-url', authMiddleware, requireTier('paladin'), (req: Request, res: Response) => {
  try {
    if (!ouraService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Oura is not configured. Set OURA_CLIENT_ID, OURA_CLIENT_SECRET, and OURA_REDIRECT_URI.',
      });
    }
    if (!ouraTokenKeyConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Set INTEGRATIONS_ENCRYPTION_KEY before connecting Oura.',
      });
    }
    const state = signOuraState(userIdOf(req));
    return res.json({ success: true, url: ouraService.getAuthUrl(state) });
  } catch (err) {
    return sendOuraError(res, err);
  }
});

/**
 * GET /api/oura/callback — Oura redirects here. State must be a signed, unspent value
 * from connect-url. A missing or raw user id is rejected, including OWNER_USER_ID.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const error = typeof req.query.error === 'string' ? req.query.error.slice(0, 120) : '';
  if (error) {
    return res.status(400).type('html').send(page(
      'Oura authorization was denied',
      `<p>${escapeHtml(error)}</p>`,
    ));
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || !state) {
    return res.status(400).type('html').send(page(
      'Oura authorization did not include a code and state',
      '<p>Start the connection again from the app.</p>',
    ));
  }
  let userId: string;
  try {
    userId = verifyOuraState(state).userId;
  } catch {
    return res.status(400).type('html').send(page(
      'Oura authorization state was invalid or expired',
      '<p>Start the connection again from the app.</p>',
    ));
  }
  try {
    await ouraService.exchangeCode(code, userId);
  } catch (err) {
    const msg = err instanceof OuraError ? err.safeMessage : 'Oura authorization failed.';
    console.error(`[OURA] code exchange failed: ${err instanceof OuraError ? err.code : 'error'}`);
    return res.status(400).type('html').send(page(
      'Oura authorization failed',
      `<p>${escapeHtml(msg)}</p>`,
    ));
  }
  const frontend = safeFrontendUrl();
  return res.type('html').send(page(
    'Oura connected',
    `<p>Sleep, readiness, and activity summaries can sync when Oura has them. A ring that is not paired yet stays empty.</p>
     <p><a href="${escapeHtml(frontend)}" style="color:#c9a84c">Return to the app</a></p>`,
  ));
});

router.get('/status', authMiddleware, requireTier('paladin'), async (req: Request, res: Response) => {
  try {
    const status = await ouraService.connectionStatus(userIdOf(req));
    return res.json({ success: true, provider: 'oura', ...status });
  } catch (err) {
    return sendOuraError(res, err);
  }
});

router.post('/sync', authMiddleware, requireTier('paladin'), async (req: Request, res: Response) => {
  const raw = typeof req.body?.date === 'string' ? req.body.date : undefined;
  const dateStr = requestedDate(raw);
  if (!dateStr) {
    return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  }
  try {
    const result = await ouraService.syncDay(userIdOf(req), dateStr);
    return res.json({ success: true, provider: 'oura', ...result });
  } catch (err) {
    return sendOuraError(res, err);
  }
});

router.delete('/connection', authMiddleware, requireTier('paladin'), async (req: Request, res: Response) => {
  try {
    await ouraService.disconnect(userIdOf(req));
    return res.json({ success: true, provider: 'oura', connected: false });
  } catch (err) {
    return sendOuraError(res, err);
  }
});

router.get('/sleep/today', authMiddleware, requireTier('paladin'), async (req: Request, res: Response) => {
  if (!ouraService.isConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'Oura is not configured. Set OURA_CLIENT_ID, OURA_CLIENT_SECRET, and OURA_REDIRECT_URI.',
    });
  }
  const dateStr = requestedDate(typeof req.query.date === 'string' ? req.query.date : undefined);
  if (!dateStr) return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  const userId = userIdOf(req);
  try {
    const entry = await getDataService().getJournalEntry(userId, dateStr);
    if (entry?.sleep_hours && entry.sleep_hours > 0) {
      return res.json({
        success: true,
        source: 'cache',
        provider: 'oura',
        xpAwarded: 0,
        sleep: {
          score: entry.fitbit_score ?? 0,
          hours: entry.sleep_hours ?? 0,
          vitality: (entry.fitbit_score ?? 0) / 10,
          startTime: entry.sleep_start ?? undefined,
          endTime: entry.sleep_end ?? undefined,
          deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0, efficiency: 0,
        },
      });
    }
    const sleep = await ouraService.getSleepData(dateStr, userId);
    const journalUpdated = await ouraService.writeJournalSleepIfEmpty(userId, dateStr, sleep);
    return res.json({
      success: true,
      source: 'oura',
      provider: 'oura',
      journalUpdated,
      xpAwarded: 0,
      sleep,
    });
  } catch (err) {
    return sendOuraError(res, err);
  }
});

router.get('/readiness/today', authMiddleware, requireTier('paladin'), async (req: Request, res: Response) => {
  if (!ouraService.isConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'Oura is not configured. Set OURA_CLIENT_ID, OURA_CLIENT_SECRET, and OURA_REDIRECT_URI.',
    });
  }
  const dateStr = requestedDate(typeof req.query.date === 'string' ? req.query.date : undefined);
  if (!dateStr) return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  try {
    const readiness = await ouraService.getReadiness(dateStr, userIdOf(req));
    return res.json({
      success: true,
      provider: 'oura',
      xpAwarded: 0,
      note: 'Oura readiness is informational. It does not award XP, create a workout, or give medical advice.',
      readiness,
    });
  } catch (err) {
    return sendOuraError(res, err);
  }
});

export default router;
