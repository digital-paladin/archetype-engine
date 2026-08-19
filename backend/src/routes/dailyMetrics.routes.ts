import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';
import { JournalEntry } from '../services/data/IDataService';
import { OuraService } from '../services/oura.service';
import { GoogleHealthService } from '../services/googleHealth.service';
import { FitbitService } from '../services/fitbit.service';
import {
  applyWearableNights,
  calendarDaysNewestFirst,
  localDateStr,
  mergeJournalIntoCalendar,
  missingSleepDates,
} from '../services/sleepHistoryCalendar';
import { syncSleepDebtFromJournalSafe } from '../services/sleepDebt.service';

const router = Router();
const db = getDataService();

function todayDateStr(): string {
  return localDateStr();
}

async function backfillWearableSleep(
  userId: string,
  fromDate: string,
  toDate: string,
  missing: string[],
): Promise<Array<{ date: string; hours: number; score: number }>> {
  if (missing.length === 0) return [];
  const missingSet = new Set(missing);
  const oura = new OuraService();
  const googleHealth = new GoogleHealthService();
  const fitbit = new FitbitService();

  try {
    if (oura.isConfigured() && await oura.hasTokens(userId)) {
      const nights: Array<{ date: string; hours: number; score: number }> = [];
      for (const date of missing) {
        try {
          const sleep = await oura.getSleepData(date, userId);
          if (sleep.hours > 0) nights.push({ date, hours: sleep.hours, score: sleep.score });
        } catch { /* skip night */ }
      }
      if (nights.length > 0) return nights;
    }
  } catch (err) {
    console.warn(`[DAILY] Oura sleep range skipped: ${err instanceof Error ? err.message : err}`);
  }

  try {
    if (googleHealth.isConfigured() && await googleHealth.hasTokens(userId)) {
      const nights: Array<{ date: string; hours: number; score: number }> = [];
      for (const date of missing) {
        try {
          const sleep = await googleHealth.getSleepData(date, userId);
          if (sleep.hours > 0) nights.push({ date, hours: sleep.hours, score: sleep.score });
        } catch { /* skip night */ }
      }
      if (nights.length > 0) return nights;
    }
  } catch (err) {
    console.warn(`[DAILY] Google Health sleep range skipped: ${err instanceof Error ? err.message : err}`);
  }

  try {
    if (fitbit.isConfigured()) {
      const range = await fitbit.getSleepRange(fromDate, toDate, userId);
      return range
        .filter(n => missingSet.has(n.date) && n.hours > 0)
        .map(n => ({ date: n.date, hours: n.hours, score: n.score }));
    }
  } catch (err) {
    console.warn(`[DAILY] Fitbit sleep range skipped: ${err instanceof Error ? err.message : err}`);
  }

  return [];
}

/** Map a JournalEntry DB row to the legacy response shape the frontend expects */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function entryToMetrics(entry: JournalEntry | null) {
  if (!entry) {
    return {
      sleep:     { bedtime: null, wakeTime: null, totalSleep: null, fitbitScore: null, vitalityScore: null, quality: null },
      nutrition: { meals: null, protein: null, calories: null, hydration: null, foodNotes: '' },
      stress:    { stress: null, energy: null, mentalState: null },
    };
  }
  const vitalityScore = entry.fitbit_score != null ? entry.fitbit_score / 10 : null;
  return {
    sleep: {
      bedtime:      entry.sleep_start  ?? null,
      wakeTime:     entry.sleep_end    ?? null,
      totalSleep:   entry.sleep_hours  ?? null,
      fitbitScore:  entry.fitbit_score ?? null,
      vitalityScore,
      quality: null,
    },
    nutrition: {
      meals:     null,
      protein:   entry.protein_level   ?? null,
      calories:  entry.calories_status ?? null,
      hydration: entry.hydration_oz    ?? null,
      foodNotes: entry.notes           ?? '',
    },
    stress: {
      // DB stores lowercase ('low','medium','high'); frontend expects Title-Case for button matching.
      stress:      entry.stress_level ? capitalize(entry.stress_level) : null,
      energy:      entry.energy_score ?? null,
      mentalState: entry.mental_state ?? null,
    },
  };
}

