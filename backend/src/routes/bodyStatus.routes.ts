import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';
import { getActiveBodyStatuses } from '../services/bodyStatus.service';
import { BodyStatusRow } from '../services/data/IDataService';

const router = Router();

const VALID_TYPES = ['injury', 'illness', 'disease'];
const VALID_SEVERITIES = ['minor', 'moderate', 'severe', 'critical'];

// GET /api/body-status — active-only, replaces the old /api/character/injuries stub
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const statuses = await getActiveBodyStatuses(userId);
    res.json({ success: true, statuses });
  } catch (err) {
    console.error('[BODY-STATUS] GET failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load body status' });
  }
});

// POST /api/body-status — add a new injury/illness/disease entry
router.post('/', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const {
    bodyPart, type, severity, name, description,
    startDate, estimatedRecoveryDays, notes, impactsActions, xpPenalty,
  } = req.body as Record<string, any>;

  if (!bodyPart || !type || !severity || !name) {
    return res.status(400).json({
      success: false,
      error: 'Required: bodyPart, type, severity, name',
    });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ success: false, error: `type must be one of ${VALID_TYPES.join(' | ')}` });
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    return res.status(400).json({ success: false, error: `severity must be one of ${VALID_SEVERITIES.join(' | ')}` });
  }

  try {
    const db = getDataService();
    const row: Omit<BodyStatusRow, 'id' | 'user_id' | 'created_at'> = {
      body_part: bodyPart,
      type,
      severity,
      name,
      description,
      start_date: startDate || new Date().toISOString(),
      estimated_recovery_days: estimatedRecoveryDays,
      notes,
      impacts_actions: impactsActions ?? [],
      xp_penalty: xpPenalty ?? 0,
    };
    const created = await db.addBodyStatus(userId, row);
    res.status(201).json({ success: true, status: created });
  } catch (err) {
    console.error('[BODY-STATUS] POST failed:', err);
    res.status(500).json({ success: false, error: 'Failed to add body status' });
  }
});

// PATCH /api/body-status/:id — partial update (recovery revised, notes added, etc.)
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const {
    bodyPart, type, severity, name, description,
    estimatedRecoveryDays, notes, impactsActions, xpPenalty,
  } = req.body as Record<string, any>;

  const patch: Partial<BodyStatusRow> = {};
  if (bodyPart !== undefined) patch.body_part = bodyPart;
  if (type !== undefined) patch.type = type;
  if (severity !== undefined) patch.severity = severity;
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (estimatedRecoveryDays !== undefined) patch.estimated_recovery_days = estimatedRecoveryDays;
  if (notes !== undefined) patch.notes = notes;
  if (impactsActions !== undefined) patch.impacts_actions = impactsActions;
  if (xpPenalty !== undefined) patch.xp_penalty = xpPenalty;

  try {
    const db = getDataService();
    await db.updateBodyStatus(userId, req.params.id, patch);
    res.json({ success: true });
  } catch (err) {
    console.error('[BODY-STATUS] PATCH failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update body status' });
  }
});

// DELETE /api/body-status/:id — remove (also used for markHealed)
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const db = getDataService();
    await db.removeBodyStatus(userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[BODY-STATUS] DELETE failed:', err);
    res.status(500).json({ success: false, error: 'Failed to remove body status' });
  }
});

export default router;
