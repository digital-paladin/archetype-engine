/**
 * One-time seed script: reads quest lines from CharacterParser → writes to Supabase.
 * Run: npm run seed:quest-lines
 * Safe to delete after use.
 */
import 'dotenv/config';
import { CharacterParser } from '../parser/characterParser';
import { SupabaseDataService } from '../services/data/SupabaseDataService';
import { getSupabaseAdmin } from '../lib/supabase';

async function main() {
  console.log('\n=== Seeding quest_lines + grand_convergence ===\n');

  // 1. Get the user_id from the public users table (service role bypasses RLS)
  const db_admin = getSupabaseAdmin();
  const { data: users, error: userErr } = await db_admin
    .from('users')
    .select('id, email')
    .limit(5);

  if (userErr) { console.error('Failed to query users:', userErr.message); process.exit(1); }
  if (!users || users.length === 0) { console.error('No users found in DB'); process.exit(1); }

  console.log('Users found:');
  users.forEach((u, i) => console.log(`  [${i}] ${u.id} — ${u.email}`));

  // Default to first user
  const userId = users[0].id as string;
  console.log(`\nSeeding for user: ${userId}\n`);

  // 2. Parse character-sheet.md
  const characterFilePath = process.env.CHARACTER_FILE_PATH || '../character-sheet.md';
  console.log(`Reading character sheet from: ${characterFilePath}\n`);
  const parser = new CharacterParser(characterFilePath);
  const characterData = await parser.parse();

  const rawQuestLines = (characterData as any).questLines ?? [];
  const rawGrandConvergence = (characterData as any).grandConvergence ?? null;

  console.log(`Parsed ${rawQuestLines.length} quest lines from character sheet`);
  if (rawGrandConvergence) {
    console.log(`Parsed Grand Convergence: ${rawGrandConvergence.conditions?.length ?? 0} conditions`);
  }

  if (rawQuestLines.length === 0) {
    console.warn('\n⚠️  No quest lines found in character sheet. Check extractQuestLines() in characterParser.ts.');
    console.warn('   The quest_lines table will remain empty.\n');
  }

  // 3. Map frontend shape → DB shape
  const db = new SupabaseDataService();

  const rows = rawQuestLines.map((ql: any, idx: number) => ({
    quest_number:       ql.number ?? idx + 1,
    name:               ql.name ?? '',
    icon:               ql.icon ?? '',
    class_name:         ql.class ?? '',
    status_text:        ql.statusText ?? '',
    status_emoji:       ql.statusEmoji ?? '',
    tagline:            ql.tagline ?? '',
    chapters:           ql.chapters ?? [],
    current_xp_drivers: ql.currentXpDrivers ?? '',
    unlocks:            ql.unlocks ?? '',
    sort_order:         idx,
  }));

  // 4. Write to DB
  await db.upsertQuestLines(userId, rows);
  console.log(`✅ Inserted ${rows.length} quest line(s) into quest_lines`);

  rows.forEach((r: any) => {
    console.log(`   Q${r.quest_number}  ${r.name}  [${r.class_name}]  ${r.status_text}`);
  });

  if (rawGrandConvergence) {
    await db.upsertGrandConvergence(userId, {
      conditions: rawGrandConvergence.conditions ?? [],
    });
    console.log(`✅ Upserted Grand Convergence (${rawGrandConvergence.conditions?.length ?? 0} conditions)`);
  } else {
    console.log('ℹ️  No Grand Convergence data found — skipping');
  }

  console.log('\n=== Done ===\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
