/**
 * POST /api/consolidation/run
 * Runs end-of-day sleep consolidation for the authenticated user.
 *
 * Request body (all optional):
 *   { date?: string, streakDays?: number }
 *   - date:       "YYYY-MM-DD" (defaults to today in local time)
 *   - streakDays: consecutive active days driving the consolidation tier
 *                 (defaults to 690 — Grandmaster tier, accurate for current system state)
 *
 * GET /api/consolidation/history?limit=30
 * Returns xp_history rows for the authenticated user (most-recent-first).
 */

import { Router, Request, Response } from 'express';
import { ConsolidationService } from '../services/consolidation.service';
import { getDataService } from '../services/data/dataService';

const router = Router();

/**
 * POST /api/consolidation/run
 */
router.post('/run', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const {
    date       = new Date().toLocaleDateString('en-CA'),
    streakDays = 690,
  } = req.body ?? {};

  if (typeof streakDays !== 'number' || streakDays < 0) {
    return res.status(400).json({ error: 'streakDays must be a non-negative number' });
  }

  try {
    const service = new ConsolidationService();
    const result  = await service.runForUser(userId, date, streakDays);

    const levelUps = result.classes
      .filter(r => r.leveledUp)
      .map(r => ({ className: r.className, newLevel: r.newLevel }));

    console.log(
      `[CONSOLIDATION] ${date} — pending ${result.totalPending} XP → confirmed ${result.totalConfirmed} XP` +
      ` (${result.consolidationPct}% — ${result.streakTier}, Fitbit ${result.fitbitScore ?? 'N/A'})` +
      (levelUps.length ? ` 🎉 Level-ups: ${levelUps.map(l => `${l.className} L${l.newLevel}`).join(', ')}` : '')
    );

    res.json({ success: true, ...result, levelUps });
  } catch (error) {
    console.error('[CONSOLIDATION] run error:', error);
    res.status(500).json({
      error:   'Consolidation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/consolidation/history
 */
router.get('/history', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const limit = Math.min(parseInt(req.query['limit'] as string) || 30, 100);

  try {
    const db      = getDataService();
    const history = await db.getXPHistory(userId, limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({
      error:   'Failed to fetch consolidation history',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
