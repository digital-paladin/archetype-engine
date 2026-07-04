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

// GET /api/status-effects — all active (non-expired) effects
router.get('/', (_req: Request, res: Response) => {
  const effects = getAllEffects();
  res.json({ success: true, effects });
});

// GET /api/status-effects/templates — pre-defined effect templates
router.get('/templates', (_req: Request, res: Response) => {
  res.json({ success: true, templates: STATUS_EFFECT_TEMPLATES });
});

// POST /api/status-effects — add a new effect
// Body: CreateEffectPayload (see service)
router.post('/', (req: Request, res: Response) => {
  const { name, type, category, source, icon, effects, duration, notes } = req.body as CreateEffectPayload;

  if (!name || !type || !source || !icon || !Array.isArray(effects) || typeof duration !== 'number') {
    return res.status(400).json({
      success: false,
      error: 'Required: name, type, source, icon, effects[], duration',
    });
  }

  if (!['buff', 'debuff', 'mixed'].includes(type)) {
    return res.status(400).json({ success: false, error: 'type must be buff | debuff | mixed' });
  }

  const created = addEffect({ name, type, category: category || 'other', source, icon, effects, duration, notes });
  res.status(201).json({ success: true, effect: created });
});

// DELETE /api/status-effects/:id — remove a specific effect
router.delete('/:id', (req: Request, res: Response) => {
  const removed = removeEffect(req.params.id);
  if (!removed) {
    return res.status(404).json({ success: false, error: 'Effect not found' });
  }
  res.json({ success: true });
});

// DELETE /api/status-effects — clear all effects
router.delete('/', (_req: Request, res: Response) => {
  clearAllEffects();
  res.json({ success: true, message: 'All status effects cleared' });
});

export default router;
