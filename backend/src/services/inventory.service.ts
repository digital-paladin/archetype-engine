/**
 * Per-user inventory. The catalog is copied from inventory_item_defaults
 * (migration 014) the first time a user lists items. Costs are labels only —
 * nothing in this module awards XP.
 */

import {
  InventoryError,
  InventoryItemView,
  InventoryRecord,
  applyItemPatch,
  normalizeNewItem,
  toInventoryView,
} from '../domain/inventory';
import { getSystemQuestStore } from './systemQuest.store';
import { getDataService } from './data/dataService';
import { getInventoryStore } from './inventory.store';

function isUnique(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

async function questSummaries(userId: string, questIds: string[]) {
  const wanted = new Set(questIds.filter(Boolean));
  if (!wanted.size) return new Map<string, { id: string; title: string; status: string; kind: string }>();
  const quests = await getSystemQuestStore().listByUser(userId);
  const map = new Map<string, { id: string; title: string; status: string; kind: string }>();
  for (const quest of quests) {
    if (!wanted.has(quest.id)) continue;
    map.set(quest.id, {
      id: quest.id,
      title: quest.title,
      status: quest.status,
      kind: quest.kind,
    });
  }
  return map;
}

async function equippedSlugs(userId: string): Promise<Set<string>> {
  try {
    const profile = await getDataService().getCharacterProfile(userId);
    const ids = (profile?.rpg_stats as { equipped_armor?: string[] } | undefined)?.equipped_armor ?? [];
    return new Set(ids);
  } catch (err) {
    console.error('[INVENTORY] equipped armor overlay failed:', err instanceof Error ? err.message : err);
    return new Set();
  }
}

function withEquipped(item: InventoryRecord, equipped: Set<string>): InventoryRecord {
  if (!equipped.has(item.id)) return item;
  return { ...item, equipped: true };
}

export async function listInventory(userId: string): Promise<InventoryItemView[]> {
  const store = getInventoryStore();
  await store.ensureDefaults(userId);
  const [items, equipped] = await Promise.all([store.list(userId), equippedSlugs(userId)]);
  const quests = await questSummaries(userId, items.map(item => item.acquisitionQuestId ?? ''));
  return items
    .map(item => withEquipped(item, equipped))
    .map(item => toInventoryView(item, item.acquisitionQuestId ? quests.get(item.acquisitionQuestId) ?? null : null));
}

export async function createInventoryItem(userId: string, body: Record<string, unknown>): Promise<InventoryItemView> {
  const draft = normalizeNewItem(body);
  try {
    const saved = await getInventoryStore().insert(userId, draft);
    return toInventoryView(saved, null);
  } catch (err) {
    if (isUnique(err)) {
      throw new InventoryError('duplicate_item', `An item with id ${draft.id} already exists`, 409);
    }
    throw err;
  }
}

export async function updateInventoryItem(
  userId: string,
  slug: string,
  body: Record<string, unknown>,
): Promise<InventoryItemView> {
  const store = getInventoryStore();
  const existing = await store.findBySlug(userId, slug);
  if (!existing) throw new InventoryError('not_found', 'Inventory item not found', 404);
  const next = applyItemPatch(existing, body);
  next.updatedAt = new Date().toISOString();
  const saved = await store.update(next);
  const quests = await questSummaries(userId, saved.acquisitionQuestId ? [saved.acquisitionQuestId] : []);
  return toInventoryView(saved, saved.acquisitionQuestId ? quests.get(saved.acquisitionQuestId) ?? null : null);
}

/** Called when an acquisition quest is cleared. Idempotent. Does not award XP. */
export async function markInventoryItemStocked(userId: string, rowId: string): Promise<void> {
  const store = getInventoryStore();
  const item = await store.findByRowId(userId, rowId);
  if (!item) {
    console.error(`[INVENTORY] cleared quest linked to missing item ${rowId}`);
    return;
  }
  if (item.stockStatus === 'stocked') return;
  item.stockStatus = 'stocked';
  item.updatedAt = new Date().toISOString();
  await store.update(item);
}

export async function linkInventoryItemToQuest(userId: string, rowId: string, questId: string | null): Promise<void> {
  const store = getInventoryStore();
  const item = await store.findByRowId(userId, rowId);
  if (!item) throw new InventoryError('not_found', 'Linked inventory item was not found', 404);
  item.acquisitionQuestId = questId;
  item.updatedAt = new Date().toISOString();
  await store.update(item);
}

export async function unlinkInventoryQuest(userId: string, questId: string): Promise<void> {
  const store = getInventoryStore();
  const items = await store.list(userId);
  const linked = items.find(item => item.acquisitionQuestId === questId);
  if (!linked) return;
  linked.acquisitionQuestId = null;
  linked.updatedAt = new Date().toISOString();
  await store.update(linked);
}

/** Best-effort sync from the armor toggle, which still writes rpg_stats.equipped_armor. */
export async function setInventoryEquipped(userId: string, slug: string, equipped: boolean): Promise<void> {
  const store = getInventoryStore();
  const item = await store.findBySlug(userId, slug);
  if (!item || item.equipped === equipped) return;
  item.equipped = equipped;
  item.updatedAt = new Date().toISOString();
  await store.update(item);
}
