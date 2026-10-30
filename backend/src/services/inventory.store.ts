import { randomUUID } from 'crypto';
import { InventoryRecord, NewInventoryItem, catalogDrafts } from '../domain/inventory';
import {
  InventoryCategory,
  InventoryItemType,
  ItemPriority,
  StockStatus,
} from '../domain/inventoryDefaults';
import { getSupabaseAdmin } from '../lib/supabase';

export interface InventoryStore {
  list(userId: string): Promise<InventoryRecord[]>;
  findByRowId(userId: string, rowId: string): Promise<InventoryRecord | null>;
  findByRowIds(userId: string, rowIds: string[]): Promise<InventoryRecord[]>;
  findBySlug(userId: string, slug: string): Promise<InventoryRecord | null>;
  /** Insert catalog rows the user does not already have. Does not overwrite edits. */
  ensureDefaults(userId: string): Promise<void>;
  insert(userId: string, item: NewInventoryItem): Promise<InventoryRecord>;
  update(item: InventoryRecord): Promise<InventoryRecord>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryInventoryStore implements InventoryStore {
  private items: InventoryRecord[] = [];

  async list(userId: string): Promise<InventoryRecord[]> {
    return this.items.filter(item => item.userId === userId).map(item => clone(item));
  }

  async findByRowId(userId: string, rowId: string): Promise<InventoryRecord | null> {
    return clone(this.items.find(item => item.userId === userId && item.rowId === rowId) ?? null);
  }

  async findByRowIds(userId: string, rowIds: string[]): Promise<InventoryRecord[]> {
    const wanted = new Set(rowIds);
    return this.items.filter(item => item.userId === userId && wanted.has(item.rowId)).map(item => clone(item));
  }

  async findBySlug(userId: string, slug: string): Promise<InventoryRecord | null> {
    return clone(this.items.find(item => item.userId === userId && item.id === slug) ?? null);
  }

  async ensureDefaults(userId: string): Promise<void> {
    const have = new Set(this.items.filter(item => item.userId === userId).map(item => item.id));
    for (const draft of catalogDrafts()) {
      if (have.has(draft.id)) continue;
      await this.insert(userId, draft);
    }
  }

  async insert(userId: string, item: NewInventoryItem): Promise<InventoryRecord> {
    if (this.items.some(row => row.userId === userId && row.id === item.id)) {
      const err = new Error('duplicate key') as Error & { code: string };
      err.code = '23505';
      throw err;
    }
    const now = new Date().toISOString();
    const record: InventoryRecord = {
      rowId: randomUUID(),
      userId,
      id: item.id,
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
      acquisitionQuestId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(clone(record));
    return clone(record);
  }

  async update(item: InventoryRecord): Promise<InventoryRecord> {
    const idx = this.items.findIndex(row => row.userId === item.userId && row.rowId === item.rowId);
    if (idx < 0) throw new Error('inventory item not found');
    this.items[idx] = clone(item);
    return clone(item);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

function rowToItem(row: Record<string, unknown>): InventoryRecord {
  return {
    rowId: String(row.id),
    userId: String(row.user_id),
    id: String(row.slug),
    name: String(row.name ?? ''),
    type: row.type as InventoryItemType,
    category: row.category as InventoryCategory,
    icon: String(row.icon ?? '📦'),
    unit: String(row.unit ?? 'piece'),
    description: String(row.description ?? ''),
    equipped: row.equipped === true,
    level: row.level_requirement == null ? null : Number(row.level_requirement),
    stockStatus: (row.stock_status as StockStatus | null) ?? null,
    monthlyCost: row.monthly_cost ? String(row.monthly_cost) : null,
    priority: (row.priority as ItemPriority | null) ?? null,
    acquisitionQuestId: row.acquisition_quest_id ? String(row.acquisition_quest_id) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function itemToRow(item: InventoryRecord): Record<string, unknown> {
  return {
    id: item.rowId,
    user_id: item.userId,
    slug: item.id,
    name: item.name,
    type: item.type,
    category: item.category,
    icon: item.icon,
    unit: item.unit,
    description: item.description,
    equipped: item.equipped,
    level_requirement: item.level,
    stock_status: item.stockStatus,
    monthly_cost: item.monthlyCost,
    priority: item.priority,
    acquisition_quest_id: item.acquisitionQuestId,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

export class SupabaseInventoryStore implements InventoryStore {
  async list(userId: string): Promise<InventoryRecord[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('inventory_items')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(row => rowToItem(row));
  }

  async findByRowId(userId: string, rowId: string): Promise<InventoryRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('inventory_items')
      .select('*')
      .eq('user_id', userId)
      .eq('id', rowId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToItem(data) : null;
  }

  async findByRowIds(userId: string, rowIds: string[]): Promise<InventoryRecord[]> {
    if (!rowIds.length) return [];
    const { data, error } = await getSupabaseAdmin()
      .from('inventory_items')
      .select('*')
      .eq('user_id', userId)
      .in('id', rowIds);
    if (error) throw error;
    return (data ?? []).map(row => rowToItem(row));
  }

  async findBySlug(userId: string, slug: string): Promise<InventoryRecord | null> {
    const { data, error } = await getSupabaseAdmin()
      .from('inventory_items')
      .select('*')
      .eq('user_id', userId)
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToItem(data) : null;
  }

  async ensureDefaults(userId: string): Promise<void> {
    const existing = await getSupabaseAdmin()
      .from('inventory_items')
      .select('slug')
      .eq('user_id', userId);
    if (existing.error) throw existing.error;
    const have = new Set((existing.data ?? []).map(row => String(row.slug)));

    const defaults = await getSupabaseAdmin().from('inventory_item_defaults').select('*');
    if (defaults.error) throw defaults.error;
    const missing = (defaults.data ?? []).filter(row => !have.has(String(row.id)));
    if (!missing.length) return;

    const now = new Date().toISOString();
    const rows = missing.map(row => ({
      user_id: userId,
      slug: row.id,
      name: row.name,
      type: row.type,
      category: row.category,
      icon: row.icon,
      unit: row.unit,
      description: row.description ?? '',
      equipped: row.equipped === true,
      level_requirement: row.level_requirement ?? null,
      stock_status: row.stock_status ?? null,
      monthly_cost: row.monthly_cost ?? null,
      priority: row.priority ?? null,
      created_at: now,
      updated_at: now,
    }));
    const inserted = await getSupabaseAdmin().from('inventory_items').insert(rows);
    if (inserted.error && !isUniqueViolation(inserted.error)) throw inserted.error;
  }

  async insert(userId: string, item: NewInventoryItem): Promise<InventoryRecord> {
    const now = new Date().toISOString();
    const record: InventoryRecord = {
      rowId: randomUUID(),
      userId,
      id: item.id,
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
      acquisitionQuestId: null,
      createdAt: now,
      updatedAt: now,
    };
    const { data, error } = await getSupabaseAdmin()
      .from('inventory_items')
      .insert(itemToRow(record))
      .select('*')
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const err = new Error(error.message) as Error & { code: string };
        err.code = '23505';
        throw err;
      }
      throw error;
    }
    return rowToItem(data);
  }

  async update(item: InventoryRecord): Promise<InventoryRecord> {
    const { data, error } = await getSupabaseAdmin()
      .from('inventory_items')
      .update(itemToRow(item))
      .eq('user_id', item.userId)
      .eq('id', item.rowId)
      .select('*')
      .single();
    if (error) throw error;
    return rowToItem(data);
  }
}

let store: InventoryStore | null = null;

export function getInventoryStore(): InventoryStore {
  if (!store) store = new SupabaseInventoryStore();
  return store;
}

export function setInventoryStore(next: InventoryStore | null): void {
  store = next;
}
