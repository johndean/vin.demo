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
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Railway external connections require TLS; internal do not. Be permissive.
      ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

/** Format a JS number[] as a pgvector literal: "[1,2,3]". */
export function toVector(v: number[]): string {
  return `[${v.join(',')}]`;
}
