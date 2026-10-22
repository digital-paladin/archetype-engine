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
import { allowsGoogleHealthReads, allowsLegacyFitbitReads } from '../services/fitbitDataSource';

const router = Router();
const db = getDataService();

/** Consumer-band HRV in milliseconds. Outside this is treated as a bad reading. */
const HRV_MS_MIN = 1;
const HRV_MS_MAX = 500;
/** Whole bpm. Wide enough for bradycardia and a strained "resting" sample. */
const RESTING_HR_MIN = 20;
const RESTING_HR_MAX = 220;
const SPO2_PCT_MIN = 0;
const SPO2_PCT_MAX = 100;
const VITALS_SOURCES = new Set(['hume', 'fitbit', 'oura', 'manual']);

type VitalsColumnPatch = Partial<Pick<JournalEntry, 'hrv_ms' | 'resting_hr' | 'spo2_pct' | 'vitals_source'>>;

/**
 * Optional vitals on the metrics object. Absent fields are left unchanged.
 * Present-but-invalid fields reject the whole request (no partial write).
 */
function readOptionalVitals(metrics: Record<string, unknown>): { error: string } | { patch: VitalsColumnPatch } {
  const patch: VitalsColumnPatch = {};

  if (metrics.hrvMs != null) {
    const n = metrics.hrvMs;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < HRV_MS_MIN || n > HRV_MS_MAX) {
      return { error: `hrvMs must be a number of milliseconds between ${HRV_MS_MIN} and ${HRV_MS_MAX}` };
    }
    patch.hrv_ms = n;
  }

  if (metrics.restingHr != null) {
    const n = metrics.restingHr;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < RESTING_HR_MIN || n > RESTING_HR_MAX) {
      return { error: `restingHr must be an integer heart rate in bpm between ${RESTING_HR_MIN} and ${RESTING_HR_MAX}` };
    }
    patch.resting_hr = n;
  }

  if (metrics.spo2Pct != null) {
    const n = metrics.spo2Pct;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < SPO2_PCT_MIN || n > SPO2_PCT_MAX) {
      return { error: `spo2Pct must be a number between ${SPO2_PCT_MIN} and ${SPO2_PCT_MAX}` };
    }
    patch.spo2_pct = n;
  }

  if (metrics.source != null) {
    if (typeof metrics.source !== 'string') {
      return { error: 'source must be one of hume, fitbit, oura, manual' };
    }
    const source = metrics.source.trim().toLowerCase();
    if (!VITALS_SOURCES.has(source)) {
      return { error: 'source must be one of hume, fitbit, oura, manual' };
    }
    patch.vitals_source = source as JournalEntry['vitals_source'];
  }

  return { patch };
}

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

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
    if (allowsGoogleHealthReads() && googleHealth.isConfigured() && await googleHealth.hasTokens(userId)) {
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
    if (allowsLegacyFitbitReads() && fitbit.isConfigured()) {
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
  const vitals = {
    hrvMs:     finiteOrNull(entry?.hrv_ms),
    restingHr: finiteOrNull(entry?.resting_hr),
    spo2Pct:   finiteOrNull(entry?.spo2_pct),
    source:    entry?.vitals_source ?? null,
  };
  if (!entry) {
    return {
      sleep:     { bedtime: null, wakeTime: null, totalSleep: null, fitbitScore: null, vitalityScore: null, quality: null },
      nutrition: { meals: null, protein: null, calories: null, hydration: null, foodNotes: '' },
      stress:    { stress: null, energy: null, mentalState: null },
      ...vitals,
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
    ...vitals,
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
// Body: { date, metrics: { sleep?, nutrition?, stress?, hrvMs?, restingHr?, spo2Pct?, source? } }
// Vitals are optional and do not award XP. source tags the vitals reading only.
router.post('/', async (req: Request, res: Response) => {
  const { date, metrics } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'date required (YYYY-MM-DD)' });
  }
  if (!metrics || typeof metrics !== 'object') {
    return res.status(400).json({ success: false, error: 'metrics object required' });
  }

  const vitals = readOptionalVitals(metrics as Record<string, unknown>);
  if ('error' in vitals) {
    return res.status(400).json({ success: false, error: vitals.error });
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

    Object.assign(patch, vitals.patch);

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
