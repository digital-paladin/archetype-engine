import { Router, Request, Response } from 'express';
import {
  getVault,
  addEntry,
  removeEntry,
  toggleGateCriterion,
  toggleSoFiRealized,
  setVaultStatus,
  simulateRoll,
  AddEntryPayload,
} from '../services/vault.service';
import { RewardTier, REWARD_TIERS } from '../models/vault';

const router = Router();

// GET /api/vault — full vault state (balance, status, gate, entries)
router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, vault: getVault() });
});

// GET /api/vault/tiers — reward tier definitions (for UI dropdowns)
router.get('/tiers', (_req: Request, res: Response) => {
  res.json({ success: true, tiers: REWARD_TIERS });
});

// POST /api/vault/entries — log a new milestone reward
// Body: { milestone, tier?, customBaseAmount?, tags?, date? }
router.post('/entries', (req: Request, res: Response) => {
  const { milestone, tier, customBaseAmount, tags, date } = req.body as AddEntryPayload & { customBaseAmount?: number };

  if (!milestone || typeof milestone !== 'string') {
    return res.status(400).json({ success: false, error: 'milestone (string) is required' });
  }

  const resolvedTier: RewardTier = tier && Object.keys(REWARD_TIERS).includes(tier) ? tier : 'minimum';

  if (resolvedTier === 'custom' && (typeof customBaseAmount !== 'number' || customBaseAmount <= 0)) {
    return res.status(400).json({ success: false, error: 'customBaseAmount (positive number) required for custom tier' });
  }

  const entry = addEntry({ milestone, tier: resolvedTier, customBaseAmount, tags, date });
  res.status(201).json({ success: true, entry, vault: getVault() });
});

// DELETE /api/vault/entries/:id — remove a vault entry
router.delete('/entries/:id', (req: Request, res: Response) => {
  const removed = removeEntry(req.params.id);
  if (!removed) {
    return res.status(404).json({ success: false, error: 'Entry not found' });
  }
  res.json({ success: true, vault: getVault() });
});

// PATCH /api/vault/entries/:id/sofi — toggle realizedInSoFi flag (mark as moved to SoFi savings goal)
router.patch('/entries/:id/sofi', (req: Request, res: Response) => {
  const entry = toggleSoFiRealized(req.params.id);
  if (!entry) {
    return res.status(404).json({ success: false, error: 'Entry not found' });
  }
  res.json({ success: true, entry, vault: getVault() });
});

// PATCH /api/vault/gate/:id — toggle a gate criterion met/unmet
router.patch('/gate/:id', (req: Request, res: Response) => {
  const criterion = toggleGateCriterion(req.params.id);
  if (!criterion) {
    return res.status(404).json({ success: false, error: 'Gate criterion not found' });
  }
  res.json({ success: true, criterion, vault: getVault() });
});

// POST /api/vault/status — manually set vault locked/unlocked
// Body: { status: 'locked' | 'unlocked' }
router.post('/status', (req: Request, res: Response) => {
  const { status } = req.body as { status: 'locked' | 'unlocked' };
  if (status !== 'locked' && status !== 'unlocked') {
    return res.status(400).json({ success: false, error: 'status must be locked or unlocked' });
  }
  const vault = setVaultStatus(status);
  res.json({ success: true, vault });
});

// POST /api/vault/roll — simulate a dice roll (preview, no entry created)
// Body: { sides: 6 | 12 }
router.post('/roll', (req: Request, res: Response) => {
  const { sides } = req.body as { sides: 6 | 12 };
  if (sides !== 6 && sides !== 12) {
    return res.status(400).json({ success: false, error: 'sides must be 6 or 12' });
  }
  const result = simulateRoll(sides);
  res.json({ success: true, ...result });
});

export default router;
