import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';
import { FitbitService } from '../services/fitbit.service';
import { GoogleHealthService } from '../services/googleHealth.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { caughtErrorMessage } from '../utils/caughtError';
import { syncSleepDebtFromJournalSafe } from '../services/sleepDebt.service';
import {
  awardWearableActivities,
  parseWearableOverrides,
  wearableQuestLine,
  WearableOverrideError,
  WearableTypeOverride,
  WearableXpResult,
} from '../services/wearableActivityXp.service';
import { loadTogglSportOverrides } from '../services/togglWearableTyping.service';
import { redactTogglSecret } from '../services/togglTrack.service';
import type { ActivitySummary } from '../services/fitbit.service';
import { chicagoDay } from '../services/activityOccurredAt';
import { isRealIsoDate } from '../services/recoveryQuests.service';
import {
  fitbitDataSourceMode,
  legacyFitbitRetired,
  resolveDailyProvider,
  WearableSourceError,
} from '../services/fitbitDataSource';

const router = Router();
const fitbitService = new FitbitService();
const googleHealth = new GoogleHealthService();

function sendSourceError(res: Response, err: WearableSourceError) {
  const body: { success: false; error: string; requiresAuth?: boolean } = {
    success: false,
    error: err.message,
  };
  if (err.requiresAuth) {
    body.requiresAuth = true;
    return res.json(body);
  }
  return res.status(err.httpStatus).json(body);
}

function sendFetchError(res: Response, err: unknown) {
  const msg = caughtErrorMessage(err);
  if (msg.includes('403')) {
    const authPath = msg.toLowerCase().includes('google')
      ? '/api/google-health/connect-url'
      : '/api/fitbit/auth';
    return res.json({
      success: false,
      error: `Wearable scope not authorized. Re-authorize at ${authPath}.`,
      requiresAuth: true,
    });
  }
  return res.status(500).json({ success: false, error: msg });
}

async function dailyProvider(userId: string): Promise<'google' | 'fitbit'> {
  return resolveDailyProvider(userId, googleHealth, fitbitService);
}

// GET /api/fitbit/auth — UNPROTECTED: initiate OAuth flow (user visits in browser)
router.get('/auth', (req: Request, res: Response) => {
  try {
    const url = fitbitService.getAuthUrl();
    console.log('[FITBIT] Redirecting to Fitbit authorization...');
    res.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Auth setup failed';
    console.error(`[FITBIT] Auth URL error: ${msg}`);
    const shutDown = msg.includes('shut down');
    const status = shutDown ? 503 : 500;
    const title = shutDown ? 'Fitbit Web API shut down' : 'Fitbit Not Configured';
    res.status(status).send(`<h1>❌ ${title}</h1><p>${msg}</p>`);
  }
});

// GET /api/fitbit/callback — UNPROTECTED: OAuth callback from Fitbit
router.get('/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    console.error(`[FITBIT] OAuth denied: ${error}`);
    return res.status(400).send(`<h1>❌ Fitbit Auth Denied</h1><p>${error}</p>`);
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).send('<h1>❌ No authorization code received</h1>');
  }

  const ownerUserId = process.env.OWNER_USER_ID || '';
  if (!ownerUserId) {
    return res.status(500).send(
      '<h1>❌ Auth Failed</h1><p>OWNER_USER_ID is not set on this server — cannot save Fitbit tokens.</p>',
    );
  }

  try {
    await fitbitService.exchangeCode(code, ownerUserId);
    res.send(`
      <h1>✅ Fitbit Connected!</h1>
      <p>Sleep data will now sync automatically with your journal.</p>
      <p>You can close this tab.</p>
      <style>body { font-family: sans-serif; padding: 2rem; background: #1a1a2e; color: #e0d5f5; }</style>
    `);
  } catch (err) {
    const msg = caughtErrorMessage(err);
    console.error(`[FITBIT] Code exchange failed: ${msg}`);
    const shutDown = msg.includes('shut down');
    res.status(shutDown ? 503 : 500).send(`<h1>❌ Auth Failed</h1><p>${msg}</p>`);
  }
});

