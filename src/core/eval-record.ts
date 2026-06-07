/** Persist an eval-suite run so the web console's Eval Harness shows real results. */
import { db } from './db.js';

export async function recordEvalRun(suite: string, passed: number, total: number, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await db().query('INSERT INTO eval_runs (suite, passed, total, detail) VALUES ($1, $2, $3, $4)', [suite, passed, total, JSON.stringify(detail)]);
  } catch (e: any) {
    console.error('  (eval_runs record skipped:', e?.message, ')');
  }
}
