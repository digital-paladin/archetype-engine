/**
 * Apply a SQL migration file against DATABASE_URL from backend/.env.
 * Usage: node scripts/apply-migration.js ../supabase/migrations/004_abstinence_streaks.sql
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadDatabaseUrl() {
  const envPath = path.join(__dirname, '..', '.env');
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in backend/.env');
  return line.slice('DATABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '');
}

function parseDatabaseUrl(rawUrl) {
  const m = rawUrl.match(/^([a-z]+):\/\/([^:]+):(.+)@([^/?#:]+):(\d+)\/([^?]*)/i);
  if (!m) return null;
  const [, , user, password, host, port, database] = m;
  return { user, password, host, port: Number(port), database };
}

async function main() {
  const sqlPath = process.argv[2];
  if (!sqlPath) {
    console.error('Usage: node scripts/apply-migration.js <path-to.sql>');
    process.exit(1);
  }
  const absSql = path.resolve(sqlPath);
  const sql = fs.readFileSync(absSql, 'utf8');
  const url = loadDatabaseUrl();
  const parsed = parseDatabaseUrl(url);

  const client = new Client(
    parsed
      ? {
          ...parsed,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 20000,
        }
      : {
          connectionString: url,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 20000,
        }
  );

  console.log('Applying:', absSql);
  await client.connect();
  try {
    await client.query(sql);
    console.log('APPLY: OK');
    const t = await client.query(
      "select to_regclass('public.abstinence_streaks') as tbl"
    );
    console.log('abstinence_streaks:', t.rows[0].tbl || 'MISSING');
    const cols = await client.query(`
      select column_name, data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = 'abstinence_streaks'
      order by ordinal_position
    `);
    console.log(
      'columns:',
      cols.rows.map((r) => r.column_name).join(', ')
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('APPLY: FAIL');
  console.error(e.message);
  process.exit(1);
});