// ── GET /api/daily-metrics?date=YYYY-MM-DD ───────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const date = (typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
    ? req.query.date : todayDateStr();
  try {
    const userId = (req as any).userId as string;
    const entry  = await db.getJournalEntry(userId, date);
    res.json({ success: true, date, metrics: entryToMetrics(entry) });
  } catch (e: any) {
    console.error('[DAILY METRICS GET] Error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/daily-metrics/sleep-history ────────────────────────────────────
router.get('/sleep-history', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const daysParam = parseInt(req.query.days as string, 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 100 ? daysParam : 30;
    const end = todayDateStr();
    const dates = calendarDaysNewestFirst(end, days);
    const fromDate = dates[dates.length - 1];
    const journal = await db.listJournalSleepRange(userId, fromDate, end);
    let slots = mergeJournalIntoCalendar(dates, journal);
    const missing = missingSleepDates(slots);
    if (missing.length > 0) {
      const nights = await backfillWearableSleep(userId, fromDate, end, missing);
      slots = applyWearableNights(slots, nights);
      for (const night of nights) {
        if (!(night.hours > 0)) continue;
        try {
          await db.upsertJournalEntry(userId, {
            entry_date: night.date,
            sleep_hours: night.hours,
            fitbit_score: night.score,
          });
        } catch (persistErr) {
          console.warn(`[DAILY] sleep persist ${night.date} failed: ${persistErr instanceof Error ? persistErr.message : persistErr}`);
        }
      }
    }
    await syncSleepDebtFromJournalSafe(userId);
    res.json({ success: true, history: slots });
  } catch (e: any) {
    console.error('[DAILY] Error sleep-history:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/daily-metrics ───────────────────────────────────────────────────
// Body: { date, metrics: { sleep?, nutrition?, stress? } }
router.post('/', async (req: Request, res: Response) => {
  const { date, metrics } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'date required (YYYY-MM-DD)' });
  }
  if (!metrics || typeof metrics !== 'object') {
    return res.status(400).json({ success: false, error: 'metrics object required' });
  }

  try {
    const userId = (req as any).userId as string;
    const patch: Partial<JournalEntry> = { entry_date: date };

    if (metrics.sleep) {
      if (metrics.sleep.bedtime     != null) patch.sleep_start  = metrics.sleep.bedtime;
      if (metrics.sleep.wakeTime    != null) patch.sleep_end    = metrics.sleep.wakeTime;
      if (metrics.sleep.totalSleep  != null) patch.sleep_hours  = metrics.sleep.totalSleep;
      if (metrics.sleep.fitbitScore != null) patch.fitbit_score = metrics.sleep.fitbitScore;
    }
    if (metrics.nutrition) {
      const { protein, calories, hydration, foodNotes } = metrics.nutrition;
      if (protein   != null) patch.protein_level   = String(protein).toLowerCase()   as JournalEntry['protein_level'];
      if (calories  != null) patch.calories_status = String(calories).toLowerCase()  as JournalEntry['calories_status'];
      if (hydration != null) patch.hydration_oz    = hydration;
      if (foodNotes != null) patch.notes           = foodNotes;
    }
    if (metrics.stress) {
      const { stress, energy, mentalState } = metrics.stress;
      if (stress      != null) patch.stress_level = String(stress).toLowerCase() as JournalEntry['stress_level'];
      if (energy      != null) patch.energy_score = energy;
      if (mentalState != null) patch.mental_state = mentalState;
    }

    await db.upsertJournalEntry(userId, patch);
    if (patch.sleep_hours != null) {
      await syncSleepDebtFromJournalSafe(userId);
    }
    console.log('[DAILY METRICS POST] Updated ' + date);
    res.json({ success: true });
  } catch (e: any) {
    console.error('[DAILY METRICS POST] Error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
