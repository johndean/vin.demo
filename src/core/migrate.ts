/**
 * Migration runner — applies every db/migrations/*.sql in order, each in its own
 * transaction, recording applied versions in schema_migrations so re-runs are
 * safe and partial failures roll back atomically (finding 12).
 * Run: npm run migrate
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { db } from './db.js';

const DIR = path.resolve('db/migrations');

await db().query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);

const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
const applied = new Set(
  (await db().query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
);

let ran = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`  = ${file} (already applied)`);
    continue;
  }
  const sql = await readFile(path.join(DIR, file), 'utf8');
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`  + ${file} applied`);
    ran++;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`  ✗ ${file} failed — rolled back`);
    throw e;
  } finally {
    client.release();
  }
}
console.log(`\nMigrations up to date (${ran} applied this run).`);
process.exit(0);