// GET /api/fitbit/status — check if Fitbit is configured + authorized (PROTECTED)
router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const mode = fitbitDataSourceMode();
  let provider: 'google' | 'fitbit' | null = null;
  try {
    provider = await dailyProvider(userId);
  } catch {
    provider = null;
  }
  res.json({
    configured: fitbitService.isConfigured() || googleHealth.isConfigured(),
    dataSource: mode,
    provider,
    authUrl: !legacyFitbitRetired() && fitbitService.isConfigured() ? '/api/fitbit/auth' : null,
    googleAuthUrl: googleHealth.isConfigured() ? '/api/google-health/connect-url' : null,
  });
});

// GET /api/fitbit/sleep/today — fetch sleep from Fitbit, cache in journal (PROTECTED)
router.get('/sleep/today', authMiddleware, async (req: Request, res: Response) => {
  console.log('\n[FITBIT] ═════════════════════════════════════════');
  console.log(`[FITBIT] /sleep/today called at ${new Date().toISOString()}`);
  console.log(`[FITBIT] Data source: ${fitbitDataSourceMode()} (legacy configured=${fitbitService.isConfigured()} google configured=${googleHealth.isConfigured()})`);
  console.log('[FITBIT] ─────────────────────────────────────────');

  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  const userId = (req as any).userId as string;

  // Check DB cache first — only hit Fitbit API if sleep_hours isn't logged yet.
  // Gate on sleep_hours (not fitbit_score): a manual edit that adds nap time
  // the wearable didn't capture only sets sleep_hours, and must survive a
  // later same-day auto-sync call rather than being silently overwritten.
  try {
    console.log('[FITBIT] Checking DB cache for today\'s sleep data...');
    const db         = getDataService();
    const dateStr    = clientDate ?? new Date().toLocaleDateString('en-CA');
    const entry      = await db.getJournalEntry(userId, dateStr);
    if (entry?.sleep_hours && entry.sleep_hours > 0) {
      const cached = {
        score:       entry.fitbit_score ?? 0,
        hours:       entry.sleep_hours ?? 0,
        vitality:    (entry.fitbit_score ?? 0) / 10,
        startTime:   entry.sleep_start ?? undefined,
        endTime:     entry.sleep_end   ?? undefined,
        deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0, efficiency: 0,
      };
      console.log(`[FITBIT] ✓ Cache HIT — returning DB data`);
      console.log(`[FITBIT]   score    : ${cached.score} / 100`);
      console.log(`[FITBIT]   hours    : ${cached.hours} hrs`);
      console.log(`[FITBIT]   vitality : ${cached.vitality} / 10`);
      console.log('[FITBIT] ═════════════════════════════════════════\n');
      return res.json({ success: true, sleep: cached, source: 'cache' });
    }
    console.log('[FITBIT] Cache MISS (no sleep_hours logged) — will fetch from Fitbit API');
  } catch (err) {
    console.warn(`[FITBIT] DB cache read failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  // Fetch from Google Health when that account is connected, else legacy Fitbit.
  let provider: 'google' | 'fitbit';
  try {
    provider = await dailyProvider(userId);
  } catch (err) {
    if (err instanceof WearableSourceError) return sendSourceError(res, err);
    throw err;
  }

  try {
    console.log(`[FITBIT] Calling ${provider} sleep API...`);
    const sleep = provider === 'google'
      ? await googleHealth.getSleepData(clientDate ?? 'today', userId)
      : await fitbitService.getSleepData(clientDate ?? 'today', userId);
    console.log('[FITBIT] ✅ Fitbit API call succeeded');
    console.log(`[FITBIT]   score    : ${sleep.score} / 100`);
    console.log(`[FITBIT]   hours    : ${sleep.hours} hrs`);
    console.log(`[FITBIT]   vitality : ${sleep.vitality} / 10`);
    console.log(`[FITBIT]   bedtime  : ${sleep.startTime ?? '(not returned by Fitbit)'}`);
    console.log(`[FITBIT]   wake     : ${sleep.endTime ?? '(not returned by Fitbit)'}`);
    console.log(`[FITBIT]   deep     : ${sleep.deep_min} min`);
    console.log(`[FITBIT]   REM      : ${sleep.rem_min} min`);
    console.log(`[FITBIT]   light    : ${sleep.light_min} min`);
    console.log(`[FITBIT]   awake    : ${sleep.awake_min} min`);

    // Persist sleep data to Supabase (non-fatal)
    console.log(`[FITBIT] Writing sleep data to DB...`);
    try {
      const db      = getDataService();
      const dateStr = clientDate ?? new Date().toLocaleDateString('en-CA');
      await db.upsertJournalEntry(userId, {
        entry_date:  dateStr,
        fitbit_score: sleep.score,
        sleep_hours:  sleep.hours,
        sleep_start:  sleep.startTime ?? undefined,
        sleep_end:    sleep.endTime   ?? undefined,
      });
      console.log(`[FITBIT] \u2705 Sleep data persisted to DB`);
      await syncSleepDebtFromJournalSafe(userId);
    } catch (dbErr) {
      console.error(`[FITBIT] \u274c DB sleep write failed (non-fatal): ${dbErr instanceof Error ? dbErr.message : dbErr}`);
    }

    console.log('[FITBIT] ═════════════════════════════════════════\n');
    res.json({ success: true, sleep, source: provider === 'google' ? 'google-health' : 'fitbit' });
  } catch (err) {
    const msg = caughtErrorMessage(err);
    console.error(`[FITBIT] ❌ Sleep fetch failed: ${msg}`);
    if (err instanceof Error && err.stack) console.error(`[FITBIT] Stack: ${err.stack}`);
    console.log('[FITBIT] ═════════════════════════════════════════\n');
    return sendFetchError(res, err);
  }
});

// GET /api/fitbit/sleep/week — last 7 nights of sleep data (PROTECTED)
router.get('/sleep/week', authMiddleware, async (req: Request, res: Response) => {
  console.log('\n[FITBIT] ═══ /sleep/week ════════════════════════');
  const userId = (req as any).userId as string;
  let provider: 'google' | 'fitbit';
  try {
    provider = await dailyProvider(userId);
  } catch (err) {
    if (err instanceof WearableSourceError) return sendSourceError(res, err);
    throw err;
  }
  const days: Array<{ date: string; score: number; hours: number; vitality: number; efficiency: number; deep_min: number; rem_min: number; light_min: number; awake_min: number }> = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    try {
      const sleep = provider === 'google'
        ? await googleHealth.getSleepData(dateStr, userId)
        : await fitbitService.getSleepData(dateStr, userId);
      days.push({ date: dateStr, ...sleep });
      console.log(`[FITBIT]   ${dateStr}: ${sleep.hours}hrs score=${sleep.score} vitality=${sleep.vitality}`);
      if (sleep.hours > 0) {
        try {
          await getDataService().upsertJournalEntry(userId, {
            entry_date: dateStr,
            sleep_hours: sleep.hours,
            fitbit_score: sleep.score,
            sleep_start: sleep.startTime,
            sleep_end: sleep.endTime,
          });
        } catch (persistErr) {
          console.warn(`[FITBIT] journal persist ${dateStr} failed: ${persistErr instanceof Error ? persistErr.message : persistErr}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[FITBIT]   ${dateStr}: no data (${msg})`);
      days.push({ date: dateStr, score: 0, hours: 0, vitality: 0, efficiency: 0, deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0 });
    }
  }

  console.log(`[FITBIT] Returning ${days.length} days (most recent first)`);
  console.log('[FITBIT] ═══════════════════════════════════════\n');
  await syncSleepDebtFromJournalSafe(userId);
  res.json({ success: true, days, source: provider === 'google' ? 'google-health' : 'fitbit' });
});

async function fetchActivities(provider: 'google' | 'fitbit', date: string | undefined, userId: string): Promise<ActivitySummary> {
  return provider === 'google'
    ? googleHealth.getActivities(date ?? 'today', userId)
    : fitbitService.getActivities(date ?? 'today', userId);
}

// GET /api/fitbit/activities/today — auto-detected physical activities + step summary (PROTECTED)
// Read-only: no quest or XP writes. Use POST /activities/sync to record them.
router.get('/activities/today', authMiddleware, async (req: Request, res: Response) => {
  console.log('\n[FITBIT] ═══ /activities/today ══════════════════');
  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  const userId = (req as any).userId as string;
  let provider: 'google' | 'fitbit';
  try {
    provider = await dailyProvider(userId);
  } catch (err) {
    if (err instanceof WearableSourceError) return sendSourceError(res, err);
    throw err;
  }
  try {
    const data = await fetchActivities(provider, clientDate, userId);
    console.log(`[FITBIT] ✅ Activities fetched: ${data.activities.length} logged, ${data.steps} steps`);
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    res.json({ success: true, source: provider === 'google' ? 'google-health' : 'fitbit', ...data });
  } catch (err) {
    const msg = caughtErrorMessage(err);
    console.error(`[FITBIT] ❌ Activities fetch failed: ${msg}`);
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    return sendFetchError(res, err);
  }
});

function syncDate(req: Request): string | null {
  const raw = typeof req.body?.date === 'string' ? req.body.date
    : typeof req.query.date === 'string' ? req.query.date : undefined;
  if (raw === undefined) return chicagoDay(new Date());
  const trimmed = raw.trim();
  if (trimmed === '') return chicagoDay(new Date());
  return isRealIsoDate(trimmed) ? trimmed : null;
}

// POST /api/fitbit/activities/sync — fetch the day's wearable workouts, fill an empty
// Warrior Skills quest field, and award Warrior XP once per session (PROTECTED).
// Body: { date?: 'YYYY-MM-DD', overrides?: WearableTypeOverride[] }.
// `date` defaults to America/Chicago today (a past date is the back-pay path).
// The dashboard only calls this for today; older dates stay on the read-only GET
// until the owner asks. Explicit overrides type a session (Fitbit "Sport" → Sambo).
// When a Sport session has no explicit override, Toggl Track may supply one from
// the time entry with the greatest overlap. A missing token, an unreachable
// Toggl, or an unmapped entry leaves that session on workout-cardio. Neither
// path re-types a session that was already awarded.
router.post('/activities/sync', authMiddleware, async (req: Request, res: Response) => {
  console.log('\n[FITBIT] ═══ /activities/sync ═══════════════════');
  const dateStr = syncDate(req);
  if (dateStr === null) {
    return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  }
  let overrides: WearableTypeOverride[];
  try {
    overrides = parseWearableOverrides(req.body?.overrides);
  } catch (err) {
    if (err instanceof WearableOverrideError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    throw err;
  }
  const userId = (req as any).userId as string;
  let provider: 'google' | 'fitbit';
  try {
    provider = await dailyProvider(userId);
  } catch (err) {
    if (err instanceof WearableSourceError) return sendSourceError(res, err);
    throw err;
  }
  let data: ActivitySummary;
  try {
    data = await fetchActivities(provider, dateStr, userId);
  } catch (err) {
    const msg = caughtErrorMessage(err);
    console.error(`[FITBIT] ❌ Activities fetch failed: ${msg}`);
    return sendFetchError(res, err);
  }

  // Explicit request overrides stay first so they win over a Toggl suggestion.
  let effectiveOverrides = overrides;
  try {
    const fromToggl = await loadTogglSportOverrides(dateStr, data.activities, overrides);
    effectiveOverrides = [...overrides, ...fromToggl];
  } catch (err) {
    console.warn(`[TOGGL] Sport typing skipped; sessions stay workout-cardio: ${redactTogglSecret(caughtErrorMessage(err))}`);
  }

  let questWritten = false;
  if (data.activities.length > 0) {
    try {
      const db       = getDataService();
      const rows     = await db.getQuestEntries(userId, dateStr);
      const existing = rows.find(r => r.class_name === 'Paladin of God' && r.quest_label === 'Warrior Skills');
      const hasContent = existing?.content && existing.content.trim() !== '[To be logged]';
      if (!hasContent) {
        // Every fetched session, including auto-detected walks that earn no XP.
        // An override label is shown here ("Sport (Toggl: Sambo)") and in the log notes.
        const workoutLines = data.activities
          .map(a => wearableQuestLine(a, effectiveOverrides))
          .join('\n');
        await db.upsertQuestEntry(userId, dateStr, 'Paladin of God', 'Warrior Skills', workoutLines);
        questWritten = true;
        console.log(`[FITBIT] ✅ Wrote ${data.activities.length} workout(s) to Warrior Skills quest for ${dateStr}`);
      }
    } catch (questErr) {
      console.warn(`[FITBIT] Warrior quest write failed (non-fatal): ${questErr instanceof Error ? questErr.message : questErr}`);
    }
  }

  let xp: WearableXpResult;
  try {
    xp = await awardWearableActivities(userId, dateStr, provider, data.activities, { overrides: effectiveOverrides });
  } catch (xpErr) {
    const msg = caughtErrorMessage(xpErr);
    console.error(`[FITBIT] ❌ Wearable XP award failed: ${msg}`);
    return res.status(500).json({ success: false, error: `XP award failed: ${msg}`, questWritten });
  }

  console.log('[FITBIT] ═══════════════════════════════════════\n');
  res.json({
    success: true,
    source: provider === 'google' ? 'google-health' : 'fitbit',
    date: dateStr,
    ...data,
    questWritten,
    xp,
  });
});

// GET /api/fitbit/nutrition/today — food log entries + daily macro totals (PROTECTED)
router.get('/nutrition/today', authMiddleware, async (req: Request, res: Response) => {
  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  console.log(`\n[FITBIT] ═══ /nutrition/today ═══════════════════ (date=${clientDate ?? 'server-UTC'})`);
  const userId = (req as any).userId as string;
  let provider: 'google' | 'fitbit';
  try {
    provider = await dailyProvider(userId);
  } catch (err) {
    if (err instanceof WearableSourceError) return sendSourceError(res, err);
    throw err;
  }
  try {
    const data = provider === 'google'
      ? await googleHealth.getFoodLog(clientDate ?? 'today', userId)
      : await fitbitService.getFoodLog(clientDate ?? 'today', userId);
    console.log(`[FITBIT] \u2705 Food log fetched: ${data.entries.length} entries, ${data.totals.protein}g protein`);
    // Persist nutrition totals to Supabase (non-fatal)
    try {
      const db      = getDataService();
      const dateStr = clientDate ?? new Date().toLocaleDateString('en-CA');
      const proteinRaw = data.totals.protein;
      const proteinLevel: 'low' | 'medium' | 'high' =
        proteinRaw >= 130 ? 'high' : proteinRaw >= 80 ? 'medium' : 'low';
      await db.upsertJournalEntry(userId, { entry_date: dateStr, protein_level: proteinLevel });
      console.log(`[FITBIT] \u2705 Nutrition persisted to DB: ${proteinRaw}g protein \u2192 ${proteinLevel}`);
    } catch (dbErr) {
      console.warn(`[FITBIT] DB nutrition write failed (non-fatal): ${dbErr instanceof Error ? dbErr.message : dbErr}`);
    }
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    res.json({ success: true, source: provider === 'google' ? 'google-health' : 'fitbit', ...data });
  } catch (err) {
    const msg = caughtErrorMessage(err);
    console.error(`[FITBIT] ❌ Food log fetch failed: ${msg}`);
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    return sendFetchError(res, err);
  }
});

router.get('/vitals/today', authMiddleware, async (req, res) => {
  console.log('[FITBIT] ═══════════════════════════════════════');
  console.log('[FITBIT] GET /api/fitbit/vitals/today');
  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  const userId = (req as any).userId as string;
  let provider: 'google' | 'fitbit';
  try {
    provider = await dailyProvider(userId);
  } catch (err) {
    if (err instanceof WearableSourceError) return sendSourceError(res, err);
    throw err;
  }
  try {
    const vitals = provider === 'google'
      ? await googleHealth.getVitals(userId, clientDate)
      : await fitbitService.getVitals(userId, clientDate);
    console.log('[FITBIT] \u2705 Vitals fetched successfully');
    if (vitals.waterOz != null) {
      console.log(`[FITBIT] Hydration logged: ${vitals.waterOz} oz \u2014 persisting to DB...`);
      try {
        const db      = getDataService();
        const dateStr = clientDate ?? new Date().toLocaleDateString('en-CA');
        await db.upsertJournalEntry(userId, { entry_date: dateStr, hydration_oz: vitals.waterOz });
        console.log(`[FITBIT] \u2705 Hydration persisted to DB: ${vitals.waterOz} oz`);
      } catch (dbErr) {
        console.warn(`[FITBIT] DB hydration write failed (non-fatal): ${dbErr instanceof Error ? dbErr.message : dbErr}`);
      }
    } else {
      console.log('[FITBIT] No hydration data returned from Fitbit — skipping journal write');
    }
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    res.json({ success: true, source: provider === 'google' ? 'google-health' : 'fitbit', ...vitals });
  } catch (err) {
    const msg = caughtErrorMessage(err);
    console.error(`[FITBIT] ❌ Vitals fetch failed: ${msg}`);
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    return sendFetchError(res, err);
  }
});

export default router;
