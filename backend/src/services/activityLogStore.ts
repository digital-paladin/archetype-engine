/**
 * In-process activity feed.
 * Both /api/activities (skills/combos) and /api/consume (food/water) push entries here
 * so the live socket event and same-process feed stay in sync.
 *
 * GET /api/activities reads the persistent Supabase `activity_log` (see activity.routes).
 * This module is not that store: the optional activity-log.json snapshot only reloads
 * today's entries and is empty when ACTIVITY_LOG_PATH / JOURNAL_PATH are unset, which
 * is why a process restart used to make GET look empty while character_stats survived.
 */

import fs from 'fs';
import path from 'path';

// Derive log file path from the journal's directory (both live on the same Railway volume)
const JOURNAL_PATH = process.env.JOURNAL_PATH || '';
const LOG_FILE: string = process.env.ACTIVITY_LOG_PATH ||
  (JOURNAL_PATH ? path.join(path.dirname(JOURNAL_PATH), 'activity-log.json') : '');

export interface LogEntry {
  id: number | string;
  activityType: string;
  xp: number;
  duration?: number;
  notes?: string;
  category?: string;
  source: 'skill' | 'combo' | 'consume' | 'water';
  timestamp: string;
  /** UTC calendar day of `timestamp` — the day per-day XP attributes this row to. */
  date?: string;
  /** Set to true when the user flagged this as a fear-override moment (+10 Courage XP, 1×/day) */
  courageFlag?: boolean;
  courageNote?: string;
  /** Courage XP awarded for this entry (session bonus + flag bonus combined) */
  courageXPAwarded?: number;
}

const MAX_ENTRIES = 200;
let entries: LogEntry[] = [];
let nextId = 1;

// ── Seed from disk on startup ──────────────────────────────────────────────
function loadFromDisk(): void {
  if (!LOG_FILE) return;
  try {
    if (fs.existsSync(LOG_FILE)) {
      const parsed: LogEntry[] = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
      if (Array.isArray(parsed) && parsed.length) {
        // Keep only today's entries so the feed stays relevant across server restarts
        const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
        entries = parsed.filter(e => new Date(e.timestamp).toLocaleDateString('en-CA') === today);
        const numericIds = entries
          .map(entry => entry.id)
          .filter((id): id is number => typeof id === 'number');
        nextId = numericIds.length ? Math.max(...numericIds) + 1 : 1;
        console.log(`[ACTIVITY LOG] ✅ Loaded ${entries.length} today's entries from disk`);
      }
    }
  } catch (err) {
    console.warn(`[ACTIVITY LOG] Could not load from disk (non-fatal): ${err instanceof Error ? err.message : err}`);
  }
}

// ── Persist to disk (synchronous — file is tiny, called after every push) ─
function saveToDisk(): void {
  if (!LOG_FILE) return;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[ACTIVITY LOG] Could not save to disk (non-fatal): ${err instanceof Error ? err.message : err}`);
  }
}

loadFromDisk();

/** Push a new entry to the front of the log (most-recent-first). Returns the full entry. */
export function pushLog(entry: Omit<LogEntry, 'id' | 'timestamp' | 'date'> & { timestamp?: string }): LogEntry {
  const timestamp = entry.timestamp ?? new Date().toISOString();
  const full: LogEntry = {
    ...entry,
    id: nextId++,
    timestamp,
    date: timestamp.slice(0, 10),
  };
  entries.unshift(full);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  saveToDisk();
  return full;
}

/** Return a snapshot of all entries (most-recent-first). */
export function getLogs(): LogEntry[] {
  return entries.slice();
}

/** Drop the in-process list. Tests only — does not touch activity-log.json. */
export function resetActivityLogForTests(): void {
  entries = [];
  nextId = 1;
}

export interface ActivityFeedSource {
  id?: string | number;
  activity_type: string;
  xp_awarded?: number | string | null;
  duration_hours?: number | string | null;
  notes?: string | null;
  class_name?: string | null;
  logged_at?: string | null;
}

/** Map a persistent activity_log row onto the feed shape GET /api/activities already returns. */
export function toActivityFeedEntry(row: ActivityFeedSource, index: number): LogEntry {
  const activityType = row.activity_type;
  const source: LogEntry['source'] = activityType.startsWith('Combo:') ? 'combo' : 'skill';
  const timestamp = row.logged_at || new Date(0).toISOString();
  const minutes = row.duration_hours == null || row.duration_hours === ''
    ? undefined
    : Math.round(Number(row.duration_hours) * 60);
  const xp = Math.round(Number(row.xp_awarded ?? 0));
  return {
    id: row.id ?? index + 1,
    activityType,
    xp: Number.isFinite(xp) ? xp : 0,
    duration: minutes != null && Number.isFinite(minutes) ? minutes : undefined,
    notes: row.notes || undefined,
    category: row.class_name || undefined,
    source,
    timestamp,
    date: timestamp.slice(0, 10),
  };
}

function feedKey(entry: LogEntry): string {
  return `${entry.timestamp}|${entry.activityType}|${entry.xp}|${entry.notes ?? ''}`;
}

/**
 * Persistent rows win. In-memory entries that are not in the database yet
 * (consume/water, or a skill log whose Supabase write has not flushed)
 * are appended so the live feed does not blink.
 */
export function mergeActivityFeed(persisted: LogEntry[], memory: LogEntry[], limit: number): LogEntry[] {
  const seen = new Set(persisted.map(feedKey));
  const extras = memory.filter(entry => !seen.has(feedKey(entry)));
  return [...persisted, ...extras]
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
    .slice(0, limit);
}
