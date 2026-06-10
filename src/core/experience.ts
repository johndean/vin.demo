/**
 * Unified Experience Model (V5 Guided Experience Platform, Phase 4). The BINDING that makes the whole platform
 * answerable without reading source code: assembleExperience(productId) walks the authority chain
 * (Stakeholder → Outcome → Journey → Workflow → Graph/Node → Knowledge → Specialist → Environment → Evidence)
 * and resolves the constitution's 13 operator questions, each from PERSISTED data. No new table (Rule #2/#3) —
 * it composes the registries shipped in Phases 1–3 + the Experience Registry. Every answer is real: a question
 * with no data is an honest gap (ok=false, "not yet modeled"), never fabricated. Pure DB.
 */
import { db } from './db.js';
import { getOutcomes } from './outcomes.js';
import { getStakeholderRegistry } from './stakeholders.js';
import { getJourneys, resolveStoryFlow } from './journeys.js';
import { selectNavigation } from './graph-lifecycle.js';
import { computeEnvironmentReadiness } from './environment-readiness.js';

export interface ExperienceQA { key: string; question: string; ok: boolean; summary: string }
export interface Experience { productId: string; productName: string; questions: ExperienceQA[]; modeled: number; total: number }

const count = async (sql: string, params: any[]): Promise<number> =>
  Number((await db().query<{ n: string }>(sql, params)).rows[0]?.n ?? 0);

