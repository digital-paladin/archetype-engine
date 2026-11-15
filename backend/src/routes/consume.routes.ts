import { Router, Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { pushLog } from '../services/activityLogStore';
import { ConsumptionError, correctConsumption, listConsumption, logConsumption } from '../services/consumption.service';
import { emitToUser } from '../realtime/userEmit';

const router = Router();

let io: SocketIOServer;
export function setConsumeSocketIO(socketInstance: SocketIOServer) {
  io = socketInstance;
}

// GET /api/consume?date=YYYY-MM-DD
// Lists that day's food log. Rows logged before ids existed are assigned one and saved.
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Missing user' });
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  try {
    const result = await listConsumption(userId, date, { authKind: 'user' });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ConsumptionError) {
      return res.status(error.status).json({ success: false, error: error.code, message: error.message });
    }
    console.error('[CONSUME] List failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to read consumption' });
  }
});

// PATCH /api/consume/:id
// Replaces fields on one entry and recalculates that day's totals, flags, and effects.
// Does not append a second activity-log row, so meal XP is not applied again.
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Missing user' });
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  try {
    const result = await correctConsumption(userId, req.params.id, {
      ...(req.body ?? {}),
      date: req.body?.date ?? date,
    }, { notifySystem: false, authKind: 'user' });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ConsumptionError) {
      return res.status(error.status).json({ success: false, error: error.code, message: error.message });
    }
    console.error('[CONSUME] Correction failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to persist to database' });
  }
});

// POST /api/consume
// Body: itemName, protein, calories, buffValue, plus optional waterOz, caffeineMg,
// addedSugarG, alcohol { volumeOz, abvPercent }, supplements[], consumedAt, clientDate.
// Alcohol sets abstinencePrompt and does not change ACM item 0 or the streak.
router.post('/', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Missing user' });

  try {
    const result = await logConsumption(userId, req.body ?? {}, { notifySystem: false, authKind: 'user' });
    const source = result.hydrationOz !== null && typeof req.body?.waterOz === 'number' && req.body.waterOz > 0
      ? 'water' as const
      : 'consume' as const;
    const protein = typeof req.body?.protein === 'number' ? req.body.protein : 0;
    const calories = typeof req.body?.calories === 'number' ? req.body.calories : 0;
    const waterOz = typeof req.body?.waterOz === 'number' ? req.body.waterOz : 0;
    const logNotes = source === 'water'
      ? `+${waterOz} oz`
      : [protein > 0 && `+${protein}g protein`, calories > 0 && `${calories} kcal`, result.effects[0]?.dose]
        .filter(Boolean)
        .join(' · ') || undefined;
    const logEntry = pushLog({ activityType: result.itemName, xp: 0, notes: logNotes, source });
    emitToUser(io, userId, 'activity-logged', logEntry);

    console.log(`[CONSUME] ${result.itemName} protein=${result.proteinGrams}g hydration=${result.hydrationOz ?? 0}oz effects=${result.effects.map(e => e.name).join(', ') || 'none'}`);
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ConsumptionError) {
      return res.status(error.status).json({ success: false, error: error.code, message: error.message });
    }
    console.error('[CONSUME] DB write failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to persist to database' });
  }
});

export default router;
