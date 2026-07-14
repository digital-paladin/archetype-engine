import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';
import { OuraService } from '../services/oura.service';
import { GarminService } from '../services/garmin.service';
import { FitbitService } from '../services/fitbit.service';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
const oura = new OuraService();
const garmin = new GarminService();
const fitbit = new FitbitService();

/**
 * Aggregated wearable status + sleep cascade: Oura → Fitbit (Garmin stub skipped).
 * Mounted under /api/wearables AFTER global authMiddleware.
 */
router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const [ouraConnected, fitbitTokens] = await Promise.all([
    oura.hasTokens(userId),
    getDataService().getFitbitTokens(userId).catch(() => null),
  ]);

  res.json({
    success: true,
    providers: {
      oura: {
        configured: oura.isConfigured(),
        connected: ouraConnected,
        connectPath: '/api/oura/connect-url',
      },
      garmin: {
        configured: garmin.isConfigured(),
        connected: false,
        stub: true,
      },
      fitbit: {
        configured: fitbit.isConfigured(),
        connected: !!fitbitTokens?.access_token,
        connectPath: '/api/fitbit/auth',
        legacy: true,
      },
    },
  });
});

router.get('/sleep/today', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const dateStr = typeof req.query.date === 'string'
    ? req.query.date
    : new Date().toLocaleDateString('en-CA');

  // Prefer Oura when connected
  try {
    if (oura.isConfigured() && await oura.hasTokens(userId)) {
      const sleep = await oura.getSleepData(dateStr, userId);
      if (sleep.score > 0) {
        await getDataService().upsertJournalEntry(userId, {
          user_id: userId,
          entry_date: dateStr,
          fitbit_score: sleep.score,
          sleep_hours: sleep.hours,
          sleep_start: sleep.startTime,
          sleep_end: sleep.endTime,
        });
      }
      return res.json({ success: true, provider: 'oura', source: 'oura', sleep });
    }
  } catch (err) {
    console.warn(`[WEARABLES] Oura sleep failed, falling back: ${err instanceof Error ? err.message : err}`);
  }

  // Legacy Fitbit fallback
  try {
    if (fitbit.isConfigured()) {
      const sleep = await fitbit.getSleepData(dateStr, userId);
      return res.json({ success: true, provider: 'fitbit', source: 'fitbit', sleep });
    }
  } catch (err) {
    console.warn(`[WEARABLES] Fitbit sleep failed: ${err instanceof Error ? err.message : err}`);
  }

  // Journal cache last resort
  try {
    const entry = await getDataService().getJournalEntry(userId, dateStr);
    if (entry?.fitbit_score && entry.fitbit_score > 0) {
      return res.json({
        success: true,
        provider: 'cache',
        source: 'cache',
        sleep: {
          score: entry.fitbit_score,
          hours: entry.sleep_hours ?? 0,
          vitality: entry.fitbit_score / 10,
          efficiency: 0,
          deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0,
          startTime: entry.sleep_start ?? undefined,
          endTime: entry.sleep_end ?? undefined,
        },
      });
    }
  } catch { /* ignore */ }

  return res.status(404).json({
    success: false,
    error: 'No wearable sleep data. Connect Oura via /api/oura/connect-url.',
  });
});

router.get('/readiness/today', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const dateStr = typeof req.query.date === 'string'
    ? req.query.date
    : new Date().toLocaleDateString('en-CA');

  try {
    if (!(await oura.hasTokens(userId))) {
      return res.status(404).json({ success: false, error: 'Oura not connected' });
    }
    const readiness = await oura.getReadiness(dateStr, userId);
    return res.json({ success: true, provider: 'oura', readiness });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ success: false, error: msg });
  }
});

export default router;
