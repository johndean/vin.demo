/**
 * Journey Layer (V5 Guided Experience Platform, Phase 2 — the keystone; migration 0021). A Journey is the
 * orchestration object that was wholly missing: it REFERENCES existing assets (workflows, tours, knowledge,
 * plus narrative notes) in an ordered story_flow, tied to a business outcome + the buying committee +
 * participating specialists. It ORCHESTRATES; it never replaces workflows/tours/REEL/graph/knowledge.
 * Governed exactly like outcomes/graphs: audited CRUD, soft-archive, status lifecycle. REFERENCE INTEGRITY
 * is checked at read time (resolveStoryFlow) — a dangling ref is FLAGGED, never silently dropped. Run
 * telemetry (startJourneyRun/completeJourneyRun) is the basis for Phase 5 success metrics. Pure DB (no
 * LLM/browser) — same posture as graph-lifecycle.ts / outcomes.ts. Event writes are best-effort.
 */
import { db } from './db.js';

export type JourneyStatus = 'draft' | 'active' | 'deprecated' | 'archived';
export type JourneyAction = 'create' | 'edit' | 'publish' | 'deprecate' | 'archive' | 'link';
export type StoryStepKind = 'workflow' | 'tour' | 'knowledge' | 'note';
const STEP_KINDS: StoryStepKind[] = ['workflow', 'tour', 'knowledge', 'note'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoryStep { kind: StoryStepKind; refId: string | null; caption: string | null }
export interface ResolvedStep extends StoryStep { label: string; ok: boolean; reason: string }
export interface SpecialistRule { personaId?: string | null; personaName?: string | null; note?: string | null }

export interface JourneyEvent {
  journeyId?: string | null; productId?: string | null; actor?: string; before?: unknown; after?: unknown;
}

/** Record a journey MUTATION to the audit trail. Best-effort — never throws into the caller. */
export async function recordJourneyEvent(action: JourneyAction, e: JourneyEvent): Promise<void> {
  try {
    await db().query(
      `INSERT INTO journey_events (journey_id, product_id, action, actor, before, after)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [e.journeyId ?? null, e.productId ?? null, action, e.actor ?? 'system',
       e.before != null ? JSON.stringify(e.before) : null, e.after != null ? JSON.stringify(e.after) : null],
    );
  } catch (err) { console.error('[journey] recordJourneyEvent failed (best-effort):', err); }
}

export interface JourneyInput {
  name: string;
  businessGoal?: string | null;
  businessOutcomeId?: string | null;
  environmentId?: string | null;
  storyFlow?: StoryStep[];
  stakeholderRefs?: string[];
  specialistRules?: SpecialistRule[];
  successCriteria?: string | null;
  status?: JourneyStatus;
  owner?: string | null;
}

export interface Journey {
  id: string; productId: string; name: string; businessGoal: string | null;
  businessOutcomeId: string | null; environmentId: string | null;
  storyFlow: StoryStep[]; stakeholderRefs: string[]; specialistRules: SpecialistRule[];
  successCriteria: string | null; status: JourneyStatus; version: number; owner: string | null;
  // Wave C #10: the linked business_outcome's quantified frame (LEFT JOINed by getJourneyById only) so the walk's
  // close beat + ROI answers can state a REAL number. Null when no outcome is linked / not loaded by this query.
  outcomeMetric?: string | null; outcomeBaseline?: string | null; outcomeTarget?: string | null;
}

interface JourneyRow {
  id: string; product_id: string; name: string; business_goal: string | null;
  business_outcome_id: string | null; environment_id: string | null;
  story_flow: any; stakeholder_refs: any; specialist_rules: any;
  success_criteria: string | null; status: JourneyStatus; version: number; owner: string | null;
  outcome_metric?: string | null; outcome_baseline?: string | null; outcome_target?: string | null; // Wave C #10 (getJourneyById JOIN only)
}
const asArr = (v: any): any[] => (Array.isArray(v) ? v : []);
const toJourney = (r: JourneyRow): Journey => ({
  id: r.id, productId: r.product_id, name: r.name, businessGoal: r.business_goal,
  businessOutcomeId: r.business_outcome_id, environmentId: r.environment_id,
  storyFlow: asArr(r.story_flow), stakeholderRefs: asArr(r.stakeholder_refs).map(String),
  specialistRules: asArr(r.specialist_rules), successCriteria: r.success_criteria,
  status: r.status, version: r.version, owner: r.owner,
  outcomeMetric: r.outcome_metric ?? null, outcomeBaseline: r.outcome_baseline ?? null, outcomeTarget: r.outcome_target ?? null,
});

/** Sanitize an incoming story_flow: keep only known kinds; coerce refId/caption to string|null. */
function sanitizeSteps(steps: StoryStep[] | undefined): StoryStep[] {
  return (steps ?? [])
    .filter((s) => s && STEP_KINDS.includes(s.kind))
    .map((s) => ({ kind: s.kind, refId: s.kind === 'note' ? null : (s.refId ? String(s.refId) : null), caption: s.caption != null ? String(s.caption) : null }));
}

/** Every non-archived journey for a product (active + draft + deprecated), newest first. */
export async function getJourneys(productId: string): Promise<Journey[]> {
  const { rows } = await db().query<JourneyRow>(
    `SELECT id, product_id, name, business_goal, business_outcome_id, environment_id,
            story_flow, stakeholder_refs, specialist_rules, success_criteria, status, version, owner
       FROM journeys WHERE product_id = $1 AND archived_at IS NULL ORDER BY created_at DESC`, [productId]);
  return rows.map(toJourney);
}

/** One journey by id (non-archived), or null. Used by the live runtime to WALK a pinned journey. */
export async function getJourneyById(journeyId: string): Promise<Journey | null> {
  const { rows } = await db().query<JourneyRow>(
    `SELECT j.id, j.product_id, j.name, j.business_goal, j.business_outcome_id, j.environment_id,
            j.story_flow, j.stakeholder_refs, j.specialist_rules, j.success_criteria, j.status, j.version, j.owner,
            o.metric AS outcome_metric, o.baseline AS outcome_baseline, o.target AS outcome_target
       FROM journeys j LEFT JOIN business_outcomes o ON o.id = j.business_outcome_id AND o.archived_at IS NULL
      WHERE j.id = $1 AND j.archived_at IS NULL`, [journeyId]);
  return rows[0] ? toJourney(rows[0]) : null;
}

/** One entry the live loop drives at a time. A 'node' is a real screen to navigate to (by intent_label);
 *  a 'beat' is a narration-only moment (knowledge/note/tour step, or a workflow whose nodes don't resolve). */
export interface WalkEntry { kind: 'node' | 'beat'; nodeLabel?: string; caption: string | null; stepKind: StoryStepKind; stepIndex: number;
  // RC-16: for a `knowledge` step, the resolved chunk content — GROUNDING for the spoken narration so the
  // voice walk paraphrases the verified source, not free-improvises product claims. Null = nothing to ground on.
  sourceText?: string | null;
  // Experience-audit #7/#16: the story role of this beat + whether it is SPOKEN. A workflow expands to many
  // screens but the demo narrates only ~3 (first / midpoint / last) plus the bookends; interior screens are
  // driven SILENTLY (narrated=false) so the walk advances instead of restating a value prop on every screen.
  arcRole: 'open' | 'show' | 'transit' | 'close';
  narrated: boolean }

// RC-16: light sanitize of a knowledge chunk before it becomes SPOKEN narration grounding — strip markdown/
// bullets/backticks and cap length, so leaked formatting can't reach TTS and a long chunk can't crowd the line.
function speakableSource(s: string): string {
  return s.replace(/[*_`#>|]+/g, ' ').replace(/^[\s\-•·–—]+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 600);
}

/** Expand a journey's story_flow into the ordered WALK PLAN the live loop drives one entry at a time:
 *  a `workflow` step → one 'node' entry per node in that workflow's `node_sequence` (the screens to show,
 *  in order); `knowledge`/`note`/`tour` steps → a single narration 'beat'. The journey fully determines
 *  WHERE the demo goes and in WHAT order — this is the journey DRIVING the demo (consume-only; reads the
 *  already-authored workflow node_sequence, invents nothing). */
export async function journeyWalkPlan(journeyId: string): Promise<{ journey: Journey; plan: WalkEntry[] } | null> {
  const journey = await getJourneyById(journeyId);
  if (!journey) return null;
  const plan: WalkEntry[] = [];
  let i = 0;
  for (const step of journey.storyFlow) {
    if (step.kind === 'workflow' && step.refId) {
      const wf = (await db().query<{ node_sequence: any }>(
        `SELECT node_sequence FROM demo_graph_workflows WHERE id = $1 AND archived_at IS NULL`, [step.refId])).rows[0];
      const seq = (wf && Array.isArray(wf.node_sequence) ? wf.node_sequence : []).map((s: any) => String(s)).filter(Boolean);
      if (seq.length) seq.forEach((label, k) => plan.push({ kind: 'node', nodeLabel: label, caption: k === 0 ? step.caption : null, stepKind: 'workflow', stepIndex: i, arcRole: 'show', narrated: true }));
      else plan.push({ kind: 'beat', caption: step.caption, stepKind: 'workflow', stepIndex: i, arcRole: 'show', narrated: true });
    } else if (step.kind === 'knowledge' && step.refId && UUID_RE.test(step.refId)) {
      // RC-16: resolve the referenced chunk's CONTENT (same product-scoped query resolveStoryFlow uses, but the
      // full content — not the truncated label) so the narration beat can paraphrase a GROUNDED source, not invent.
      const kc = (await db().query<{ content: string }>(
        `SELECT kc.content FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
          WHERE kc.id = $1 AND kb.product_id = $2 AND kc.archived_at IS NULL`, [step.refId, journey.productId])).rows[0];
      plan.push({ kind: 'beat', caption: step.caption, stepKind: step.kind, stepIndex: i, sourceText: kc ? speakableSource(String(kc.content)) : null, arcRole: 'show', narrated: true });
    } else {
      plan.push({ kind: 'beat', caption: step.caption, stepKind: step.kind, stepIndex: i, arcRole: 'show', narrated: true });
    }
    i++;
  }
  // Experience-audit #7/#16: assign story arcRoles + which beats are SPOKEN. A workflow's node run is narrated on
  // only its first, last (+ a midpoint when long ≥5) → ~3 spoken screens; the interior screens become 'transit'
  // (driven silently). The plan's first/last entries are the bookends → 'open'/'close' (always spoken; these get
  // the outcome framing in graph.ts). A short run (≤3 nodes) stays fully narrated.
  const runs = new Map<number, number[]>(); // stepIndex → plan indices of that workflow's 'node' entries
  plan.forEach((e, idx) => { if (e.kind === 'node') { const a = runs.get(e.stepIndex) ?? []; a.push(idx); runs.set(e.stepIndex, a); } });
  for (const idxs of runs.values()) {
    const n = idxs.length;
    if (n <= 3) continue; // short workflow → narrate every screen
    const keep = new Set<number>([idxs[0], idxs[n - 1]]);
    if (n >= 5) keep.add(idxs[Math.floor(n / 2)]);
    idxs.forEach((pi) => { if (!keep.has(pi)) { plan[pi].narrated = false; plan[pi].arcRole = 'transit'; } });
  }
  if (plan.length) {
    plan[0].arcRole = 'open'; plan[0].narrated = true;
    if (plan.length > 1) { plan[plan.length - 1].arcRole = 'close'; plan[plan.length - 1].narrated = true; } // a lone beat stays 'open', not mislabeled 'close'
  }
  return { journey, plan };
}

/** Create a journey. Audited. Returns the new id. */
export async function createJourney(productId: string, input: JourneyInput, actor = 'system'): Promise<{ journeyId: string; productId: string }> {
  if (!productId) throw new Error('productId required');
  if (!input?.name?.trim()) throw new Error('journey name required');
  const id = (await db().query<{ id: string }>(
    `INSERT INTO journeys (product_id, name, business_goal, business_outcome_id, environment_id, story_flow,
        stakeholder_refs, specialist_rules, success_criteria, status, owner, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,now()) RETURNING id`,
    [productId, input.name.trim(), input.businessGoal ?? null, input.businessOutcomeId || null, input.environmentId || null,
     JSON.stringify(sanitizeSteps(input.storyFlow)), JSON.stringify((input.stakeholderRefs ?? []).map(String)),
     JSON.stringify(input.specialistRules ?? []), input.successCriteria ?? null, input.status ?? 'draft', input.owner ?? null, actor],
  )).rows[0].id;
  await recordJourneyEvent('create', { journeyId: id, productId, actor, after: { name: input.name, status: input.status ?? 'draft', steps: sanitizeSteps(input.storyFlow).length } });
  return { journeyId: id, productId };
}

/** Edit a journey (COALESCE keeps any omitted scalar; jsonb fields replace when provided). Bumps version. */
export async function updateJourney(journeyId: string, input: Partial<JourneyInput>, actor = 'system'): Promise<{ journeyId: string; productId: string }> {
  const before = (await db().query<{ product_id: string; name: string; status: JourneyStatus }>(
    `SELECT product_id, name, status FROM journeys WHERE id = $1`, [journeyId])).rows[0];
  if (!before) throw new Error('journey not found');
  if (input.name != null && !input.name.trim()) throw new Error('journey name cannot be blank');
  await db().query(
    `UPDATE journeys SET
       name = COALESCE($2, name), business_goal = COALESCE($3, business_goal),
       business_outcome_id = $4, environment_id = $5,
       story_flow = COALESCE($6::jsonb, story_flow), stakeholder_refs = COALESCE($7::jsonb, stakeholder_refs),
       specialist_rules = COALESCE($8::jsonb, specialist_rules), success_criteria = COALESCE($9, success_criteria),
       status = COALESCE($10, status), version = version + 1, updated_by = $11, updated_at = now()
     WHERE id = $1`,
    [journeyId, input.name?.trim() ?? null, input.businessGoal ?? null, input.businessOutcomeId || null, input.environmentId || null,
     input.storyFlow ? JSON.stringify(sanitizeSteps(input.storyFlow)) : null,
     input.stakeholderRefs ? JSON.stringify(input.stakeholderRefs.map(String)) : null,
     input.specialistRules ? JSON.stringify(input.specialistRules) : null,
     input.successCriteria ?? null, input.status ?? null, actor],
  );
  await recordJourneyEvent('edit', { journeyId, productId: before.product_id, actor, before: { name: before.name }, after: { name: input.name ?? before.name } });
  return { journeyId, productId: before.product_id };
}

/** Flip a journey's lifecycle status (publish → active, deprecate, back to draft). Audited. */
export async function setJourneyStatus(journeyId: string, status: JourneyStatus, actor = 'system'): Promise<{ journeyId: string; productId: string }> {
  const before = (await db().query<{ product_id: string; status: JourneyStatus }>(
    `SELECT product_id, status FROM journeys WHERE id = $1`, [journeyId])).rows[0];
  if (!before) throw new Error('journey not found');
  await db().query(`UPDATE journeys SET status = $2, updated_by = $3, updated_at = now() WHERE id = $1`, [journeyId, status, actor]);
  const action: JourneyAction = status === 'active' ? 'publish' : status === 'deprecated' ? 'deprecate' : 'edit';
  await recordJourneyEvent(action, { journeyId, productId: before.product_id, actor, before: { status: before.status }, after: { status } });
  return { journeyId, productId: before.product_id };
}

/** Soft-archive a journey (never hard-delete). */
export async function archiveJourney(journeyId: string, actor = 'system'): Promise<{ journeyId: string; productId: string }> {
  const before = (await db().query<{ product_id: string; name: string; status: JourneyStatus }>(
    `SELECT product_id, name, status FROM journeys WHERE id = $1`, [journeyId])).rows[0];
  if (!before) throw new Error('journey not found');
  await db().query(`UPDATE journeys SET status = 'archived', archived_at = now(), archived_by = $2 WHERE id = $1`, [journeyId, actor]);
  await recordJourneyEvent('archive', { journeyId, productId: before.product_id, actor, before: { status: before.status }, after: { status: 'archived' } });
  return { journeyId, productId: before.product_id };
}

/** REFERENCE INTEGRITY (the heart of "orchestrates real assets, never fabricates"): resolve each story step's
 *  refId to a REAL, non-archived asset belonging to this product, returning a label + ok flag + reason. A
 *  dangling/invalid/cross-product ref is FLAGGED ok=false (never dropped). 'note' steps are always ok. */
export async function resolveStoryFlow(productId: string, steps: StoryStep[]): Promise<ResolvedStep[]> {
  const idsOf = (kind: StoryStepKind) => steps.filter((s) => s.kind === kind && s.refId && UUID_RE.test(s.refId)).map((s) => s.refId as string);
  const wfIds = idsOf('workflow'), tourIds = idsOf('tour'), kIds = idsOf('knowledge');

  const wfMap = new Map<string, string>(), tourMap = new Map<string, string>(), kMap = new Map<string, string>();
  if (wfIds.length) (await db().query<{ id: string; n: string }>(
    `SELECT w.id, w.workflow_name n FROM demo_graph_workflows w JOIN demo_graphs g ON g.id = w.demo_graph_id
      WHERE w.id = ANY($1::uuid[]) AND g.product_id = $2 AND w.archived_at IS NULL`, [wfIds, productId])).rows.forEach((r) => wfMap.set(r.id, r.n));
  if (tourIds.length) (await db().query<{ id: string; n: string }>(
    `SELECT id, name n FROM demo_tours WHERE id = ANY($1::uuid[]) AND product_id = $2 AND archived_at IS NULL`, [tourIds, productId])).rows.forEach((r) => tourMap.set(r.id, r.n));
  if (kIds.length) (await db().query<{ id: string; c: string }>(
    `SELECT kc.id, kc.content c FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
      WHERE kc.id = ANY($1::uuid[]) AND kb.product_id = $2 AND kc.archived_at IS NULL`, [kIds, productId])).rows.forEach((r) => {
        const first = String(r.c).split(/(?<=[.!?])\s/)[0];
        kMap.set(r.id, first.length > 60 ? first.slice(0, 57) + '…' : first);
      });

  return steps.map((s): ResolvedStep => {
    if (s.kind === 'note') return { ...s, label: s.caption?.trim() || '(note)', ok: true, reason: '' };
    if (!s.refId) return { ...s, label: '(no reference)', ok: false, reason: 'no reference set' };
    if (!UUID_RE.test(s.refId)) return { ...s, label: '(invalid reference)', ok: false, reason: 'invalid reference id' };
    const map = s.kind === 'workflow' ? wfMap : s.kind === 'tour' ? tourMap : kMap;
    const label = map.get(s.refId);
    return label
      ? { ...s, label, ok: true, reason: '' }
      : { ...s, label: '(missing)', ok: false, reason: `${s.kind} not found, archived, or belongs to another product` };
  });
}

// ── Run telemetry (the basis for Phase 5 journey-success metrics). Written when a journey is actually walked;
// until then journey_runs is empty and the console shows "0 runs" honestly (telemetry-gated). ──

export async function startJourneyRun(journeyId: string, demoSessionId: string | null = null): Promise<{ runId: string } | null> {
  try {
    const j = (await db().query<{ product_id: string }>(`SELECT product_id FROM journeys WHERE id = $1`, [journeyId])).rows[0];
    if (!j) return null;
    const id = (await db().query<{ id: string }>(
      `INSERT INTO journey_runs (journey_id, product_id, demo_session_id, status) VALUES ($1,$2,$3,'running') RETURNING id`,
      [journeyId, j.product_id, demoSessionId])).rows[0].id;
    return { runId: id };
  } catch (err) { console.error('[journey] startJourneyRun failed (best-effort):', err); return null; }
}

export async function completeJourneyRun(runId: string, status: 'completed' | 'aborted' = 'completed'): Promise<void> {
  try {
    await db().query(`UPDATE journey_runs SET status = $2, completed_at = now() WHERE id = $1`, [runId, status]);
  } catch (err) { console.error('[journey] completeJourneyRun failed (best-effort):', err); }
}
