import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  CatalogData,
  CatalogItem,
  PrizeCategory,
  FundingSource,
  PrizeStatus,
  DEFAULT_CATALOG_ITEMS,
} from '../models/rewardsCatalog';

const JOURNAL_PATH = process.env.JOURNAL_PATH || '';
const CATALOG_FILE: string = process.env.REWARDS_CATALOG_PATH ||
  (JOURNAL_PATH ? path.join(path.dirname(JOURNAL_PATH), 'rewards-catalog.json') : '');

// ── In-memory state ───────────────────────────────────────────────────────────

let catalogData: CatalogData | null = null;

// ── Disk I/O ──────────────────────────────────────────────────────────────────

function defaultCatalog(): CatalogData {
  return {
    items: DEFAULT_CATALOG_ITEMS.map(item => ({
      ...item,
      id: randomUUID(),
      status: 'available' as PrizeStatus,
    })),
    profitPool: {
      allocationPct: 10,
      balance: 0,
      totalDeposited: 0,
    },
    lastUpdated: new Date().toISOString(),
  };
}

function loadFromDisk(): void {
  if (!CATALOG_FILE) {
    catalogData = defaultCatalog();
    return;
  }
  try {
    if (fs.existsSync(CATALOG_FILE)) {
      catalogData = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf-8')) as CatalogData;
      console.log(`[REWARDS] ✅ Loaded catalog — ${catalogData.items.length} items, profit pool: $${catalogData.profitPool.balance.toFixed(2)}`);
    } else {
      catalogData = defaultCatalog();
      console.log('[REWARDS] No catalog file found — initializing with default prizes');
    }
  } catch (err) {
    console.warn(`[REWARDS] Could not load from disk: ${err instanceof Error ? err.message : err}`);
    catalogData = defaultCatalog();
  }
}

function saveToDisk(): void {
  if (!CATALOG_FILE || !catalogData) return;
  try {
    fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
    catalogData.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalogData, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[REWARDS] Could not save to disk: ${err instanceof Error ? err.message : err}`);
  }
}

loadFromDisk();

// ── Helpers ───────────────────────────────────────────────────────────────────

function get(): CatalogData {
  if (!catalogData) catalogData = defaultCatalog();
  return catalogData;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getCatalog(): CatalogData {
  return { ...get(), items: [...get().items] };
}

export interface AddItemPayload {
  name: string;
  description?: string;
  category: PrizeCategory;
  estimatedValue: number;
  fundingSource: FundingSource;
  minBalance: number;
  notes?: string;
  tags?: string[];
  diceSides?: number | null;
  diceThreshold?: number | null;
}

export function addItem(payload: AddItemPayload): CatalogItem {
  const d = get();
  const item: CatalogItem = {
    id: randomUUID(),
    name: payload.name,
    description: payload.description || '',
    category: payload.category,
    estimatedValue: payload.estimatedValue,
    fundingSource: payload.fundingSource,
    minBalance: payload.minBalance,
    status: 'available',
    notes: payload.notes,
    tags: payload.tags || [],
    diceSides: payload.diceSides ?? null,
    diceThreshold: payload.diceThreshold ?? null,
  };
  d.items.unshift(item);
  saveToDisk();
  return item;
}

export function removeItem(id: string): boolean {
  const d = get();
  const before = d.items.length;
  d.items = d.items.filter(i => i.id !== id);
  if (d.items.length === before) return false;
  saveToDisk();
  return true;
}

/** Roll the dice for a mystery-box item. Returns roll result. Updates item if roll >= threshold. */
export function rollForItem(id: string): { roll: number; sides: number; threshold: number; won: boolean; item: CatalogItem } | null {
  const d = get();
  const item = d.items.find(i => i.id === id);
  if (!item || !item.diceSides || item.diceThreshold == null) return null;

  const roll = Math.floor(Math.random() * item.diceSides) + 1;
  const won = roll >= item.diceThreshold;

  item.lastRollResult = roll;
  item.lastRollDate = new Date().toISOString();
  if (won) {
    item.status = 'pending-purchase';
    item.claimedAt = new Date().toISOString();
  }

  saveToDisk();
  return { roll, sides: item.diceSides, threshold: item.diceThreshold, won, item: { ...item } };
}

/** Move item to pending-purchase (direct claim, no dice). */
export function claimItem(id: string): CatalogItem | null {
  const d = get();
  const item = d.items.find(i => i.id === id);
  if (!item) return null;
  item.status = 'pending-purchase';
  item.claimedAt = new Date().toISOString();
  saveToDisk();
  return { ...item };
}

/** Mark item as physically purchased/realized. */
export function toggleRealized(id: string): CatalogItem | null {
  const d = get();
  const item = d.items.find(i => i.id === id);
  if (!item) return null;
  item.realizedPurchase = !item.realizedPurchase;
  if (item.realizedPurchase) item.status = 'claimed';
  saveToDisk();
  return { ...item };
}

/** Reset item back to available (undo claim). */
export function resetItem(id: string): CatalogItem | null {
  const d = get();
  const item = d.items.find(i => i.id === id);
  if (!item) return null;
  item.status = 'available';
  item.claimedAt = undefined;
  item.realizedPurchase = false;
  item.lastRollResult = null;
  item.lastRollDate = null;
  saveToDisk();
  return { ...item };
}

export interface UpdateProfitPoolPayload {
  allocationPct?: number;
  depositAmount?: number;
}

/** Update profit pool: adjust allocation % and/or deposit new trading profits. */
export function updateProfitPool(payload: UpdateProfitPoolPayload): CatalogData {
  const d = get();
  if (payload.allocationPct !== undefined) {
    d.profitPool.allocationPct = Math.max(1, Math.min(50, payload.allocationPct));
  }
  if (payload.depositAmount !== undefined && payload.depositAmount > 0) {
    d.profitPool.balance += payload.depositAmount;
    d.profitPool.totalDeposited += payload.depositAmount;
    d.profitPool.lastDepositDate = new Date().toISOString();
    d.profitPool.lastDepositAmount = payload.depositAmount;
  }
  saveToDisk();
  return getCatalog();
}
