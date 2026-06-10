/** Persist an eval-suite run so the web console's Eval Harness shows real results. */
import { db } from './db.js';

export async function recordEvalRun(suite: string, passed: number, total: number, detail: Record<string, unknown> = {}, productId: string | null = null): Promise<void> {
  try {
    await db().query('INSERT INTO eval_runs (suite, passed, total, detail, product_id) VALUES ($1, $2, $3, $4, $5)', [suite, passed, total, JSON.stringify(detail), productId]);
  } catch (e: any) {
    console.error('  (eval_runs record skipped:', e?.message, ')');
  }
}
