import { Router, Request, Response } from 'express';
import { InventoryError } from '../domain/inventory';
import { getDataService } from '../services/data/dataService';
import {
  createInventoryItem,
  listInventory,
  setInventoryEquipped,
  updateInventoryItem,
} from '../services/inventory.service';

const router = Router();

function userIdOf(req: Request): string {
  const userId = (req as Request & { userId?: string }).userId;
  if (!userId) {
    const err = new InventoryError('unauthorized', 'Unauthorized', 401);
    throw err;
  }
  return userId;
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof InventoryError) {
    res.status(err.status).json({ success: false, error: err.code, message: err.message });
    return;
  }
  console.error('[INVENTORY]', err instanceof Error ? err.message : err);
  res.status(500).json({
    success: false,
    error: 'internal',
    message: err instanceof Error ? err.message : 'Unknown error',
  });
}

/**
 * GET /api/inventory
 * Copies catalog defaults the user does not already have, then returns their items.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const items = await listInventory(userIdOf(req));
    res.json({ success: true, items });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /api/inventory
 * Create a runtime item. `id` is the stable slug. The response `rowId` is what
 * an acquisition quest stores as inventoryItemId.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const item = await createInventoryItem(userIdOf(req), req.body ?? {});
    res.status(201).json({ success: true, item });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * PATCH /api/inventory/:id
 * `:id` is the slug. Stock, name, and labels only — this route does not award XP.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const item = await updateInventoryItem(userIdOf(req), req.params.id, req.body ?? {});
    res.json({ success: true, item });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /api/inventory/equipped
 * Returns the list of equipped armor item IDs from character_profile.rpg_stats.equipped_armor.
 */
router.get('/equipped', async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDataService();
    const profile = await db.getCharacterProfile(userId);
    const equippedArmor: string[] = (profile?.rpg_stats as any)?.equipped_armor ?? [];

    res.json({ success: true, equippedArmor });
  } catch (error) {
    console.error('[INVENTORY] GET /equipped error:', error);
    res.status(500).json({ error: 'Failed to load inventory' });
  }
});

/**
 * POST /api/inventory/toggle-equip/:itemId
 * Toggles an item in/out of the equipped_armor list stored in character_profile.rpg_stats.
 */
router.post('/toggle-equip/:itemId', async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { itemId } = req.params;
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });

    const db = getDataService();
    const profile = await db.getCharacterProfile(userId);
    const currentRpgStats: Record<string, any> = (profile?.rpg_stats as any) ?? {};
    const currentEquipped: string[] = currentRpgStats.equipped_armor ?? [];

    const isEquipped = currentEquipped.includes(itemId);
    const updatedEquipped = isEquipped
      ? currentEquipped.filter(id => id !== itemId)
      : [...currentEquipped, itemId];

    await db.upsertCharacterProfile(userId, {
      rpg_stats: { ...currentRpgStats, equipped_armor: updatedEquipped },
    });

    try {
      await setInventoryEquipped(userId, itemId, !isEquipped);
    } catch (err) {
      console.error('[INVENTORY] item equipped flag was not synced:', err instanceof Error ? err.message : err);
    }

    console.log(`[INVENTORY] ${isEquipped ? 'Unequipped' : 'Equipped'} item ${itemId} for user ${userId}`);
    res.json({ success: true, itemId, equipped: !isEquipped, equippedArmor: updatedEquipped });
  } catch (error) {
    console.error('[INVENTORY] POST /toggle-equip error:', error);
    res.status(500).json({ error: 'Failed to toggle equipment' });
  }
});

export default router;
