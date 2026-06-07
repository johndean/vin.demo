import { Pool } from 'pg';

// Web → the SAME Railway Postgres the engine uses (the data SSOT). Mirrors src/core/db.ts.
let pool: Pool | null = null;

export function db(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — add it to apps/web/.env.local (local) and the Railway service vars (prod).');
  }
  if (!pool) {
    const url = process.env.DATABASE_URL;
    const isLocal = /@(localhost|127\.0\.0\.1)/.test(url) || url.includes('sslmode=disable');
    pool = new Pool({
      connectionString: url,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}
