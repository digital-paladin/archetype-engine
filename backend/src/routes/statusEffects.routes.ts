import { Router, Request, Response } from 'express';
import {
  getAllEffects,
  addEffect,
  removeEffect,
  clearAllEffects,
  CreateEffectPayload,
} from '../services/statusEffects.service';
import { STATUS_EFFECT_TEMPLATES } from '../models/statusEffect';

const router = Router();

function userIdOf(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}

// GET /api/status-effects — all active (non-expired) effects
router.get('/', async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ success: false, error: 'Missing user' });
  try {
    const effects = await getAllEffects(userId);
    res.json({ success: true, effects });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to load effects' });
  }
});

// GET /api/status-effects/templates — pre-defined effect templates
router.get('/templates', (_req: Request, res: Response) => {
  res.json({ success: true, templates: STATUS_EFFECT_TEMPLATES });
});

// POST /api/status-effects — add a new effect
// Body: CreateEffectPayload (see service)
router.post('/', async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ success: false, error: 'Missing user' });
  const { name, type, category, source, icon, effects, duration, notes, dose } = req.body as CreateEffectPayload;

  if (!name || !type || !source || !icon || !Array.isArray(effects) || typeof duration !== 'number') {
    return res.status(400).json({
      success: false,
      error: 'Required: name, type, source, icon, effects[], duration',
    });
  }

  if (!['buff', 'debuff', 'mixed'].includes(type)) {
    return res.status(400).json({ success: false, error: 'type must be buff | debuff | mixed' });
  }

  try {
    const created = await addEffect(userId, {
      name, type, category: category || 'other', source, icon, effects, duration, notes, dose,
    });
    res.status(201).json({ success: true, effect: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to add effect' });
  }
});

// DELETE /api/status-effects/:id — remove a specific effect
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ success: false, error: 'Missing user' });
  try {
    const removed = await removeEffect(userId, req.params.id);
    if (!removed) return res.status(404).json({ success: false, error: 'Effect not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to remove effect' });
  }
});

// DELETE /api/status-effects — clear all effects
router.delete('/', async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ success: false, error: 'Missing user' });
  try {
    await clearAllEffects(userId);
    res.json({ success: true, message: 'All status effects cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to clear effects' });
  }
});

export default router;
