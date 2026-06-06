/**
 * Active discovery (Gap E, P2.2). Phase 1 shipped the session_discovery FIELDS;
 * this captures them: each answer turn extracts any pain point / buying signal /
 * business objective the stakeholder expressed and unions it onto the row, so the
 * discovery picture builds up across the conversation. Behavior, not just fields.
 */
import { db } from './db.js';

export interface Discovery {
  painPoints: string[];
  buyingSignals: string[];
  businessObjective: string | null;
}

/** Union-append captured pain/signals (deduped) and set the objective when newly provided. */
export async function recordDiscovery(sessionId: string, d: Discovery): Promise<void> {
  await db().query(
    `INSERT INTO session_discovery (demo_session_id, pain_points, buying_signals, business_objective)
       VALUES ($1, $2::jsonb, $3::jsonb, $4)
     ON CONFLICT (demo_session_id) DO UPDATE SET
       pain_points    = (SELECT to_jsonb(array(SELECT DISTINCT jsonb_array_elements_text(session_discovery.pain_points    || EXCLUDED.pain_points)))),
       buying_signals = (SELECT to_jsonb(array(SELECT DISTINCT jsonb_array_elements_text(session_discovery.buying_signals || EXCLUDED.buying_signals)))),
       business_objective = COALESCE(EXCLUDED.business_objective, session_discovery.business_objective)`,
    [sessionId, JSON.stringify(d.painPoints), JSON.stringify(d.buyingSignals), d.businessObjective],
  );
}

export async function getDiscovery(sessionId: string): Promise<Discovery> {
  const { rows } = await db().query<{ pain_points: string[]; buying_signals: string[]; business_objective: string | null }>(
    `SELECT pain_points, buying_signals, business_objective FROM session_discovery WHERE demo_session_id = $1`,
    [sessionId],
  );
  const r = rows[0];
  return { painPoints: r?.pain_points ?? [], buyingSignals: r?.buying_signals ?? [], businessObjective: r?.business_objective ?? null };
}
