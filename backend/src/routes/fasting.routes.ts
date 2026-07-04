import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';

const router = Router();
const db = getDataService();

/**
 * POST /api/fasting
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { hours, date } = req.body;
    if (hours === undefined || isNaN(Number(hours))) {
      return res.status(400).json({ error: 'Missing or invalid hours value' });
    }

    const userId  = (req as any).userId as string;
    const dateStr = (date as string | undefined) ?? new Date().toLocaleDateString('en-CA');

    await db.upsertJournalEntry(userId, { entry_date: dateStr, fasting_hours: Number(hours) });

    console.log(`[FASTING] ✅ Logged ${hours} hrs for ${dateStr}`);
    res.json({ success: true, message: `Fasting logged for ${hours} hrs.` });
  } catch (error: any) {
    console.error('Fasting POST error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
