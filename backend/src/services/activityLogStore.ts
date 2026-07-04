/**
 * Singleton activity log with disk persistence.
 * Both /api/activities (skills/combos) and /api/consume (food/water) push entries here.
 * Available via GET /api/activities — returns most-recent-first.
 *
 * Persistence: entries are saved to activity-log.json (same directory as the journal).
 * On startup, today's entries are re-loaded so the UI feed survives server restarts,
 * Railway redeploys, and browser refreshes/logouts.
 */

import fs from 'fs';
import path from 'path';

// Derive log file path from the journal's directory (both live on the same Railway volume)
const JOURNAL_PATH = process.env.JOURNAL_PATH || '';
const LOG_FILE: string = process.env.ACTIVITY_LOG_PATH ||
  (JOURNAL_PATH ? path.join(path.dirname(JOURNAL_PATH), 'activity-log.json') : '');

export interface LogEntry {
  id: number;
  activityType: string;
  xp: number;
  duration?: number;
  notes?: string;
  category?: string;
  source: 'skill' | 'combo' | 'consume' | 'water';
  timestamp: string;
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
        nextId = entries.length ? Math.max(...entries.map(e => e.id)) + 1 : 1;
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
export function pushLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): LogEntry {
  const full: LogEntry = { ...entry, id: nextId++, timestamp: new Date().toISOString() };
  entries.unshift(full);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  saveToDisk();
  return full;
}

/** Return a snapshot of all entries (most-recent-first). */
export function getLogs(): LogEntry[] {
  return entries.slice();
}
