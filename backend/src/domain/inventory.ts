/**
 * Inventory item shape and create/update validation.
 * Persistence lives in inventory.store. XP is never derived from an item or its cost.
 */

import {
  INVENTORY_DEFAULTS,
  InventoryCategory,
  InventoryDefault,
  InventoryItemType,
  ItemPriority,
  StockStatus,
} from './inventoryDefaults';

export const INVENTORY_CATEGORIES = [
  'steel-supplement',
  'recovery-gear',
  'armor',
  'weapon',
  'mount',
  'tech-hardware',
  'survivalist',
] as const;

export const STOCK_STATUSES = ['stocked', 'low', 'needed'] as const;
export const ITEM_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const ITEM_TYPES = ['consumable', 'equipment'] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class InventoryError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface InventoryRecord {
  rowId: string;
  userId: string;
  /** Stable slug. Matches equipped_armor ids and the old frontend item ids. */
  id: string;
  name: string;
  type: InventoryItemType;
  category: InventoryCategory;
  icon: string;
  unit: string;
  description: string;
  equipped: boolean;
  level: number | null;
  stockStatus: StockStatus | null;
  monthlyCost: string | null;
  priority: ItemPriority | null;
  acquisitionQuestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryQuestSummary {
  id: string;
  title: string;
  status: string;
  kind: string;
}

/** Wire shape. `id` stays the slug so existing equip calls keep working. */
export interface InventoryItemView {
  id: string;
  rowId: string;
  name: string;
  type: InventoryItemType;
  category: InventoryCategory;
  icon: string;
  unit: string;
  description: string;
  equipped: boolean;
  level: number | null;
  stockStatus: StockStatus | null;
  monthlyCost: string | null;
  priority: ItemPriority | null;
  acquisitionQuestId: string | null;
  acquisitionQuest: InventoryQuestSummary | null;
}

export interface NewInventoryItem {
  id: string;
  name: string;
  type: InventoryItemType;
  category: InventoryCategory;
  icon: string;
  unit: string;
  description: string;
  equipped: boolean;
  level: number | null;
  stockStatus: StockStatus | null;
  monthlyCost: string | null;
  priority: ItemPriority | null;
}

export function toInventoryView(item: InventoryRecord, quest: InventoryQuestSummary | null): InventoryItemView {
  return {
    id: item.id,
    rowId: item.rowId,
    name: item.name,
    type: item.type,
    category: item.category,
    icon: item.icon,
    unit: item.unit,
    description: item.description,
    equipped: item.equipped,
    level: item.level,
    stockStatus: item.stockStatus,
    monthlyCost: item.monthlyCost,
    priority: item.priority,
    acquisitionQuestId: item.acquisitionQuestId,
    acquisitionQuest: quest,
  };
}

export function defaultToDraft(item: InventoryDefault): NewInventoryItem {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    category: item.category,
    icon: item.icon,
    unit: item.unit,
    description: item.description,
    equipped: item.equipped === true,
    level: item.level ?? null,
    stockStatus: item.stockStatus ?? null,
    monthlyCost: item.monthlyCost ?? null,
    priority: item.priority ?? null,
  };
}

export function catalogDrafts(): NewInventoryItem[] {
  return INVENTORY_DEFAULTS.map(defaultToDraft);
}

function requireSlug(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SLUG.test(value) || value.length > 80) {
    throw new InventoryError('invalid_item', `${field} must be a lowercase slug (letters, numbers, hyphens)`, 400);
  }
  return value;
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InventoryError('invalid_item', `${field} is required`, 400);
  }
  return value.trim().slice(0, max);
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new InventoryError('invalid_item', `${field} must be a string`, 400);
  return value.trim().slice(0, max) || null;
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new InventoryError('invalid_item', `${field} must be one of ${allowed.join(', ')}`, 400);
  }
  return value as T;
}

