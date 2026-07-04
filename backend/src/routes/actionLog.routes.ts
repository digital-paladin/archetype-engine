import { Router, Request, Response } from 'express';
import { ACTION_ITEMS_LABELS, ACM_ITEM_COUNT } from '../config/acm.config';
import { getDataService } from '../services/data/dataService';

const router = Router();
const db = getDataService();

/**
 * GET /api/action-log?date=YYYY-MM-DD
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date query parameter required (YYYY-MM-DD)' });
    }
    const userId = (req as any).userId as string;
    const rows   = await db.getACMEntries(userId, date);

    const actionItems: boolean[] = Array(ACM_ITEM_COUNT).fill(false);
    for (const r of rows) {
      if (r.item_index >= 0 && r.item_index < ACM_ITEM_COUNT) {
        actionItems[r.item_index] = r.completed;
      }
    }
    res.json({ success: true, date, actionItems, labels: ACTION_ITEMS_LABELS });
  } catch (e: any) {
    console.error('GET /api/action-log error:', e);
    res.status(500).json({ error: 'Failed to retrieve action log', details: e.message });
  }
});

/**
 * POST /api/action-log
 * Body: { date: 'YYYY-MM-DD', actionItems: boolean[] }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { date, actionItems } = req.body;
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
    }
    if (!Array.isArray(actionItems) || actionItems.length !== ACM_ITEM_COUNT
        || !actionItems.every((i: unknown) => typeof i === 'boolean')) {
      return res.status(400).json({ error: 'actionItems must be boolean[' + ACM_ITEM_COUNT + ']' });
    }

    const userId = (req as any).userId as string;
    await db.updateACMEntries(userId, date, actionItems);

    const count = (actionItems as boolean[]).filter(Boolean).length;
    console.log('[ACTION LOG] Updated ' + date + ': ' + count + '/' + ACM_ITEM_COUNT + ' checked');
    res.json({ success: true });
  } catch (e: any) {
    console.error('POST /api/action-log error:', e);
    res.status(500).json({ error: 'Failed to update action log', details: e.message });
  }
});

export default router;
