/**
 * Toggl Track API v9 client for one America/Chicago civil day.
 *
 * Auth is HTTP Basic: the API token is the username and the password is the
 * literal "api_token". The token comes from TOGGL_API_TOKEN. When that env
 * var is unset the integration is disabled and this logs once per process.
 * The token is never written to a URL or a log line.
 *
 * https://engineering.toggl.com/docs/api/time_entries/
 */

import { zoneOffset } from './wearableActivityXp.service';

const TOGGL_TIME_ENTRIES_URL = 'https://api.track.toggl.com/api/v9/me/time_entries';
const TOGGL_FETCH_TIMEOUT_MS = 10_000;

export interface TogglTimeEntry {
  id: string;
  description: string;
  projectName: string | null;
  tags: string[];
  /** UTC ISO start from Toggl. */
  start: string;
  stop: string | null;
  /** Seconds. Negative means the timer is still running. */
  duration: number | null;
}

export function isTogglConfigured(): boolean {
  return Boolean(process.env.TOGGL_API_TOKEN?.trim());
}

let disabledLogged = false;

/** One line when a sync asks for entries and the token is missing. */
export function logTogglDisabledOnce(): void {
  if (disabledLogged) return;
  disabledLogged = true;
  console.info('[TOGGL] TOGGL_API_TOKEN is unset; Sport sessions stay workout-cardio');
}

/** Test hook. Production never resets this. */
export function resetTogglDisabledLog(): void {
  disabledLogged = false;
}

export function redactTogglSecret(message: string): string {
  const token = process.env.TOGGL_API_TOKEN?.trim();
  if (!token) return message;
  return message.split(token).join('[redacted]');
}

/** Next civil date. `2026-10-31` → `2026-11-01`. */
export function nextIsoDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** [start, end) of a Chicago civil day, as RFC3339 instants. */
export function chicagoDayBounds(date: string): { startIso: string; endIso: string; startMs: number; endMs: number } {
  const startOffset = zoneOffset(date, '00:00');
  const startIso = `${date}T00:00:00${startOffset}`;
  const endDate = nextIsoDate(date);
  const endOffset = zoneOffset(endDate, '00:00');
  const endIso = `${endDate}T00:00:00${endOffset}`;
  return {
    startIso,
    endIso,
    startMs: Date.parse(startIso),
    endMs: Date.parse(endIso),
  };
}

export function togglEntryInterval(
  entry: Pick<TogglTimeEntry, 'start' | 'stop' | 'duration'>,
  now: Date,
): { startMs: number; endMs: number } | null {
  const startMs = Date.parse(entry.start);
  if (Number.isNaN(startMs)) return null;
  let endMs: number | null = null;
  if (entry.stop) {
    const parsed = Date.parse(entry.stop);
    if (!Number.isNaN(parsed)) endMs = parsed;
  }
  if (endMs == null && entry.duration != null && entry.duration > 0) {
    endMs = startMs + entry.duration * 1000;
  }
  if (endMs == null && entry.duration != null && entry.duration < 0) {
    endMs = now.getTime();
  }
  if (endMs == null || endMs <= startMs) return null;
  return { startMs, endMs };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseTogglTimeEntry(raw: unknown): TogglTimeEntry | null {
  const row = asRecord(raw);
  if (!row || typeof row.start !== 'string' || !row.start.trim()) return null;
  const nestedProject = asRecord(row.project);
  const projectName = typeof row.project_name === 'string'
    ? row.project_name
    : typeof nestedProject?.name === 'string'
      ? nestedProject.name
      : null;
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const id = row.id == null ? row.start : String(row.id);
  return {
    id,
    description: typeof row.description === 'string' ? row.description : '',
    projectName,
    tags,
    start: row.start,
    stop: typeof row.stop === 'string' ? row.stop : null,
    duration: typeof row.duration === 'number' ? row.duration : null,
  };
}

function entryList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const record = asRecord(body);
  if (record && Array.isArray(record.items)) return record.items;
  throw new Error('Toggl time entries response was not a list');
}

/**
 * Time entries that overlap the Chicago civil day.
 * `start_date` / `end_date` are RFC3339 so a late Chicago evening is not
 * queried as the next UTC date. The response is filtered again locally.
 * Returns [] when the token is unset (and logs that once).
 */
export async function fetchTogglEntriesForChicagoDay(date: string, now = new Date()): Promise<TogglTimeEntry[]> {
  const token = process.env.TOGGL_API_TOKEN?.trim();
  if (!token) {
    logTogglDisabledOnce();
    return [];
  }

  const bounds = chicagoDayBounds(date);
  const url = new URL(TOGGL_TIME_ENTRIES_URL);
  url.searchParams.set('start_date', bounds.startIso);
  url.searchParams.set('end_date', bounds.endIso);
  url.searchParams.set('meta', 'true');

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${token}:api_token`).toString('base64')}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TOGGL_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Toggl time entries request failed: ${redactTogglSecret(message)}`);
  }
  if (!res.ok) {
    throw new Error(`Toggl time entries request failed (${res.status})`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error('Toggl time entries response was not JSON');
  }

  const entries: TogglTimeEntry[] = [];
  for (const raw of entryList(body)) {
    const entry = parseTogglTimeEntry(raw);
    if (!entry) continue;
    const span = togglEntryInterval(entry, now);
    if (!span) continue;
    if (span.startMs < bounds.endMs && span.endMs > bounds.startMs) entries.push(entry);
  }
  return entries;
}