export async function assembleExperience(productId: string): Promise<Experience | null> {
  const prod = (await db().query<{ name: string }>(`SELECT name FROM products WHERE id=$1`, [productId])).rows[0];
  if (!prod) return null;

  const [committee, outcomes, journeys, nav] = await Promise.all([
    getStakeholderRegistry(productId), getOutcomes(productId), getJourneys(productId), selectNavigation(productId, null),
  ]);
  const verified = nav.allVerified ?? [];

  // Journey reference integrity + the specialists those journeys name (Phase 2 seam).
  let journeyMissing = 0; const specialists = new Set<string>();
  for (const j of journeys) {
    const resolved = await resolveStoryFlow(productId, j.storyFlow);
    journeyMissing += resolved.filter((s) => !s.ok).length;
    for (const r of j.specialistRules) if (r?.personaName) specialists.add(String(r.personaName));
  }

  // Environment execution context + readiness (Phase 3).
  const env = (await db().query<{ ct: string | null; cs: string | null; vs: string | null; lv: string | null; ki: any; prod: boolean }>(`
    SELECT connection_target ct, certification_status cs, verification_state vs, last_verified::text lv, known_issues ki, is_production prod
      FROM environments WHERE product_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`, [productId])).rows[0];
  const envReady = env ? computeEnvironmentReadiness({
    connectionTarget: env.ct, certificationStatus: env.cs, verificationState: env.vs,
    lastVerifiedDays: env.lv ? Math.max(0, Math.floor((Date.now() - Date.parse(env.lv)) / 86400000)) : null,
    knownIssues: Array.isArray(env.ki) ? env.ki.length : 0, isProduction: env.prod,
  }) : null;

  const [approvedWf, chunks, grounded, evidence, broken, ge, oe, je] = await Promise.all([
    count(`SELECT count(*)::int::text n FROM demo_graph_workflows w JOIN demo_graphs g ON g.id=w.demo_graph_id WHERE g.product_id=$1 AND g.status='active' AND g.archived_at IS NULL AND w.archived_at IS NULL AND w.approved_at IS NOT NULL`, [productId]),
    count(`SELECT count(*)::int::text n FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL`, [productId]),
    count(`SELECT count(*)::int::text n FROM audit_turns at JOIN demo_sessions ds ON ds.id=at.demo_session_id JOIN product_versions pv ON pv.id=ds.product_version_id WHERE pv.product_id=$1 AND jsonb_array_length(at.knowledge_used)>0`, [productId]),
    count(`SELECT count(*)::int::text n FROM demo_graph_nodes n JOIN demo_graphs g ON g.id=n.demo_graph_id WHERE g.product_id=$1 AND g.status='active' AND g.archived_at IS NULL AND n.archived_at IS NULL AND (n.derived_evidence IS NOT NULL OR n.source_chunk_id IS NOT NULL)`, [productId]),
    count(`SELECT count(*)::int::text n FROM demo_graph_nodes n JOIN demo_graphs g ON g.id=n.demo_graph_id WHERE g.product_id=$1 AND g.status='active' AND g.archived_at IS NULL AND n.archived_at IS NULL AND n.verification_status='broken'`, [productId]),
    count(`SELECT count(*)::int::text n FROM graph_events WHERE product_id=$1`, [productId]),
    count(`SELECT count(*)::int::text n FROM outcome_events WHERE product_id=$1`, [productId]),
    count(`SELECT count(*)::int::text n FROM journey_events WHERE product_id=$1`, [productId]),
  ]);
  const changes = ge + oe + je;

  const q: ExperienceQA[] = [
    { key: 'room', question: 'Who is in the room?', ok: committee.length > 0,
      summary: committee.length ? `${committee.length} committee member(s): ${committee.slice(0, 4).map((m) => m.name).join(', ')}` : 'No buying committee defined' },
    { key: 'outcome', question: 'What business outcome matters?', ok: outcomes.length > 0,
      summary: outcomes.length ? `${outcomes.length} outcome(s): ${outcomes.slice(0, 3).map((o) => o.title).join(', ')}` : 'No business outcomes defined' },
    { key: 'journey', question: 'Which journey applies?', ok: journeys.length > 0,
      summary: journeys.length ? `${journeys.length} journey(s)${journeyMissing ? ` · ${journeyMissing} dangling ref(s)` : ''}` : 'No journeys authored' },
    { key: 'workflows', question: 'Which workflows support it?', ok: approvedWf > 0, summary: `${approvedWf} approved workflow(s)` },
    { key: 'nodes', question: 'Which nodes are used?', ok: verified.length > 0, summary: `${verified.length} verified node(s)` },
    { key: 'knowledge', question: 'Which knowledge supports it?', ok: chunks > 0, summary: `${chunks} chunk(s)${grounded ? ` · ${grounded} grounded turn(s)` : ''}` },
    { key: 'specialists', question: 'Which specialists participate?', ok: specialists.size > 0,
      summary: specialists.size ? `${specialists.size}: ${[...specialists].slice(0, 4).join(', ')}` : 'No specialists assigned to a journey' },
    { key: 'environment', question: 'Which environment is compatible?', ok: !!env && !!env.ct,
      summary: env ? `${envReady?.passed ?? 0}/${envReady?.total ?? 0} readiness gates${envReady?.ready ? ' — ready' : ''}` : 'No environment configured' },
    { key: 'evidence', question: 'What evidence exists?', ok: evidence > 0, summary: `${evidence} node(s) carry evidence` },
    { key: 'changed', question: 'What changed?', ok: changes > 0, summary: `${changes} audited change(s)` },
    { key: 'broken', question: 'What is broken?', ok: true,
      summary: (broken || journeyMissing || (envReady && !envReady.ready)) ? `${broken} broken node(s), ${journeyMissing} dangling journey ref(s)${envReady && !envReady.ready ? ', environment not ready' : ''}` : 'Nothing flagged broken' },
    { key: 'whatBreaks', question: 'What will break if modified?', ok: verified.length > 0 || journeys.length > 0,
      summary: `dependency graph present: ${verified.length} node(s), ${journeys.length} journey(s) reference assets` },
    { key: 'concerns', question: 'What stakeholder concerns / decision criteria exist?',
      ok: committee.some((m) => (m.decisionCriteria?.length || 0) + (m.objections?.length || 0) > 0),
      summary: committee.some((m) => (m.decisionCriteria?.length || 0) + (m.objections?.length || 0) > 0) ? 'decision criteria / objections captured' : 'No criteria or objections captured' },
  ];

  return { productId, productName: prod.name, questions: q, modeled: q.filter((x) => x.ok).length, total: q.length };
}
