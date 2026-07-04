/**
 * migrate_to_supabase.ts
 *
 * One-time migration script: reads character-sheet.md + journal snapshot
 * (current-character-state-051726) and seeds all Supabase tables.
 *
 * Run: npx ts-node src/scripts/migrate_to_supabase.ts
 *
 * Requires these env vars (from backend/.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import dotenv from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

dotenv.config({ path: resolve(__dirname, '../../.env') });

const SUPABASE_URL             = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[MIGRATE] ❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch: fetch as any },
  realtime: { transport: WebSocket as any },
});

// ── Snapshot file paths ────────────────────────────────────────────────────
const SNAPSHOT_DIR = resolve(
  __dirname,
  '../../../../character-progression/current-character-state-051726'
);
const CHAR_SHEET = resolve(SNAPSHOT_DIR, 'character-sheet.md');
const JOURNAL    = resolve(SNAPSHOT_DIR, 'daily manual journal compendium(final version).md');

// ── Helpers ────────────────────────────────────────────────────────────────
function log(msg: string) { console.log(`[MIGRATE] ${msg}`); }
function err(msg: string, e?: unknown) {
  console.error(`[MIGRATE] ❌ ${msg}`, e instanceof Error ? e.message : e ?? '');
}

/** Convert "Apr 30, 2026" or "Apr 30 2026" → "2026-04-30" */
function toISODate(monthStr: string, dayStr: string, yearStr: string): string {
  const months: Record<string, string> = {
    Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
    Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
  };
  const month = months[monthStr.trim()] ?? '01';
  const day   = dayStr.trim().replace(',', '').padStart(2, '0');
  return `${yearStr.trim()}-${month}-${day}`;
}

// ── 1. Get user ID ─────────────────────────────────────────────────────────
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

// ── 2. Parse class stats from character-sheet.md ───────────────────────────
interface ClassStat {
  class_name: string;
  level: number;
  current_xp: number;
  total_xp: number;
}

const CLASS_DEFS: Array<{ name: string; levelPattern: RegExp; totalXpPattern: RegExp }> = [
  {
    name: 'Developer',
    levelPattern:  /### Developer[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Developer[^#]+?\*\*Total Career XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Sage',
    levelPattern:  /### Sage[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Sage[^#]+?\*\*Total Spiritual XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Warrior',
    levelPattern:  /### Warrior[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Warrior[^#]+?\*\*Total Warrior XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Artist',
    levelPattern:  /### Artist[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Artist[^#]+?\*\*Total Creative XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Redteamer',
    levelPattern:  /### Redteamer[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Redteamer[^#]+?\*\*Total Redteaming XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Financial Strategist',
    levelPattern:  /### Financial Strategist[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Financial Strategist[^#]+?\*\*Total[^X]*XP:\*\*\s*([\d,]+)/s,
  },
  {
    name: 'Survivalist',
    levelPattern:  /### Survivalist[^#]+?\*\*Level:\*\*\s*(\d+)/s,
    totalXpPattern: /### Survivalist[^#]+?\*\*Total Rest XP:\*\*\s*([\d,]+)/s,
  },
];

