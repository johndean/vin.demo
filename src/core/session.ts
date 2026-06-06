/**
 * Demo-session lifecycle. A run creates a demo_session (Customer → DemoSession on
 * the entity model) so state, stakeholders, discovery, and cost events all hang
 * off a real session row. Execution mode is recorded here (default-deny: read-only).
 */
import { db } from './db.js';
import type { ExecutionMode } from './safety.js';

export interface DemoSession {
  id: string;
  productId: string;
  mode: ExecutionMode;
}

/** Create a demo session for a product, wiring its latest version + an environment. */
export async function createDemoSession(productId: string, mode: ExecutionMode): Promise<DemoSession> {
  const ws = await db().query<{ workspace_id: string }>('SELECT workspace_id FROM products WHERE id = $1', [productId]);
  const workspaceId = ws.rows[0]?.workspace_id;
  if (!workspaceId) throw new Error(`No product ${productId}`);

  // Demo prospect — atomic get-or-create, backed by the UNIQUE (workspace_id, name)
  // index from migration 0003 (which the prior ON CONFLICT silently lacked).
  const cust = await db().query<{ id: string }>(
    `INSERT INTO customers (workspace_id, name) VALUES ($1, 'Demo Prospect')
       ON CONFLICT (workspace_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [workspaceId],
  );
  const customerId = cust.rows[0].id;

  const ver = await db().query<{ id: string }>(
    `SELECT id FROM product_versions WHERE product_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`,
    [productId],
  );
  const env = await db().query<{ id: string }>('SELECT id FROM environments WHERE product_id=$1 ORDER BY created_at LIMIT 1', [productId]);

  const res = await db().query<{ id: string }>(
    `INSERT INTO demo_sessions (customer_id, product_version_id, environment_id, execution_mode)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [customerId, ver.rows[0]?.id ?? null, env.rows[0]?.id ?? null, mode],
  );
  return { id: res.rows[0].id, productId, mode };
}
