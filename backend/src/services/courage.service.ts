/**
 * Courage Service
 * Manages persistence and XP math for the Courage stat.
 *
 * Persistence: courage-data.json — stored alongside vault.json / activity-log.json
 * in the same Railway volume directory derived from JOURNAL_PATH.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  CourageData,
  CourageMilestone,
  CourageFlagEntry,
  CourageStat,
  CourageTier,
  CourageActivityProgress,
} from '../models/courage.model';

// ── File path ─────────────────────────────────────────────────────────────────

const JOURNAL_PATH = process.env.JOURNAL_PATH || '';
const COURAGE_FILE: string =
  process.env.COURAGE_PATH ||
  (JOURNAL_PATH ? path.join(path.dirname(JOURNAL_PATH), 'courage-data.json') : '');

// ── Level / XP config ─────────────────────────────────────────────────────────

/** XP required to START each level (index = level - 1) */
const LEVEL_THRESHOLDS = [0, 50, 150, 300, 550, 850, 1250] as const;
const TIERS: CourageTier[] = [
  'Timid', 'Hesitant', 'Brave', 'Courageous', 'Bold', 'Fearless', 'Legendary',
];

/** Activities that automatically earn new-domain courage bonus on each session. */
export const ELIGIBLE_ACTIVITIES: Record<string, { displayName: string; domain: string }> = {
  'workout-swimming':  { displayName: 'Swimming',          domain: 'Water'   },
  'workout-climbing':  { displayName: 'Rock Climbing',     domain: 'Heights' },
  'workout-mma':       { displayName: 'MMA / Sparring',    domain: 'Combat'  },
  'workout-firearms':  { displayName: 'Firearms Training', domain: 'Weapons' },
  'medical-procedure': { displayName: 'Medical Procedure', domain: 'Medical' },
};

const COURAGE_FLAG_XP = 10; // flat award per flagged activity (1× per day)

// ── In-memory state ───────────────────────────────────────────────────────────

let data: CourageData | null = null;

function defaultData(): CourageData {
  return {
    totalXP: 0,
    milestones: [],
    sessionCounts: {},
    flagLog: [],
    lastUpdated: new Date().toISOString(),
  };
}

// ── Disk I/O ──────────────────────────────────────────────────────────────────

function loadFromDisk(): void {
  if (!COURAGE_FILE) {
    data = defaultData();
    return;
  }
  try {
    if (fs.existsSync(COURAGE_FILE)) {
      data = JSON.parse(fs.readFileSync(COURAGE_FILE, 'utf-8'));
      console.log(`[COURAGE] ✅ Loaded — totalXP: ${data!.totalXP}, milestones: ${data!.milestones.length}`);
    } else {
      data = defaultData();
      console.log('[COURAGE] No file found — initializing fresh data');
    }
  } catch (err) {
    console.warn(`[COURAGE] Load failed: ${err instanceof Error ? err.message : err}`);
    data = defaultData();
  }
}