function parseClassStats(content: string): ClassStat[] {
  const stats: ClassStat[] = [];

  // First: extract current_xp for each class from CURRENT STATS section
  const statsStart = content.indexOf('[CURRENT-STATS-BEGIN]');
  const statsSection = statsStart >= 0 ? content.slice(statsStart) : content;

  // current_xp from "**Current XP:** X,XXX / Y,YYY" lines inside each class block
  const currentXpMap: Record<string, number> = {};
  const currentXpRe = /### ([A-Za-z ]+?) \(/g;
  let m: RegExpExecArray | null;
  while ((m = currentXpRe.exec(statsSection)) !== null) {
    const blockStart = m.index;
    const blockEnd   = statsSection.indexOf('\n### ', blockStart + 5);
    const block      = blockEnd >= 0
      ? statsSection.slice(blockStart, blockEnd)
      : statsSection.slice(blockStart, blockStart + 1500);
    const xpM = block.match(/\*\*Current XP:\*\*\s*([\d,]+)\s*\//);
    if (xpM) {
      currentXpMap[m[1].trim()] = parseInt(xpM[1].replace(/,/g, ''), 10);
    }
  }

  // Parse latest current_xp from history log (more recent than CURRENT STATS section)
  const histStart = content.indexOf('[HISTORY-LOG-BEGIN]');
  if (histStart >= 0) {
    const histSection = content.slice(histStart, histStart + 200_000); // first 200k chars of history
    // Pattern: "- **Developer:** +54 XP (...) : 4,956 → **5,010**"
    const xpUpdateRe = /^\s*-\s+\*\*([A-Za-z ]+):\*\*\s+\+\d+\s+XP[^:]+:\s*[\d,]+\s+→\s+\*\*([\d,]+)\*\*/gm;
    const latestMap: Record<string, number> = {};
    let xm: RegExpExecArray | null;
    while ((xm = xpUpdateRe.exec(histSection)) !== null) {
      const cls = xm[1].trim();
      if (!(cls in latestMap)) {
        // First occurrence in reverse-chronological order = most recent
        latestMap[cls] = parseInt(xm[2].replace(/,/g, ''), 10);
      }
    }
    Object.assign(currentXpMap, latestMap); // history overrides stale CURRENT STATS values
  }

  for (const def of CLASS_DEFS) {
    const levelM   = def.levelPattern.exec(content);
    const totalM   = def.totalXpPattern.exec(content);
    const level    = levelM ? parseInt(levelM[1], 10) : 1;
    const totalXp  = totalM ? parseInt(totalM[1].replace(/,/g, ''), 10) : 0;
    const currXp   = currentXpMap[def.name] ?? 0;
    stats.push({ class_name: def.name, level, current_xp: currXp, total_xp: totalXp });
  }

  return stats;
}

// ── 3. Parse XP history from history log ──────────────────────────────────
interface XPHistoryRow {
  earned_at: string;
  class_name: string;
  xp_pending: number;
  xp_confirmed: number;
  consolidation_pct: number;
  fitbit_score: number | null;
  notes: string | null;
}

function parseXPHistory(content: string): XPHistoryRow[] {
  const histStart = content.indexOf('[HISTORY-LOG-BEGIN]');
  if (histStart < 0) return [];

  const histSection = content.slice(histStart);
  const rows: XPHistoryRow[] = [];

  // Match each history entry header
  const entryRe = /^### (\w+)\s+(\d+)\s*->\s*(\w+)\s+(\d+),\s*(\d{4})/gm;
  let em: RegExpExecArray | null;

  while ((em = entryRe.exec(histSection)) !== null) {
    // "to" date is what we record as earned_at
    const earnedAt = toISODate(em[3], em[4], em[5]);

    // Extract the block for this entry (up to next ### or end)
    const blockStart = em.index + em[0].length;
    const nextEntry  = entryRe.lastIndex > 0
      ? histSection.indexOf('\n### ', em.index + 4)
      : -1;
    const block      = nextEntry >= 0
      ? histSection.slice(blockStart, nextEntry)
      : histSection.slice(blockStart, blockStart + 2000);

    // Sleep consolidation %
    const consM = block.match(/\*\*Sleep Consolidation:\*\*\s*([\d.]+)%/);
    const consolidation_pct = consM ? parseFloat(consM[1]) : 0;

    // Fitbit score from Sleep Debt line or consolidation note
    const fitbitM = block.match(/Fitbit\s+(\d+)/);
    const fitbit_score = fitbitM ? parseInt(fitbitM[1], 10) : null;

    // Pending XP per class: "- Warrior: 11 XP"
    const pendingMap: Record<string, number> = {};
    const pendingRe = /^\s*-\s+\*\*?([A-Za-z ]+?):\*\*?\s+(\d+)\s+XP/gm;
    let pm: RegExpExecArray | null;
    while ((pm = pendingRe.exec(block)) !== null) {
      pendingMap[pm[1].trim()] = parseInt(pm[2], 10);
    }

    // Permanent (confirmed) XP per class
    // Handles both formats:
    //   bold:     "- **Developer:** +54 XP (...) : 4,956 → **5,010**"
    //   non-bold: "- Developer: +54 XP (...) : 4,956 → **5,010**"
    const confirmedRe = /^\s*-\s+(?:\*\*)?([A-Za-z ]+?)(?:\*\*)?:\s+\+(\d+)\s+XP[^:]+:\s*([\d,]+)\s+→\s+\*\*([\d,]+)\*\*/gm;
    let cm: RegExpExecArray | null;
    while ((cm = confirmedRe.exec(block)) !== null) {
      const cls        = cm[1].trim();
      const confirmed  = parseInt(cm[2], 10);
      const pending    = pendingMap[cls] ?? confirmed;
      rows.push({
        earned_at: earnedAt,
        class_name: cls,
        xp_pending:    pending,
        xp_confirmed:  confirmed,
        consolidation_pct,
        fitbit_score,
        notes: null,
      });
    }
  }

  return rows;
}

// ── 4. Parse journal entries ───────────────────────────────────────────────
interface JournalRow {
  entry_date: string;
  sleep_hours: number | null;
  fitbit_score: number | null;
  fasting_hours: number | null;
  hydration_oz: number | null;
  protein_level: string | null;
  calories_status: string | null;
  stress_level: string | null;
  energy_score: number | null;
}
interface AcmRow { item_index: number; completed: boolean; }
interface QuestRow { class_name: string; quest_label: string; content: string; }
interface JournalBlock { journal: JournalRow; acm: AcmRow[]; quests: QuestRow[]; }

function parseJournalEntries(content: string): JournalBlock[] {
  const blocks: JournalBlock[] = [];

  // Split into date sections
  const dateRe = /^## (\d{4}-\d{2}-\d{2}) \(\w+\)$/gm;
  const sections: Array<{ date: string; start: number }> = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(content)) !== null) {
    sections.push({ date: dm[1], start: dm.index });
  }

  for (let i = 0; i < sections.length; i++) {
    const { date, start } = sections[i];
    const end  = i + 1 < sections.length ? sections[i + 1].start : content.length;
    const body = content.slice(start, end);

    // ── Sleep metrics ──────────────────────────────────────────────────────
    const sleepM    = body.match(/- Total Sleep:\s*([\d.]+)\s*hrs?/);
    const fitbitM   = body.match(/- Fitbit Score:\s*(\d+)\s*\/\s*100/);
    const fastingM  = body.match(/- Fasting\s*\(~?([\d.]+)\s*hrs/i)
                  || body.match(/^8\.\s+\[.?\]\s+Fasting\s+\(~?([\d.]+)\s*hrs/m);
    const hydroM    = body.match(/- Hydration:\s*([\d.]+)\s*oz/i)
                  || body.match(/Hydration Discipline\s*\(([\d.]+)\s*oz/i);
    const proteinM  = body.match(/- Protein:\s*(Low|Medium|High)/i);
    const caloriesM = body.match(/- Calories:\s*(Deficit|Maintenance|Surplus)/i);
    const stressM   = body.match(/- Stress:\s*(Low|Medium|High)/i);
    const energyM   = body.match(/- Energy:\s*(\d+)\s*\/\s*10/i);

    const journal: JournalRow = {
      entry_date:      date,
      sleep_hours:     sleepM    ? parseFloat(sleepM[1])    : null,
      fitbit_score:    fitbitM   ? parseInt(fitbitM[1], 10)  : null,
      fasting_hours:   fastingM  ? parseFloat(fastingM[1])  : null,
      hydration_oz:    hydroM    ? parseFloat(hydroM[1])    : null,
      protein_level:   proteinM  ? proteinM[1].toLowerCase()  : null,
      calories_status: caloriesM ? caloriesM[1].toLowerCase() : null,
      stress_level:    stressM   ? stressM[1].toLowerCase()   : null,
      energy_score:    energyM   ? parseInt(energyM[1], 10)   : null,
    };

    // ── ACM checkboxes ────────────────────────────────────────────────────
    const acm: AcmRow[] = [];
    const aclRe = /^(\d+)\.\s+\[(x| )\]/gm;
    let am: RegExpExecArray | null;
    while ((am = aclRe.exec(body)) !== null) {
      const idx = parseInt(am[1], 10) - 1; // 0-based
      if (idx >= 0 && idx < 15) acm.push({ item_index: idx, completed: am[2] === 'x' });
    }

    // ── Quest activities ──────────────────────────────────────────────────
    const quests: QuestRow[] = [];
    // Match class headers: "**Class Quests - Web App Developer:**"
    const classRe = /\*\*Class Quests - ([^:]+?):\*\*/g;
    let cm2: RegExpExecArray | null;
    while ((cm2 = classRe.exec(body)) !== null) {
      const className  = cm2[1].trim();
      const blockStart = cm2.index + cm2[0].length;
      const nextClass  = classRe.lastIndex > 0 ? body.indexOf('\n**Class Quests -', cm2.index + 5) : -1;
      const blockEnd   = nextClass >= 0 ? nextClass : body.indexOf('\n### ', blockStart);
      const questBlock = body.slice(blockStart, blockEnd >= blockStart ? blockEnd : blockStart + 3000);

      // Match field lines: "- **Job (TTI):** content"
      const fieldRe = /^\s*-\s+\*\*([^:]+?):\*\*\s*([\s\S]+?)(?=^\s*-\s+\*\*|\n###|\n\*\*Class|$)/gm;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRe.exec(questBlock)) !== null) {
        const label   = fm[1].trim();
        const rawVal  = fm[2].trim();
        const content = rawVal === '[To be logged]' ? '' : rawVal;
        if (label && content) quests.push({ class_name: className, quest_label: label, content });
      }
    }

    blocks.push({ journal, acm, quests });
  }

  return blocks;
}

// ── 5. Seed Supabase ───────────────────────────────────────────────────────
async function seedCharacterStats(userId: string, stats: ClassStat[]): Promise<void> {
  log(`Seeding ${stats.length} character_stats rows...`);
  for (const s of stats) {
    const { error } = await db.from('character_stats').upsert(
      { user_id: userId, class_name: s.class_name, level: s.level, current_xp: s.current_xp, total_xp: s.total_xp, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,class_name' }
    );
    if (error) err(`character_stats[${s.class_name}]`, error);
    else log(`  ✅ ${s.class_name} L${s.level} (${s.current_xp} XP)`);
  }
}

async function seedXPHistory(userId: string, rows: XPHistoryRow[]): Promise<void> {
  log(`Seeding ${rows.length} xp_history rows...`);
  // Use plain INSERT (one-time migration — no unique constraint needed; upsert would require
  // ALTER TABLE xp_history ADD CONSTRAINT ... UNIQUE (user_id, earned_at, class_name))
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(r => ({ ...r, user_id: userId }));
    const { error } = await db.from('xp_history').insert(batch);
    if (error) err(`xp_history batch ${i / BATCH}`, error);
    else inserted += batch.length;
  }
  log(`  ✅ ${inserted} xp_history rows inserted`);
}

async function seedJournalEntries(userId: string, blocks: JournalBlock[]): Promise<void> {
  log(`Seeding ${blocks.length} journal entries...`);
  let journalOk = 0, acmOk = 0, questsOk = 0;

  for (const { journal, acm, quests } of blocks) {
    // 1. Upsert daily_journal_entries
    const { data: je, error: je_err } = await db
      .from('daily_journal_entries')
      .upsert({ ...journal, user_id: userId }, { onConflict: 'user_id,entry_date' })
      .select('id')
      .single();

    if (je_err) { err(`journal[${journal.entry_date}]`, je_err); continue; }
    journalOk++;

    // 2. Upsert acm_entries linked to this journal row
    if (acm.length > 0 && je?.id) {
      const acmRows = acm.map(a => ({
        journal_entry_id: je.id,
        item_index:  a.item_index,
        completed:   a.completed,
      }));
      const { error: acm_err } = await db
        .from('acm_entries')
        .upsert(acmRows, { onConflict: 'journal_entry_id,item_index', ignoreDuplicates: true });
      if (acm_err) err(`acm[${journal.entry_date}]`, acm_err);
      else acmOk += acmRows.length;
    }

    // 3. Upsert quest_entries
    if (quests.length > 0) {
      const questRows = quests.map(q => ({
        user_id:     userId,
        entry_date:  journal.entry_date,
        class_name:  q.class_name,
        quest_label: q.quest_label,
        content:     q.content,
        updated_at:  new Date().toISOString(),
      }));
      const { error: q_err } = await db
        .from('quest_entries')
        .upsert(questRows, { onConflict: 'user_id,entry_date,class_name,quest_label', ignoreDuplicates: true });
      if (q_err) err(`quests[${journal.entry_date}]`, q_err);
      else questsOk += questRows.length;
    }
  }

  log(`  ✅ ${journalOk} journal rows, ${acmOk} ACM items, ${questsOk} quest fields`);
}

// ── 6. Ensure public.users row exists (required before all FK-dependent tables) ────────────
async function seedPublicUser(userId: string): Promise<void> {
  log('Ensuring public.users row exists...');
  // All application tables FK to public.users(id). Supabase Auth stores the user in
  // auth.users, but a corresponding row must exist in public.users for FK constraints.
  const { error } = await db.from('users').upsert(
    {
      id:         userId,
      email:      process.env.OWNER_EMAIL,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if (error) {
    err('public.users upsert', error);
    // Log the exact error so we can identify any missing NOT NULL columns
    console.error('[MIGRATE] ❌ public.users error detail:', JSON.stringify(error, null, 2));
    throw new Error(`Cannot proceed: public.users row is required before seeding FK tables.`);
  }
  log('✅ public.users row confirmed');
}

// ── 7. Upsert user_profile (optional table — non-blocking) ────────────────────────────────
async function seedUserProfile(userId: string): Promise<void> {
  // Skip gracefully if user_profiles table doesn't exist in this schema
  const { error } = await db.from('user_profiles').upsert(
    { user_id: userId, display_name: 'DigitalPaladin', created_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
  if (error) {
    if (error.code === 'PGRST205') {
      log('⚠️  user_profiles table not found — skipping (non-blocking)');
    } else {
      err('user_profile', error);
    }
  } else {
    log('✅ user_profile upserted');
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  log('═══════════════════════════════════════════');
  log('Starting Supabase migration from snapshot...');
  log('═══════════════════════════════════════════');

  const userId = await getUserId();

  log('Reading snapshot files...');
  const charSheet = readFileSync(CHAR_SHEET, 'utf-8');
  const journal   = readFileSync(JOURNAL, 'utf-8');
  log(`  character-sheet.md: ${charSheet.length.toLocaleString()} chars`);
  log(`  journal.md:         ${journal.length.toLocaleString()} chars`);

  // Must run before any table that FKs to public.users(id)
  await seedPublicUser(userId);
  await seedUserProfile(userId);

  const stats = parseClassStats(charSheet);
  await seedCharacterStats(userId, stats);

  const xpHistory = parseXPHistory(charSheet);
  log(`Parsed ${xpHistory.length} XP history entries from character-sheet.md`);
  await seedXPHistory(userId, xpHistory);

  const journalBlocks = parseJournalEntries(journal);
  log(`Parsed ${journalBlocks.length} journal entries from journal.md`);
  await seedJournalEntries(userId, journalBlocks);

  log('═══════════════════════════════════════════');
  log('✅ Migration complete!');
  log('═══════════════════════════════════════════');
  process.exit(0);
}

main().catch(e => { err('Fatal', e); process.exit(1); });
