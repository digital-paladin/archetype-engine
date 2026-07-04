import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  VaultData,
  VaultEntry,
  GateCriterion,
  RewardTier,
  REWARD_TIERS,
  DEFAULT_GATE_CRITERIA,
  ACM_MAX_SCORE,
  calculateAcmMultiplier,
} from '../models/vault';

// Store vault data alongside other JSON files in the progression folder
const JOURNAL_PATH = process.env.JOURNAL_PATH || '';
const VAULT_FILE: string = process.env.VAULT_PATH ||
  (JOURNAL_PATH ? path.join(path.dirname(JOURNAL_PATH), 'vault.json') : '');

// ── In-memory state ───────────────────────────────────────────────────────────

let vaultData: VaultData | null = null;

// ── Disk I/O ──────────────────────────────────────────────────────────────────

function defaultVault(): VaultData {
  return {
    balance: 0,
    status: 'locked',
    gateCriteria: DEFAULT_GATE_CRITERIA.map(c => ({ ...c, met: false })),
    entries: [],
    lastUpdated: new Date().toISOString(),
  };
}

function loadFromDisk(): void {
  if (!VAULT_FILE) {
    vaultData = defaultVault();
    return;
  }
  try {
    if (fs.existsSync(VAULT_FILE)) {
      const parsed: VaultData = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8'));
      vaultData = parsed;
      console.log(`[VAULT] ✅ Loaded vault — balance: $${parsed.balance.toFixed(2)}, status: ${parsed.status}`);
    } else {
      vaultData = defaultVault();
      console.log('[VAULT] No vault file found — initializing fresh vault');
    }
  } catch (err) {
    console.warn(`[VAULT] Could not load from disk: ${err instanceof Error ? err.message : err}`);
    vaultData = defaultVault();
  }
}

function saveToDisk(): void {
  if (!VAULT_FILE || !vaultData) return;
  try {
    fs.mkdirSync(path.dirname(VAULT_FILE), { recursive: true });
    vaultData.lastUpdated = new Date().toISOString();
    fs.writeFileSync(VAULT_FILE, JSON.stringify(vaultData, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[VAULT] Could not save to disk: ${err instanceof Error ? err.message : err}`);
  }
}

loadFromDisk();

// ── Helpers ───────────────────────────────────────────────────────────────────

function get(): VaultData {
  if (!vaultData) vaultData = defaultVault();
  return vaultData;
}

function recalculateBalance(): void {
  const v = get();
  v.balance = v.entries.reduce((sum, e) => sum + e.totalAmount, 0);
}

function checkAutoUnlock(): void {
  const v = get();
  if (v.status === 'locked' && v.gateCriteria.every(c => c.met)) {
    v.status = 'unlocked';
    v.unlockedAt = new Date().toISOString();
    console.log('[VAULT] 🔓 All gate criteria met — Vault UNLOCKED');
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getVault(): VaultData {
  return { ...get(), entries: [...get().entries] };
}

export interface AddEntryPayload {
  milestone: string;
  tier: RewardTier;
  customBaseAmount?: number;  // only used when tier = 'custom'
  tags?: string[];
  performRoll?: boolean;       // override: force a roll regardless of tier
  date?: string;               // override date (defaults to today)
  acmScore?: number;           // weighted ACM score (0–18); applies multiplier to base amount
}

export function addEntry(payload: AddEntryPayload): VaultEntry {
  const v = get();
  const tierDef = REWARD_TIERS[payload.tier];

  const rawBase = payload.tier === 'custom' && payload.customBaseAmount !== undefined
    ? payload.customBaseAmount
    : tierDef.baseAmount;

  // Apply ACM category-weight multiplier to base amount (0.5–1.0×)
  let acmMultiplier: number | undefined;
  let baseAmount: number;
  if (payload.acmScore !== undefined) {
    acmMultiplier = calculateAcmMultiplier(payload.acmScore);
    baseAmount = Math.round(rawBase * acmMultiplier * 100) / 100;
  } else {
    baseAmount = rawBase;
  }

  let diceRoll: number | undefined;
  let diceSides: number | undefined;
  let bonusAmount = 0;

  // Perform dice roll if tier includes one (or caller forces it)
  const shouldRoll = payload.performRoll ?? (tierDef.diceSides !== null);
  if (shouldRoll && tierDef.diceSides) {
    diceSides = tierDef.diceSides;
    diceRoll = Math.floor(Math.random() * diceSides) + 1;
    if (diceRoll === diceSides) {
      // Max roll: earn the bonus (applied to post-multiplier base)
      bonusAmount = Math.round(baseAmount * tierDef.bonusMultiplier * 100) / 100;
    }
  }

  const entry: VaultEntry = {
    id: randomUUID(),
    date: payload.date || new Date().toISOString().split('T')[0],
    milestone: payload.milestone,
    tier: payload.tier,
    baseAmount,
    bonusAmount,
    totalAmount: baseAmount + bonusAmount,
    diceRoll,
    diceSides,
    tags: payload.tags || [],
    ...(payload.acmScore !== undefined && {
      acmScore: payload.acmScore,
      acmMaxScore: ACM_MAX_SCORE,
      acmMultiplier,
    }),
  };

  v.entries.unshift(entry);  // newest first
  recalculateBalance();
  saveToDisk();
  return entry;
}

export function removeEntry(id: string): boolean {
  const v = get();
  const before = v.entries.length;
  v.entries = v.entries.filter(e => e.id !== id);
  if (v.entries.length === before) return false;
  recalculateBalance();
  saveToDisk();
  return true;
}

export function toggleSoFiRealized(entryId: string): VaultEntry | null {
  const v = get();
  const entry = v.entries.find(e => e.id === entryId);
  if (!entry) return null;
  entry.realizedInSoFi = !entry.realizedInSoFi;
  saveToDisk();
  return { ...entry };
}

export function toggleGateCriterion(criterionId: string): GateCriterion | null {
  const v = get();
  const criterion = v.gateCriteria.find(c => c.id === criterionId);
  if (!criterion) return null;

  criterion.met = !criterion.met;
  criterion.metAt = criterion.met ? new Date().toISOString() : undefined;

  checkAutoUnlock();
  saveToDisk();
  return { ...criterion };
}

export function setVaultStatus(status: 'locked' | 'unlocked'): VaultData {
  const v = get();
  v.status = status;
  if (status === 'unlocked') v.unlockedAt = new Date().toISOString();
  saveToDisk();
  return getVault();
}

/** Simulate a dice roll without adding an entry — used for "preview" UI */
export function simulateRoll(sides: 6 | 12): { roll: number; isMax: boolean } {
  const roll = Math.floor(Math.random() * sides) + 1;
  return { roll, isMax: roll === sides };
}
