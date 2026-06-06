/** Postgres access (Railway-hosted, pgvector). One pool per process. */
import { Pool } from 'pg';
import { config as loadEnv } from 'dotenv';

loadEnv();

let pool: Pool | null = null;

export function db(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — provision Railway Postgres and add it to .env.');
  }
  if (!pool) {
    const url = process.env.DATABASE_URL;
    const isLocal = /@(localhost|127\.0\.0\.1)/.test(url) || url.includes('sslmode=disable');
    pool = new Pool({
      connectionString: url,
      // Remote (Railway proxy) needs TLS; local dev does not.
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

/** Format a JS number[] as a pgvector literal: "[1,2,3]". */
export function toVector(v: number[]): string {
  return `[${v.join(',')}]`;
}
