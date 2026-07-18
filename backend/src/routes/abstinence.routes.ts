/**
 * Abstinence streak routes (Phase 2.10 / Sprint S5)
 *
 * GET  /api/abstinence/streaks
 * POST /api/abstinence/break
 * POST /api/abstinence/daily-increment   (cron / admin-style; auth required)
 * POST /api/abstinence/resistance-event
 * GET  /api/abstinence/resistance-events?item_index=
 */

import { Router, Request, Response } from 'express';
import { isAbstinenceItem } from '../config/acm.config';
import {
  getResistanceEvents,
  getStreaksForUser,
  logBreak,
  logResistanceEvent,
  runDailyIncrement,
  todayChicago,
} from '../services/abstinence.service';

const router = Router();

router.get('/streaks', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const streaks = await getStreaksForUser(userId);
    return res.json({ success: true, date: todayChicago(), streaks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('GET /api/abstinence/streaks error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
});

router.post('/break', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const itemIndex = Number(req.body?.item_index);
    const breakType = (req.body?.break_type as string) || 'unscheduled';

    if (!Number.isInteger(itemIndex) || !isAbstinenceItem(itemIndex)) {
      return res.status(400).json({
        success: false,
        error: 'item_index must be an abstinence ACM index (0 or 10)',
      });
    }
    if (breakType !== 'unscheduled' && breakType !== 'scheduled') {
      return res.status(400).json({
        success: false,
        error: "break_type must be 'unscheduled' or 'scheduled'",
      });
    }

    const result = await logBreak({
      userId,
      itemIndex,
      breakType: breakType as 'unscheduled' | 'scheduled',
    });

    return res.json({
      success: true,
      compound_break: result.compound_break,
      already_broken_today: result.already_broken_today,
      streak: result.streak,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    const status = /scheduled breaks are not enabled|not an abstinence/i.test(msg) ? 400 : 500;
    console.error('POST /api/abstinence/break error:', msg);
    return res.status(status).json({ success: false, error: msg });
  }
});

router.post('/daily-increment', async (req: Request, res: Response) => {
  try {
    // Authenticated operators / cron trigger via Bearer token (same as other APIs).
    // Full multi-user increment is intentional for S5 midnight job.
    const result = await runDailyIncrement();
    return res.json({ success: true, date: todayChicago(), ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('POST /api/abstinence/daily-increment error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
});

router.post('/resistance-event', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const itemIndex = Number(req.body?.item_index);
    const note = typeof req.body?.note === 'string' ? req.body.note : '';

    if (!Number.isInteger(itemIndex) || !isAbstinenceItem(itemIndex)) {
      return res.status(400).json({
        success: false,
        error: 'item_index must be an abstinence ACM index (0 or 10)',
      });
    }

    const streak = await logResistanceEvent({ userId, itemIndex, note });
    return res.json({ success: true, streak });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    const status = /required|max 280|not an abstinence/i.test(msg) ? 400 : 500;
    console.error('POST /api/abstinence/resistance-event error:', msg);
    return res.status(status).json({ success: false, error: msg });
  }
});

router.get('/resistance-events', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const itemIndex = Number(req.query?.item_index);
    if (!Number.isInteger(itemIndex) || !isAbstinenceItem(itemIndex)) {
      return res.status(400).json({
        success: false,
        error: 'item_index query must be an abstinence ACM index (0 or 10)',
      });
    }
    const events = await getResistanceEvents(userId, itemIndex);
    return res.json({ success: true, item_index: itemIndex, resistance_events: events });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('GET /api/abstinence/resistance-events error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
});

export default router;
