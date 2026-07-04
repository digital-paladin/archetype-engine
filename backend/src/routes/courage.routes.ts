import { Router, Request, Response } from 'express';
import {
  getCourageStat,
  addMilestone,
  removeMilestone,
  applyCourageFlag,
  previewSessionXP,
  ELIGIBLE_ACTIVITIES,
} from '../services/courage.service';

const router = Router();

/** GET /api/courage — full courage stat + activity progress */
router.get('/', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getCourageStat() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load courage data', message: err instanceof Error ? err.message : err });
  }
});

/** GET /api/courage/eligible — list of activities that earn session bonuses */
router.get('/eligible', (_req: Request, res: Response) => {
  res.json({
    success: true,
    activities: Object.entries(ELIGIBLE_ACTIVITIES).map(([type, meta]) => ({
      activityType: type,
      ...meta,
    })),
  });
});

/**
 * GET /api/courage/preview?activityType=workout-swimming
 * Preview XP that would be awarded for a session of this type.
 */
router.get('/preview', (req: Request, res: Response) => {
  const activityType = req.query.activityType as string;
  if (!activityType) return res.status(400).json({ error: 'activityType query param required' });
  res.json({ success: true, ...previewSessionXP(activityType) });
});

/**
 * POST /api/courage/milestones
 * Add a one-time fear-conquest milestone.
 * Body: { title, domain, date (YYYY-MM-DD), xp, notes? }
 */
router.post('/milestones', (req: Request, res: Response) => {
  try {
    const { title, domain, date, xp, notes } = req.body;
    if (!title || !domain || !date || typeof xp !== 'number') {
      return res.status(400).json({ error: 'title, domain, date, and xp (number) are required' });
    }
    const milestone = addMilestone(title, domain, date, xp, notes);
    res.json({ success: true, milestone, totalXP: getCourageStat().totalXP });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add milestone' });
  }
});

/**
 * DELETE /api/courage/milestones/:id
 * Remove a milestone and deduct its XP.
 */
router.delete('/milestones/:id', (req: Request, res: Response) => {
  try {
    const removed = removeMilestone(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Milestone not found' });
    res.json({ success: true, totalXP: getCourageStat().totalXP });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove milestone' });
  }
});

/**
 * POST /api/courage/flag
 * Manually award courage-flag XP (1× per day cap).
 * Body: { activityType, note? }
 */
router.post('/flag', (req: Request, res: Response) => {
  try {
    const { activityType, note } = req.body;
    if (!activityType) return res.status(400).json({ error: 'activityType is required' });
    const xpAwarded = applyCourageFlag(activityType, note);
    res.json({ success: true, xpAwarded, totalXP: getCourageStat().totalXP });
  } catch (err) {
    res.status(500).json({ error: 'Failed to apply courage flag' });
  }
});

export default router;