function saveToDisk(): void {
  if (!COURAGE_FILE || !data) return;
  try {
    fs.mkdirSync(path.dirname(COURAGE_FILE), { recursive: true });
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(COURAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[COURAGE] Save failed: ${err instanceof Error ? err.message : err}`);
  }
}

loadFromDisk();

// ── XP helpers ────────────────────────────────────────────────────────────────

/** Session-based new-domain XP. Tapers to 0 after session 25 (fear conquered). */
function sessionXP(sessionNumber: number): number {
  if (sessionNumber <= 5)  return 8;
  if (sessionNumber <= 15) return 4;
  if (sessionNumber <= 25) return 2;
  return 0;
}

function computeLevel(xp: number): {
  level: number;
  tier: CourageTier;
  xpToNextLevel: number;
  percentToNext: number;
} {
  const maxLevel = LEVEL_THRESHOLDS.length;
  let level = 1;
  for (let i = maxLevel - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) { level = i + 1; break; }
  }
  level = Math.min(level, maxLevel);
  const tier = TIERS[level - 1];
  const isMax = level >= maxLevel;
  const levelStart = LEVEL_THRESHOLDS[level - 1];
  const levelEnd   = isMax ? xp : LEVEL_THRESHOLDS[level];
  const xpToNextLevel = isMax ? 0 : levelEnd - xp;
  const percentToNext = isMax
    ? 100
    : Math.round(((xp - levelStart) / (levelEnd - levelStart)) * 100);
  return { level, tier, xpToNextLevel: Math.max(0, xpToNextLevel), percentToNext };
}

function activityStatus(count: number): CourageActivityProgress['status'] {
  if (count >= 26) return 'conquered';
  if (count >= 16) return 'normalizing';
  return 'active';
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Full computed view model for the frontend. */
export function getCourageStat(): CourageStat {
  if (!data) loadFromDisk();
  const d = data!;
  const { level, tier, xpToNextLevel, percentToNext } = computeLevel(d.totalXP);

  const activityProgress: CourageActivityProgress[] = Object.entries(ELIGIBLE_ACTIVITIES).map(
    ([type, meta]) => {
      const count = d.sessionCounts[type] ?? 0;
      let earned = 0;
      for (let s = 1; s <= count; s++) earned += sessionXP(s);
      return {
        activityType: type,
        displayName: meta.displayName,
        domain: meta.domain,
        sessionCount: count,
        courageXPEarned: earned,
        status: activityStatus(count),
      };
    }
  );

  return {
    totalXP: d.totalXP,
    level,
    tier,
    xpToNextLevel,
    percentToNext,
    milestones: d.milestones,
    activityProgress,
    recentFlags: d.flagLog.slice(-10).reverse(),
  };
}

/**
 * Auto-called by activity.routes when an eligible activityType is posted.
 * Increments session count and awards tapering new-domain bonus XP.
 * Returns XP awarded (0 if conquered or not eligible).
 */
export function recordActivitySession(activityType: string): number {
  if (!data) loadFromDisk();
  if (!(activityType in ELIGIBLE_ACTIVITIES)) return 0;

  const prev  = data!.sessionCounts[activityType] ?? 0;
  const next  = prev + 1;
  const xp    = sessionXP(next);

  data!.sessionCounts[activityType] = next;
  if (xp > 0) {
    data!.totalXP += xp;
    console.log(`[COURAGE] Session bonus — ${activityType} session #${next}: +${xp} XP`);
  } else {
    console.log(`[COURAGE] ${activityType} session #${next}: domain conquered, no bonus`);
  }
  saveToDisk();
  return xp;
}

/**
 * Apply the manual courage-flag bonus (+10 XP, capped 1× per calendar day).
 * Returns XP awarded (0 if already flagged today).
 */
export function applyCourageFlag(activityType: string, note?: string): number {
  if (!data) loadFromDisk();
  const today = new Date().toLocaleDateString('en-CA');
  if (data!.lastFlagDate === today) {
    console.log(`[COURAGE] Flag already awarded today (${today}) — skipping`);
    return 0;
  }
  const entry: CourageFlagEntry = {
    id: randomUUID(),
    date: today,
    activityType,
    xp: COURAGE_FLAG_XP,
    note,
  };
  data!.flagLog.push(entry);
  data!.totalXP += COURAGE_FLAG_XP;
  data!.lastFlagDate = today;
  console.log(`[COURAGE] Flag XP — ${activityType}: +${COURAGE_FLAG_XP} XP`);
  saveToDisk();
  return COURAGE_FLAG_XP;
}

/** Add a one-time fear-conquest milestone and award its XP. */
export function addMilestone(
  title: string,
  domain: string,
  date: string,
  xp: number,
  notes?: string
): CourageMilestone {
  if (!data) loadFromDisk();
  const milestone: CourageMilestone = { id: randomUUID(), title, domain, date, xp, notes };
  data!.milestones.push(milestone);
  data!.totalXP += xp;
  console.log(`[COURAGE] Milestone — "${title}" (+${xp} XP). Total: ${data!.totalXP}`);
  saveToDisk();
  return milestone;
}

/** Remove a milestone by ID (deducts its XP from the total). */
export function removeMilestone(id: string): boolean {
  if (!data) loadFromDisk();
  const idx = data!.milestones.findIndex(m => m.id === id);
  if (idx === -1) return false;
  data!.totalXP = Math.max(0, data!.totalXP - data!.milestones[idx].xp);
  data!.milestones.splice(idx, 1);
  saveToDisk();
  return true;
}

/**
 * Preview: what XP would be awarded if this activityType were posted right now?
 * Used by the frontend to show the user what they'd earn before confirming.
 */
export function previewSessionXP(activityType: string): {
  eligible: boolean;
  sessionNumber: number;
  xp: number;
} {
  if (!data) loadFromDisk();
  if (!(activityType in ELIGIBLE_ACTIVITIES)) return { eligible: false, sessionNumber: 0, xp: 0 };
  const next = (data!.sessionCounts[activityType] ?? 0) + 1;
  return { eligible: true, sessionNumber: next, xp: sessionXP(next) };
}
