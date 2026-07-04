import { Router, Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { getDataService } from '../services/data/dataService';
import { pushLog } from '../services/activityLogStore';

const router = Router();

let io: SocketIOServer;
export function setConsumeSocketIO(socketInstance: SocketIOServer) {
  io = socketInstance;
}

// POST /api/consume
// Body: { itemName: string, protein: number, calories: number, buffValue: string, waterOz?: number, clientDate?: string }
router.post('/', async (req: Request, res: Response) => {
  const { itemName, protein, calories, buffValue, waterOz, clientDate } = req.body;

  if (!itemName || typeof protein !== 'number') {
    return res.status(400).json({ success: false, error: 'itemName and protein are required' });
  }

  const userId  = (req as any).userId as string;
  const dateStr = clientDate ?? new Date().toLocaleDateString('en-CA');
  const db      = getDataService();

  console.log(`\n[CONSUME] ─────────────────────────────────────────`);
  console.log(`[CONSUME] Item: ${itemName} | +${protein}g protein | ${calories ?? 0} kcal | ${buffValue}`);

  try {
    // Read current daily state so we can increment existing values
    const entry = await db.getJournalEntry(userId, dateStr);

    const newProteinGrams = (entry?.protein_grams_logged ?? 0) + protein;
    const newMealCount    = (calories > 0)
      ? (entry?.meal_count ?? 0) + 1
      : (entry?.meal_count ?? 0);
    const newHydrationOz  = (typeof waterOz === 'number' && waterOz > 0)
      ? (entry?.hydration_oz ?? 0) + waterOz
      : entry?.hydration_oz;

    // Derive protein level tier from running gram total
    const proteinLevel: 'low' | 'medium' | 'high' =
      newProteinGrams >= 130 ? 'high' : newProteinGrams >= 80 ? 'medium' : 'low';

    // Append item to today's food log
    const existingLog: Array<{ item: string; protein: number; calories: number; ts: string }> =
      Array.isArray(entry?.food_log) ? (entry!.food_log as any[]) : [];
    if (calories > 0 || protein > 0) {
      existingLog.push({ item: itemName, protein, calories: calories ?? 0, ts: new Date().toISOString() });
    }

    await db.upsertJournalEntry(userId, {
      entry_date:           dateStr,
      protein_grams_logged: newProteinGrams,
      protein_level:        proteinLevel,
      meal_count:           newMealCount,
      food_log:             existingLog,
      ...(newHydrationOz !== undefined && { hydration_oz: newHydrationOz }),
    });

    console.log(`[CONSUME] ✅ DB updated: protein=${newProteinGrams}g (${proteinLevel}) meals=${newMealCount} hydration=${newHydrationOz ?? 0}oz`);
    console.log(`[CONSUME] ─────────────────────────────────────────\n`);

    // Push to in-memory activity feed + real-time emit
    const source     = (typeof waterOz === 'number' && waterOz > 0) ? 'water' as const : 'consume' as const;
    const logNotes   = source === 'water'
      ? `+${waterOz} oz`
      : [protein > 0 && `+${protein}g protein`, calories > 0 && `${calories} kcal`].filter(Boolean).join(' · ') || undefined;
    const logEntry   = pushLog({ activityType: itemName, xp: 0, notes: logNotes, source });
    if (io) io.emit('activity-logged', logEntry);

    return res.json({ success: true, message: `Consumed ${itemName}: +${protein}g protein, ${calories ?? 0} kcal logged` });
  } catch (error) {
    console.error(`[CONSUME] ❌ DB write failed:`, error);
    console.log(`[CONSUME] ─────────────────────────────────────────\n`);
    return res.status(500).json({ success: false, error: 'Failed to persist to database' });
  }
});

export default router;
