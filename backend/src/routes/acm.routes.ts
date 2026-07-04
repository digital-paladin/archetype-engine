/**
 * Action Consequence Matrix (ACM) routes
 * GET /api/acm/today — compute today's 4 ACM stats from Supabase acm_entries
 *
 * Stat index map (0-based):
 *  0: Abstained alcohol        7: Fasting
 *  1: Wake Up With God         8: Hydration Discipline
 *  2: Physical Training        9: Diet Plan (Dr. Alfred)
 *  3: Deep Work: Dev          10: Abstained sexual indulgence
 *  4: Deep Work: RedTeam      11: Protein goal
 *  5: Deep Work: Artist       12: Pre-Sleep Bonfire Routine
 *  6: Deep Work: Mech Eng     13: DR-ALFRED Supplement Stack
 */

import { Router, Request, Response } from 'express';
import { ACM_ITEM_COUNT } from '../config/acm.config';
import { getDataService } from '../services/data/dataService';

const router = Router();
const db = getDataService();

// ── Stat weights (per item index, 0-13, each stat sums to 100) ───────────────
// Brush teeth removed (maintenance marker, not a Nen restriction — moved to general quest)
// RedTeam W_CLARITY reduced 15→10 (vow not yet established; revisit when 5+days/week)
// Alcohol W_SPIRITUAL 0→5 (sobriety is a spiritual vow; redistributed from brush teeth)
// Pre-Sleep Bonfire W_PLEASURE 0→5 (ritual completion reward signal; redistributed)
const W_SPIRITUAL = [5, 45, 0, 0, 0, 5, 0, 15, 0, 0, 30, 0, 0, 0];
const W_PHYSICAL  = [0, 0, 45, 0, 0, 0, 10, 15, 10, 5, 0, 10, 0, 5];
const W_CLARITY   = [30, 0, 0, 20, 10, 10, 10, 0, 0, 0, 0, 0, 15, 5];
const W_PLEASURE  = [30, 0, 0, 0, 0, 10, 0, 0, 0, 20, 35, 0, 5, 0];

function computeStat(states: boolean[], weights: number[]): number {
  return states.reduce((sum, st, i) => sum + (st && weights[i] ? weights[i] : 0), 0);
}

function todayDateStr(): string {
  return new Date().toLocaleDateString('en-CA');
}

/**
 * GET /api/acm/today?date=YYYY-MM-DD
 */
router.get('/today', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const date   = (typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
      ? req.query.date : todayDateStr();

    // ACM items from Supabase
    const acmRows   = await db.getACMEntries(userId, date);
    const itemStates: boolean[] = Array(ACM_ITEM_COUNT).fill(false);
    for (const row of acmRows) {
      if (row.item_index >= 0 && row.item_index < ACM_ITEM_COUNT) {
        itemStates[row.item_index] = row.completed;
      }
    }

    // Sleep vitality from journal entry
    const entry      = await db.getJournalEntry(userId, date);
    const fitbitScore = entry?.fitbit_score ?? 0;
    const vitality    = fitbitScore / 10;
    const sleepBonus  = Math.round((vitality / 10) * 5);

    const spiritual  = Math.min(computeStat(itemStates, W_SPIRITUAL) + sleepBonus, 100);
    const physical   = Math.min(computeStat(itemStates, W_PHYSICAL)  + sleepBonus, 100);
    const clarity    = Math.min(computeStat(itemStates, W_CLARITY)   + sleepBonus, 100);
    const pleasure   = computeStat(itemStates, W_PLEASURE);

    const anhedoniaRisk  = pleasure >= 80 ? 'Low' : pleasure >= 60 ? 'Medium' : 'High';
    const completedCount = itemStates.filter(Boolean).length;

    // ── 7-day rolling pleasure baseline (anchored to requested date) ──────────
    // Mechanistic basis: dopamine receptor downregulation requires sustained
    // supranormal exposure over days-to-weeks to manifest; single-day compliance
    // does not restore a depressed baseline. Rolling average captures actual state.
    const [yr, mo, dy] = date.split('-').map(Number);
    const anchor = new Date(yr, mo - 1, dy);
    const window7d = Array.from({ length: 7 }, (_, i) => {
      const d7 = new Date(anchor);
      d7.setDate(anchor.getDate() - i);
      return d7.toLocaleDateString('en-CA');
    });

    const pleasureScores = await Promise.all(
      window7d.map(async (windowDate) => {
        const wRows = await db.getACMEntries(userId, windowDate);
        const wStates: boolean[] = Array(ACM_ITEM_COUNT).fill(false);
        for (const row of wRows) {
          if (row.item_index >= 0 && row.item_index < ACM_ITEM_COUNT) {
            wStates[row.item_index] = row.completed;
          }
        }
        return computeStat(wStates, W_PLEASURE);
      })
    );

    const rollingPleasure7d = Math.round(
      pleasureScores.reduce((a, b) => a + b, 0) / pleasureScores.length
    );

    const dopamineBaseline =
      rollingPleasure7d >= 80 ? 'Healthy'    :
      rollingPleasure7d >= 60 ? 'Suppressed' :
      rollingPleasure7d >= 40 ? 'Depleted'   : 'Critical';

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const [y, m, d] = date.split('-').map(Number);
    const dateHeader = date + ' (' + days[new Date(y, m - 1, d).getDay()] + ')';

    console.log('[ACM] ' + dateHeader + ' | ' + completedCount + '/' + ACM_ITEM_COUNT + ' | spiritual=' + spiritual + ' physical=' + physical + ' clarity=' + clarity + ' pleasure=' + pleasure + ' (7d:' + rollingPleasure7d + ') | risk=' + anhedoniaRisk + ' baseline=' + dopamineBaseline);

    res.json({
      success: true,
      date: dateHeader,
      completedCount,
      itemStates,
      stats:        { spiritual, physical, clarity, pleasure },
      sleepVitality: vitality,
      sleepBonus,
      anhedoniaRisk,
      rollingPleasure7d,
      dopamineBaseline,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[ACM] Error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
