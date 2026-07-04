/**
 * seed_character_stats.ts
 *
 * Seeds the character_stats Supabase table from the live character-sheet.md.
 * Safe to re-run: uses UPSERT on (user_id, class_name) — overwrites stale data.
 *
 * Run: npx ts-node --transpile-only src/scripts/seed_character_stats.ts
 *
 * Requires these env vars (from backend/.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHARACTER_FILE_PATH
 */

import dotenv from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

dotenv.config({ path: resolve(__dirname, '../../.env') });

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CHAR_SHEET_PATH           = process.env.CHARACTER_FILE_PATH
  || resolve(__dirname, '../../../../../character-progression/character-sheet.md');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[SEED] ❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth:     { persistSession: false },
  global:   { fetch: fetch as any },
  realtime: { transport: WebSocket as any },
});

function log(msg: string) { console.log(`[SEED] ${msg}`); }
function err(label: string, e?: unknown) {
  console.error(`[SEED] ❌  ${label}`, e instanceof Error ? e.message : e ?? '');
}

// ── Class definitions (matches migrate_to_supabase.ts) ────────────────────
interface ClassStat { class_name: string; level: number; current_xp: number; total_xp: number; }

const CLASS_DEFS: Array<{ name: string; levelPattern: RegExp; totalXpPattern: RegExp }> = [
  {
    name: 'Developer',
    levelPattern:   /### Developer[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Developer[^#]+?\*\*Total Career XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Sage',
    levelPattern:   /### Sage[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Sage[^#]+?\*\*Total Spiritual XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Warrior',
    levelPattern:   /### Warrior[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Warrior[^#]+?\*\*Total Warrior XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Artist',
    levelPattern:   /### Artist[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Artist[^#]+?\*\*Total Creative XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Redteamer',
    levelPattern:   /### Redteamer[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Redteamer[^#]+?\*\*Total Redteaming XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Financial Strategist',
    levelPattern:   /### Financial Strategist[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Financial Strategist[^#]+?\*\*Total[^X]*XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Survivalist',
    levelPattern:   /### Survivalist[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Survivalist[^#]+?\*\*Total Rest XP:\*\*\s*([\d,]+)/s,
  },
];

function parseClassStats(content: string): ClassStat[] {
  const stats: ClassStat[] = [];

  // Build current_xp map from CURRENT STATS section
  const statsStart   = content.indexOf('[CURRENT-STATS-BEGIN]');
  const statsSection = statsStart >= 0 ? content.slice(statsStart) : content;

  const currentXpMap: Record<string, number> = {};
  const currentXpRe  = /### ([A-Za-z ]+?) \(/g;
  let m: RegExpExecArray | null;

  while ((m = currentXpRe.exec(statsSection)) !== null) {
    const blockEnd = statsSection.indexOf('\n### ', m.index + 5);
    const block    = blockEnd >= 0
      ? statsSection.slice(m.index, blockEnd)
      : statsSection.slice(m.index, m.index + 1500);
    const xpM = block.match(/\*\*Current XP:\*\*\s*([\d,]+)\s*\//);
    if (xpM) currentXpMap[m[1].trim()] = parseInt(xpM[1].replace(/,/g, ''), 10);
  }

  // Override with most-recent values from history log (reverse-chronological — first match wins)
  const histStart = content.indexOf('[HISTORY-LOG-BEGIN]');
  if (histStart >= 0) {
    const histSection  = content.slice(histStart, histStart + 200_000);
    const xpUpdateRe   = /^\s*-\s+\*\*([A-Za-z ]+):\*\*\s+\+\d+\s+XP[^:]+:\s*[\d,]+\s+→\s+\*\*([\d,]+)\*\*/gm;
    const latestMap: Record<string, number> = {};
    let xm: RegExpExecArray | null;
    while ((xm = xpUpdateRe.exec(histSection)) !== null) {
      const cls = xm[1].trim();
      if (!(cls in latestMap)) latestMap[cls] = parseInt(xm[2].replace(/,/g, ''), 10);
    }
    Object.assign(currentXpMap, latestMap);
  }

  for (const def of CLASS_DEFS) {
    const levelM  = def.levelPattern.exec(content);
    const totalM  = def.totalXpPattern.exec(content);
    const level   = levelM ? parseInt(levelM[1], 10) : 1;
    const totalXp = totalM ? parseInt(totalM[1].replace(/,/g, ''), 10) : 0;
    const currXp  = currentXpMap[def.name] ?? 0;
    stats.push({ class_name: def.name, level, current_xp: currXp, total_xp: totalXp });
  }

  return stats;
}

async function getUserId(): Promise<string> {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) throw new Error('OWNER_EMAIL env var is required');
  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw new Error(`listUsers: ${error.message}`);
  const user = data.users.find(u => u.email === ownerEmail);
  if (!user) throw new Error(`User ${ownerEmail} not found in Supabase auth`);
  log(`✅ Found user: ${user.id}`);
  return user.id;
}

async function main() {
  log('Reading character-sheet.md from: ' + CHAR_SHEET_PATH);
  const content = readFileSync(CHAR_SHEET_PATH, 'utf-8');

  const stats = parseClassStats(content);
  log(`Parsed ${stats.length} class stats:`);
  for (const s of stats) log(`  ${s.class_name}: L${s.level} — ${s.current_xp} curr / ${s.total_xp} total`);

  const userId = await getUserId();

  log(`Upserting ${stats.length} rows into character_stats...`);
  for (const s of stats) {
    const { error } = await db
      .from('character_stats')
      .upsert(
        { user_id: userId, ...s, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,class_name' },
      );
    if (error) err(`character_stats[${s.class_name}]`, error);
    else log(`  ✅ ${s.class_name} L${s.level} (${s.current_xp} XP in level, ${s.total_xp} total)`);
  }

  log('Seed complete ✅');
  process.exit(0);
}

main().catch(e => { console.error('[SEED] Fatal:', e); process.exit(1); });
