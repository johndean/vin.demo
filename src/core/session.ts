/**
 * Demo-session lifecycle. A run creates a demo_session (Customer → DemoSession on
 * the entity model) so state, stakeholders, discovery, and cost events all hang
 * off a real session row. Execution mode is recorded here (default-deny: read-only).
 */
import { db } from './db.js';
import type { ExecutionMode } from './safety.js';
import { seedStakeholders } from './stakeholders.js';

export interface DemoSession {
  id: string;
  productId: string;
  mode: ExecutionMode;
  journeyId: string | null;
}

/** Create a demo session for a product, wiring its latest version + an environment.
 *  `seedRoom` controls whether the synthetic multi-stakeholder fixture (Dana/Morgan) is seeded — that
 *  collection is a SCRIPTED-demo device (the reel, convo.ts, eval-phase2's speaker-switch). LIVE
 *  interactive/voice sessions pass `false`: there's one real operator in the room, so fabricating named
 *  attendees made the AI address people who don't exist. Default stays true for CLI/eval/reel callers. */
export async function createDemoSession(productId: string, mode: ExecutionMode, seedRoom = true, journeyId: string | null = null): Promise<DemoSession> {
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
    `INSERT INTO demo_sessions (customer_id, product_version_id, environment_id, execution_mode, journey_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [customerId, ver.rows[0]?.id ?? null, env.rows[0]?.id ?? null, mode, journeyId],
  );
  const sessionId = res.rows[0].id;
  if (seedRoom) await seedStakeholders(sessionId, productId); // F: scripted demos open with the product's room
  return { id: sessionId, productId, mode, journeyId };
}

/**
 * Persist the session's lifecycle status on the entity model — recovery/interrupt
 * governance (P2.1). This records lifecycle for audit/analytics; cross-process *resume*
 * (seeding graph state back from this row in a new process) is deferred to P2 server-mode,
 * where the in-memory checkpointer is replaced too.
 */
export async function updateSessionStatus(
  sessionId: string,
  status: 'active' | 'paused' | 'stopped' | 'done',
): Promise<void> {
  await db().query(`UPDATE demo_sessions SET status = $2 WHERE id = $1`, [sessionId, status]);
}

/** RC-30: a small resumable slice of the LangGraph DemoState — ONLY the REPLACE-reducer, serializable
 *  channels that matter for cross-process resume. Append-reducer channels (contextStack/trace) are
 *  deliberately excluded: re-seeding them would double on rehydrate. */
export interface SessionStateSnapshot {
  journeyId?: string | null;
  journeyStep?: number;
  currentPosition?: { intent: string; url: string; answer: string | null } | null;
  sessionStatus?: 'active' | 'paused' | 'stopped' | 'done';
  // RC-01 (shared working state): the live-drive loop's field-completion set — which form fields /agent/step has
  // already set this session. Mirrored here (in addition to the in-process Map in index.ts) so a redeploy/crash or
  // a fresh process rehydrates the drive loop's progress. Append-only window; absent on sessions that never drove.
  driveFieldsDone?: string[];
  // #30 (ASK→TALK shared memory): the recent NARRATIVE of the ASK-mode drive loop (the consultant's spoken steps).
  // Folded into the conversational brain's priorContext (golden-free) so a later TALK turn knows what the hands-on
  // drive just did — cross-modality continuity. Bounded window; jsonb-merged. driveHistoryAt stamps the last write
  // so a stale drive from earlier in a long session doesn't bleed into every answer forever (review L-2).
  driveHistory?: string[];
  driveHistoryAt?: number;
}

/** RC-30: best-effort persist of a resumable snapshot to demo_sessions.state_snapshot. Wrapped so a
 *  missing column (migration 0029 not yet applied) is a SILENT no-op and NEVER breaks a turn. */
export async function saveSessionState(sessionId: string | null, snapshot: SessionStateSnapshot): Promise<void> {
  if (!sessionId) return;
  try {
    // MERGE (jsonb ||) onto the existing snapshot so the two concurrent writers — the conversational/journey
    // brain (journeyId/journeyStep/currentPosition/sessionStatus) and the live-drive loop (driveFieldsDone) —
    // each PRESERVE the other's keys instead of clobbering on a full-column replace (the RC-01 durable-layer fix).
    // undefined keys are dropped by JSON.stringify, so they never null out a prior value. Best-effort: missing
    // column (0029 not applied) → silent no-op.
    await db().query(
      `UPDATE demo_sessions SET state_snapshot = COALESCE(state_snapshot, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [sessionId, JSON.stringify(snapshot)],
    );
  } catch { /* column may not exist until 0029 is applied — best-effort, never blocks a turn */ }
}

/** RC-30: best-effort read of the persisted snapshot for cross-process resume. Returns null on a missing
 *  column / no row / no snapshot (brand-new session) so boot is unchanged when there is nothing to resume. */
export async function loadSessionState(sessionId: string | null): Promise<SessionStateSnapshot | null> {
  if (!sessionId) return null;
  try {
    const r = await db().query<{ state_snapshot: SessionStateSnapshot | null }>(
      `SELECT state_snapshot FROM demo_sessions WHERE id = $1`, [sessionId],
    );
    return r.rows[0]?.state_snapshot ?? null;
  } catch { return null; } // column may not exist until 0029 is applied — boot exactly as today
}
