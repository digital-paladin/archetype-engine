import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';
import { FitbitService } from '../services/fitbit.service';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
const fitbitService = new FitbitService();

// GET /api/fitbit/auth — UNPROTECTED: initiate OAuth flow (user visits in browser)
router.get('/auth', (req: Request, res: Response) => {
  try {
    const url = fitbitService.getAuthUrl();
    console.log('[FITBIT] Redirecting to Fitbit authorization...');
    res.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Auth setup failed';
    console.error(`[FITBIT] Auth URL error: ${msg}`);
    res.status(500).send(`<h1>❌ Fitbit Not Configured</h1><p>${msg}</p>`);
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

  try {
    await fitbitService.exchangeCode(code, process.env.OWNER_USER_ID || '');
    res.send(`
      <h1>✅ Fitbit Connected!</h1>
      <p>Sleep data will now sync automatically with your journal.</p>
      <p>You can close this tab.</p>
      <style>body { font-family: sans-serif; padding: 2rem; background: #1a1a2e; color: #e0d5f5; }</style>
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[FITBIT] Code exchange failed: ${msg}`);
    res.status(500).send(`<h1>❌ Auth Failed</h1><p>${msg}</p>`);
  }
});

// GET /api/fitbit/status — check if Fitbit is configured + authorized (PROTECTED)
router.get('/status', authMiddleware, (req: Request, res: Response) => {
  res.json({
    configured: fitbitService.isConfigured(),
    authUrl:    fitbitService.isConfigured() ? '/api/fitbit/auth' : null,
  });
});

// GET /api/fitbit/sleep/today — fetch sleep from Fitbit, cache in journal (PROTECTED)
router.get('/sleep/today', authMiddleware, async (req: Request, res: Response) => {
  console.log('\n[FITBIT] ═════════════════════════════════════════');
  console.log(`[FITBIT] /sleep/today called at ${new Date().toISOString()}`);
  console.log(`[FITBIT] Configured: ${fitbitService.isConfigured()}`);
  console.log('[FITBIT] ─────────────────────────────────────────');

  if (!fitbitService.isConfigured()) {
    console.warn('[FITBIT] ⚠ FITBIT_CLIENT_ID or FITBIT_CLIENT_SECRET not set in environment');
    console.log('[FITBIT] ═════════════════════════════════════════\n');
    return res.status(503).json({ success: false, error: 'Fitbit not configured. Set FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET.' });
  }

  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  const userId = (req as any).userId as string;

  // Check DB cache first — only hit Fitbit API if fitbit_score is still 0
  try {
    console.log('[FITBIT] Checking DB cache for today\'s sleep data...');
    const db         = getDataService();
    const dateStr    = clientDate ?? new Date().toLocaleDateString('en-CA');
    const entry      = await db.getJournalEntry(userId, dateStr);
    if (entry?.fitbit_score && entry.fitbit_score > 0) {
      const cached = {
        score:       entry.fitbit_score,
        hours:       entry.sleep_hours ?? 0,
        vitality:    entry.fitbit_score / 10,
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
    console.log('[FITBIT] Cache MISS (score=0 or not found) — will fetch from Fitbit API');
  } catch (err) {
    console.warn(`[FITBIT] DB cache read failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  // Fetch from Fitbit
  try {
    console.log('[FITBIT] Calling Fitbit API...');
    const sleep = await fitbitService.getSleepData(clientDate ?? 'today', userId);
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
    } catch (dbErr) {
      console.error(`[FITBIT] \u274c DB sleep write failed (non-fatal): ${dbErr instanceof Error ? dbErr.message : dbErr}`);
    }

    console.log('[FITBIT] ═════════════════════════════════════════\n');
    res.json({ success: true, sleep, source: 'fitbit' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[FITBIT] ❌ Sleep fetch failed: ${msg}`);
    if (err instanceof Error && err.stack) console.error(`[FITBIT] Stack: ${err.stack}`);
    console.log('[FITBIT] ═════════════════════════════════════════\n');
    if (msg.includes('403')) {
      return res.json({ success: false, error: 'Fitbit sleep scope not authorized. Re-authorize at /api/fitbit/auth to grant sleep permissions.', requiresAuth: true });
    }
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/fitbit/sleep/week — last 7 nights of sleep data (PROTECTED)
router.get('/sleep/week', authMiddleware, async (req: Request, res: Response) => {
  console.log('\n[FITBIT] ═══ /sleep/week ════════════════════════');
  if (!fitbitService.isConfigured()) {
    console.warn('[FITBIT] ⚠ Fitbit not configured');
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    return res.status(503).json({ success: false, error: 'Fitbit not configured' });
  }

  const userId = (req as any).userId as string;
  const days: Array<{ date: string; score: number; hours: number; vitality: number; efficiency: number; deep_min: number; rem_min: number; light_min: number; awake_min: number }> = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    try {
      const sleep = await fitbitService.getSleepData(dateStr, userId);
      days.push({ date: dateStr, ...sleep });
      console.log(`[FITBIT]   ${dateStr}: ${sleep.hours}hrs score=${sleep.score} vitality=${sleep.vitality}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[FITBIT]   ${dateStr}: no data (${msg})`);
      days.push({ date: dateStr, score: 0, hours: 0, vitality: 0, efficiency: 0, deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0 });
    }
  }

  console.log(`[FITBIT] Returning ${days.length} days (most recent first)`);
  console.log('[FITBIT] ═══════════════════════════════════════\n');
  res.json({ success: true, days });
});

// GET /api/fitbit/activities/today — auto-detected physical activities + step summary (PROTECTED)
router.get('/activities/today', authMiddleware, async (req: Request, res: Response) => {
  console.log('\n[FITBIT] ═══ /activities/today ══════════════════');
  if (!fitbitService.isConfigured()) {
    console.warn('[FITBIT] ⚠ Fitbit not configured');
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    return res.status(503).json({ success: false, error: 'Fitbit not configured' });
  }
  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  try {
    const userId = (req as any).userId as string;
    const data = await fitbitService.getActivities(clientDate ?? 'today', userId);
    console.log(`[FITBIT] ✅ Activities fetched: ${data.activities.length} logged, ${data.steps} steps`);

    // Write logged workouts to Warrior quest entries (non-fatal, only if field is empty)
    if (data.activities.length > 0) {
      try {
        const userId   = (req as any).userId as string;
        const dateStr  = clientDate ?? new Date().toLocaleDateString('en-CA');
        const db       = getDataService();
        const rows     = await db.getQuestEntries(userId, dateStr);
        const existing = rows.find(r => r.class_name === 'Paladin of God' && r.quest_label === 'Warrior Skills');
        const hasContent = existing?.content && existing.content.trim() !== '[To be logged]';
        if (!hasContent) {
          const workoutLines = data.activities
            .map(a => `${a.name} ${a.durationMin}min (${a.calories} cal${a.startTime ? ` @ ${a.startTime}` : ''})`)
            .join('\n');
          await db.upsertQuestEntry(userId, dateStr, 'Paladin of God', 'Warrior Skills', workoutLines);
          console.log(`[FITBIT] ✅ Wrote ${data.activities.length} workout(s) to Warrior Skills quest for ${dateStr}`);
        }
      } catch (questErr) {
        console.warn(`[FITBIT] Warrior quest write failed (non-fatal): ${questErr instanceof Error ? questErr.message : questErr}`);
      }
    }

    console.log('[FITBIT] ═══════════════════════════════════════\n');
    res.json({ success: true, ...data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[FITBIT] ❌ Activities fetch failed: ${msg}`);
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    if (msg.includes('403')) {
      return res.json({ success: false, error: 'Fitbit activity scope not authorized. Re-authorize at /api/fitbit/auth.', requiresAuth: true });
    }
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/fitbit/nutrition/today — food log entries + daily macro totals (PROTECTED)
router.get('/nutrition/today', authMiddleware, async (req: Request, res: Response) => {
  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  console.log(`\n[FITBIT] ═══ /nutrition/today ═══════════════════ (date=${clientDate ?? 'server-UTC'})`);
  if (!fitbitService.isConfigured()) {
    console.warn('[FITBIT] ⚠ Fitbit not configured');
    return res.status(503).json({ success: false, error: 'Fitbit not configured' });
  }
  try {
    const userId  = (req as any).userId as string;
    const data = await fitbitService.getFoodLog(clientDate ?? 'today', userId);
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
    res.json({ success: true, ...data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[FITBIT] ❌ Food log fetch failed: ${msg}`);
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    if (msg.includes('403')) {
      return res.json({ success: false, error: 'Fitbit nutrition scope not authorized. Re-authorize at /api/fitbit/auth.', requiresAuth: true });
    }
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/vitals/today', authMiddleware, async (req, res) => {
  console.log('[FITBIT] ═══════════════════════════════════════');
  console.log('[FITBIT] GET /api/fitbit/vitals/today');
  if (!fitbitService.isConfigured()) {
    console.warn('[FITBIT] ⚠ Fitbit not configured');
    return res.status(503).json({ success: false, error: 'Fitbit not configured' });
  }
  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  try {
    const userId  = (req as any).userId as string;
    const vitals = await fitbitService.getVitals(userId, clientDate);
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
    res.json({ success: true, ...vitals });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[FITBIT] ❌ Vitals fetch failed: ${msg}`);
    console.log('[FITBIT] ═══════════════════════════════════════\n');
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