export function normalizeNewItem(body: Record<string, unknown>): NewInventoryItem {
  if ('acquisitionQuestId' in body || 'xp' in body || 'xpReward' in body) {
    throw new InventoryError('invalid_item', 'Items do not grant XP and cannot set a quest link directly', 400);
  }
  const slug = body.id != null ? requireSlug(body.id, 'id') : requireSlug(body.slug, 'slug');
  if (body.slug != null && body.id != null && body.slug !== body.id) {
    throw new InventoryError('invalid_item', 'id and slug must match', 400);
  }
  const level = body.level == null || body.level === ''
    ? null
    : body.level;
  if (level != null && (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 100)) {
    throw new InventoryError('invalid_item', 'level must be an integer from 0 to 100', 400);
  }
  return {
    id: slug,
    name: requireText(body.name, 'name', 200),
    type: oneOf(body.type, 'type', ITEM_TYPES),
    category: oneOf(body.category, 'category', INVENTORY_CATEGORIES),
    icon: requireText(body.icon ?? '📦', 'icon', 16),
    unit: requireText(body.unit ?? 'piece', 'unit', 40),
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : '',
    equipped: body.equipped === true,
    level,
    stockStatus: body.stockStatus == null || body.stockStatus === ''
      ? null
      : oneOf(body.stockStatus, 'stockStatus', STOCK_STATUSES),
    monthlyCost: optionalText(body.monthlyCost, 'monthlyCost', 80),
    priority: body.priority == null || body.priority === ''
      ? null
      : oneOf(body.priority, 'priority', ITEM_PRIORITIES),
  };
}

const ITEM_PATCH_FIELDS = new Set([
  'name',
  'description',
  'icon',
  'unit',
  'type',
  'category',
  'equipped',
  'level',
  'stockStatus',
  'monthlyCost',
  'priority',
]);

export function applyItemPatch(item: InventoryRecord, body: Record<string, unknown>): InventoryRecord {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InventoryError('invalid_item', 'body must be an object', 400);
  }
  for (const key of Object.keys(body)) {
    if (!ITEM_PATCH_FIELDS.has(key)) {
      throw new InventoryError('invalid_item', `${key} cannot be changed on an inventory item`, 400);
    }
  }
  const next: InventoryRecord = { ...item };
  if ('name' in body) next.name = requireText(body.name, 'name', 200);
  if ('description' in body) {
    if (typeof body.description !== 'string') throw new InventoryError('invalid_item', 'description must be a string', 400);
    next.description = body.description.trim().slice(0, 4000);
  }
  if ('icon' in body) next.icon = requireText(body.icon, 'icon', 16);
  if ('unit' in body) next.unit = requireText(body.unit, 'unit', 40);
  if ('type' in body) next.type = oneOf(body.type, 'type', ITEM_TYPES);
  if ('category' in body) next.category = oneOf(body.category, 'category', INVENTORY_CATEGORIES);
  if ('equipped' in body) {
    if (typeof body.equipped !== 'boolean') throw new InventoryError('invalid_item', 'equipped must be a boolean', 400);
    next.equipped = body.equipped;
  }
  if ('level' in body) {
    if (body.level == null) next.level = null;
    else if (typeof body.level !== 'number' || !Number.isInteger(body.level) || body.level < 0 || body.level > 100) {
      throw new InventoryError('invalid_item', 'level must be an integer from 0 to 100', 400);
    } else next.level = body.level;
  }
  if ('stockStatus' in body) {
    next.stockStatus = body.stockStatus == null || body.stockStatus === ''
      ? null
      : oneOf(body.stockStatus, 'stockStatus', STOCK_STATUSES);
  }
  if ('monthlyCost' in body) next.monthlyCost = optionalText(body.monthlyCost, 'monthlyCost', 80);
  if ('priority' in body) {
    next.priority = body.priority == null || body.priority === ''
      ? null
      : oneOf(body.priority, 'priority', ITEM_PRIORITIES);
  }
  return next;
}
