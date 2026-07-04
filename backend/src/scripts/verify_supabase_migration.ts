/**
 * verify_supabase_migration.ts
 *
 * One-shot diagnostic: SELECT COUNT(*) + sample rows on every character-data table.
 * Answers: "Is my full character state migrated to Supabase?"
 *
 * Run: npx ts-node src/scripts/verify_supabase_migration.ts
 */

import dotenv from 'dotenv';
import { resolve } from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

dotenv.config({ path: resolve(__dirname, '../../.env') });

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket as any },
});

// ── helpers ────────────────────────────────────────────────────────────────

async function count(table: string): Promise<number> {
  const { count: n, error } = await db.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}

async function sample(table: string, limit = 1): Promise<any[]> {
  const { data, error } = await db.from(table).select('*').limit(limit);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

function row(label: string, n: number, extra = '') {
  const status = n > 0 ? '✅' : '⚠️ EMPTY';
  console.log(`  ${status}  ${label.padEnd(28)} rows: ${String(n).padStart(5)}${extra}`);
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Supabase Migration Verification — ' + new Date().toISOString());
  console.log('══════════════════════════════════════════════════════\n');

  // ── 1. Core character state (from character-sheet.md) ──────────────────
  console.log('📊 CHARACTER SHEET (from character-sheet.md)');
  console.log('─────────────────────────────────────────────');

  const statsCount = await count('character_stats');
  row('character_stats', statsCount);
  if (statsCount > 0) {
    const [s] = await sample('character_stats');
    console.log(`         ↳ level=${s.level}, current_xp=${s.current_xp}, next_level_xp=${s.next_level_xp}, class=${s.class_name}`);
  }

  const xpCount = await count('xp_history');
  row('xp_history', xpCount);
  if (xpCount > 0) {
    const { data } = await db.from('xp_history').select('*').order('earned_at', { ascending: false }).limit(1);
    const r = data?.[0];
    if (r) console.log(`         ↳ latest: ${r.earned_at} | +${r.xp_confirmed} XP confirmed | ${r.class_name} | fitbit=${r.fitbit_score}`);
  }

  const profileCount = await count('character_profile');
  row('character_profile', profileCount, profileCount === 0 ? ' ← ⚠️ not migrated (display_name/title)' : '');
  if (profileCount > 0) {
    const [p] = await sample('character_profile');
    console.log(`         ↳ display_name=${p.display_name}, title=${p.title}`);
  }

  const questLinesCount = await count('quest_lines');
  row('quest_lines', questLinesCount);

  const gcCount = await count('grand_convergence');
  row('grand_convergence', gcCount);

  console.log('\n📊 CHARACTER SHEET CLASSES');
  console.log('─────────────────────────────────────────────');
  const { data: allStats } = await db.from('character_stats').select('class_name,level,current_xp,total_xp').order('total_xp', { ascending: false });
  allStats?.forEach(s => console.log(`  L${String(s.level).padStart(2)}  ${String(s.class_name).padEnd(22)} xp: ${String(s.current_xp).padStart(5)} / total: ${s.total_xp}`));

  // ── 2. Journal entries (from journal .md) ──────────────────────────────
  console.log('\n📓 JOURNAL DATA (from daily manual journal .md)');
  console.log('─────────────────────────────────────────────');

  const journalCount = await count('daily_journal_entries');
  row('daily_journal_entries', journalCount);
  if (journalCount > 0) {
    const { data } = await db.from('daily_journal_entries').select('entry_date, fitbit_score, sleep_hours, protein_level, hydration_oz').order('entry_date', { ascending: false }).limit(3);
    data?.forEach(e => console.log(`         ↳ ${e.entry_date} | fitbit=${e.fitbit_score} | sleep=${e.sleep_hours}h | protein=${e.protein_level} | hydration=${e.hydration_oz}oz`));
  }

  const acmCount = await count('acm_entries');
  row('acm_entries', acmCount);
  if (acmCount > 0) {
    const { data } = await db.from('acm_entries').select('entry_date').order('entry_date', { ascending: false }).limit(1);
    if (data?.[0]) console.log(`         ↳ latest: ${data[0].entry_date}`);
  }

  const questEntryCount = await count('quest_entries');
  row('quest_entries', questEntryCount);
  if (questEntryCount > 0) {
    const { data } = await db.from('quest_entries').select('entry_date, class_name, field_label').order('entry_date', { ascending: false }).limit(2);
    data?.forEach(e => console.log(`         ↳ ${e.entry_date} | ${e.class_name} → ${e.field_label}`));
  }

  // ── 3. Activity & gameplay data ────────────────────────────────────────
  console.log('\n🎮 ACTIVITY & GAMEPLAY');
  console.log('─────────────────────────────────────────────');

  const activityCount = await count('activity_log');
  row('activity_log', activityCount);
  if (activityCount > 0) {
    const { data } = await db.from('activity_log').select('*').order('logged_at', { ascending: false }).limit(1);
    const a = data?.[0];
    if (a) console.log(`         ↳ latest: ${a.logged_at?.slice(0,10)} | ${a.class_name} | ${a.description?.slice(0,50)}`);
  }

  const vaultCount = await count('vault_items');
  row('vault_items', vaultCount);

  // ── 4. Auth & integrations ─────────────────────────────────────────────
  console.log('\n🔐 AUTH & INTEGRATIONS');
  console.log('─────────────────────────────────────────────');

  const fitbitCount = await count('fitbit_tokens');
  row('fitbit_tokens', fitbitCount, fitbitCount === 0 ? ' ← needs re-auth after Sprint 12 deploy' : ' ← Fitbit authorized ✅');

  const spendingCount = await count('spending_entries');
  row('spending_entries', spendingCount);

  const treasuryCount = await count('treasury_settings');
  row('treasury_settings', treasuryCount);

  // ── 5. Date range coverage ─────────────────────────────────────────────
  if (journalCount > 0) {
    console.log('\n📅 DATE RANGE COVERAGE');
    console.log('─────────────────────────────────────────────');
    const { data: oldest } = await db.from('daily_journal_entries').select('entry_date').order('entry_date', { ascending: true }).limit(1);
    const { data: newest } = await db.from('daily_journal_entries').select('entry_date').order('entry_date', { ascending: false }).limit(1);
    console.log(`  Journal entries span: ${oldest?.[0]?.entry_date} → ${newest?.[0]?.entry_date}`);
  }

  if (xpCount > 0) {
    const { data: oldest } = await db.from('xp_history').select('earned_at').order('earned_at', { ascending: true }).limit(1);
    const { data: newest } = await db.from('xp_history').select('earned_at').order('earned_at', { ascending: false }).limit(1);
    console.log(`  XP history spans:     ${oldest?.[0]?.earned_at} → ${newest?.[0]?.earned_at}`);
  }

  // ── 6. Backup check ────────────────────────────────────────────────────
  console.log('\n💾 BACKUP STATUS');
  console.log('─────────────────────────────────────────────');
  console.log('  Supabase Pro plan: Daily automated PITR backups (7-day window)');
  console.log('  Supabase Free plan: NO automated backups — manual export only');
  console.log('  → Check: https://supabase.com/dashboard/project/_/settings/general');
  console.log('    (Settings → Backups — see if PITR is enabled for your plan)');

  console.log('\n══════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
