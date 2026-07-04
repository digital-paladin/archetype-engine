import { Router, Request, Response } from 'express';
import { getDataService } from '../services/data/dataService';

const router = Router();

/**
 * GET /api/inventory/equipped
 * Returns the list of equipped armor item IDs from character_profile.rpg_stats.equipped_armor.
 */
router.get('/equipped', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
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
    const userId = (req as any).userId as string;
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

    console.log(`[INVENTORY] ${isEquipped ? 'Unequipped' : 'Equipped'} item ${itemId} for user ${userId}`);
    res.json({ success: true, itemId, equipped: !isEquipped, equippedArmor: updatedEquipped });
  } catch (error) {
    console.error('[INVENTORY] POST /toggle-equip error:', error);
    res.status(500).json({ error: 'Failed to toggle equipment' });
  }
});

export default router;
