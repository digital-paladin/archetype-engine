/**
 * Smoke-test DATABASE_URL from backend/.env. Never prints the password.
 * Usage: node scripts/test-db-url.js
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const raw = fs.readFileSync(envPath, 'utf8');
const line = raw.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
if (!line) {
  console.error('FAIL: DATABASE_URL not found in backend/.env');
  process.exit(1);
}
let url = line.slice('DATABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '');
if (!url || url.includes('[YOUR-PASSWORD]')) {
  console.error('FAIL: DATABASE_URL empty or still has [YOUR-PASSWORD] placeholder');
  process.exit(1);
}

/**
 * Split user:pass@host when password may contain @ # ) etc.
 * Prefer discrete Client config over raw URI when special chars are present.
 */
function parseDatabaseUrl(rawUrl) {
  const m = rawUrl.match(
    /^([a-z]+):\/\/([^:]+):(.+)@([^/?#:]+):(\d+)\/([^?]*)/i
  );
  if (!m) return null;
  const [, , user, password, host, port, database] = m;
  return { user, password, host, port: Number(port), database };
}

const parsed = parseDatabaseUrl(url);
const redacted = url.replace(/:\/\/([^:/?#]+):([^@]+)@/, '://$1:***@');
console.log('URI present:', redacted);
if (parsed) {
  const special = [...new Set(parsed.password.split('').filter((c) => /[^A-Za-z0-9._~-]/.test(c)))];
  if (special.length) {
    console.log(
      'NOTE: password has special chars needing percent-encode in URI:',
      special.map((c) => JSON.stringify(c)).join(' ')
    );
    console.log('  # → %23   ) → %29   @ → %40   % → %25');
  }
}

async function main() {
  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    console.error('FAIL: package "pg" not installed — run: npm install pg');
    process.exit(2);
  }

  const clientOpts = parsed
    ? {
        user: parsed.user,
        password: parsed.password,
        host: parsed.host,
        port: parsed.port,
        database: parsed.database,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      }
    : {
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      };

  const client = new Client(clientOpts);

  try {
    await client.connect();
    const r = await client.query(
      'select current_database() as db, current_user as usr, version() as v'
    );
    console.log('CONNECT: OK');
    console.log('db=', r.rows[0].db, 'user=', r.rows[0].usr);
    console.log('version=', String(r.rows[0].v).split(',')[0]);

    const t = await client.query(
      "select to_regclass('public.abstinence_streaks') as tbl"
    );
    console.log(
      'abstinence_streaks:',
      t.rows[0].tbl ? 'EXISTS' : 'MISSING (004 not applied yet)'
    );
    await client.end();
    process.exit(0);
  } catch (e) {
    console.error('CONNECT: FAIL');
    console.error(e.message);
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
}

main();
