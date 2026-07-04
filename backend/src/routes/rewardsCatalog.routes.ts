import { Router, Request, Response } from 'express';
import {
  getCatalog,
  addItem,
  removeItem,
  rollForItem,
  claimItem,
  toggleRealized,
  resetItem,
  updateProfitPool,
  AddItemPayload,
  UpdateProfitPoolPayload,
} from '../services/rewardsCatalog.service';

export const rewardsCatalogRouter = Router();

// GET /api/rewards-catalog
rewardsCatalogRouter.get('/', (_req: Request, res: Response) => {
  res.json(getCatalog());
});

// POST /api/rewards-catalog/items
rewardsCatalogRouter.post('/items', (req: Request, res: Response) => {
  const payload = req.body as AddItemPayload;
  if (!payload.name || !payload.category || !payload.fundingSource) {
    res.status(400).json({ error: 'name, category, and fundingSource are required' });
    return;
  }
  const item = addItem(payload);
  res.status(201).json(item);
});

// DELETE /api/rewards-catalog/items/:id
rewardsCatalogRouter.delete('/items/:id', (req: Request, res: Response) => {
  const removed = removeItem(req.params.id);
  if (!removed) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }
  res.json({ success: true });
});

// POST /api/rewards-catalog/items/:id/roll  — mystery-box dice roll
rewardsCatalogRouter.post('/items/:id/roll', (req: Request, res: Response) => {
  const result = rollForItem(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Item not found or does not have dice configured' });
    return;
  }
  res.json(result);
});

// PATCH /api/rewards-catalog/items/:id/claim  — direct claim (no dice)
rewardsCatalogRouter.patch('/items/:id/claim', (req: Request, res: Response) => {
  const item = claimItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }
  res.json(item);
});

// PATCH /api/rewards-catalog/items/:id/realize  — toggle physical purchase
rewardsCatalogRouter.patch('/items/:id/realize', (req: Request, res: Response) => {
  const item = toggleRealized(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }
  res.json(item);
});

// PATCH /api/rewards-catalog/items/:id/reset  — undo claim
rewardsCatalogRouter.patch('/items/:id/reset', (req: Request, res: Response) => {
  const item = resetItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }
  res.json(item);
});

// PATCH /api/rewards-catalog/profit-pool  — deposit trading profits or adjust allocation %
rewardsCatalogRouter.patch('/profit-pool', (req: Request, res: Response) => {
  const payload = req.body as UpdateProfitPoolPayload;
  const updated = updateProfitPool(payload);
  res.json(updated);
});
