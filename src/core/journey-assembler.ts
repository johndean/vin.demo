/**
 * Journey ASSEMBLER (V5; migration 0025). A downstream CONSUMER of validated VIN intelligence — NOT a
 * generator. Given Organization · Industry · Product · Business Outcome · Buying Committee it:
 *   1. DISCOVERS existing assets (demo-graph workflows, tours, validated knowledge, personas, environment)
 *   2. SCORES their relevance to the outcome + committee (deterministic + explainable — no LLM, no invention)
 *   3. DETECTS coverage gaps
 *   4. PERSISTS first-class Gap Records for every missing dependency (never invents the artifact)
 *   5. ASSEMBLES a DRAFT journey whose story_flow REFERENCES existing assets only
 *   6. SCORES confidence (coverage-based)
 *   7. Returns { journeyId, confidence, gaps }
 *
 * HARD RULE (Zero-Gap): the assembler creates ONLY a journey (0021) + gap_records (0025). It NEVER creates a
 * product / screen / workflow / tour / knowledge chunk / persona / outcome / committee role / experience-map
 * node — if one is needed and missing, that becomes a Gap Record. Pure DB; same posture as journeys.ts.
 */
import { db } from './db.js';
import { createJourney, type StoryStep, type SpecialistRule } from './journeys.js';
import { createGapRecord, type GapSeverity } from './gap-records.js';

export interface AssembleInput {
  productId: string;
  outcomeId: string;
  committeeIds?: string[];          // subset of the buying committee to target (default: all)
  organization?: string | null;     // context (stored on the journey; not an asset)
  industry?: string | null;         // context
}
export interface AssembleResult {
  journeyId: string; confidence: number;
  gaps: { id: string; kind: string; title: string; severity: GapSeverity }[];
  storyFlowLen: number;
  assets: { workflows: number; tours: number; knowledge: number; personas: number; committee: number; environment: string | null };
}

const asArr = (v: any): any[] => (Array.isArray(v) ? v : []);
const norm = (s: string | null | undefined) => (s || '').toLowerCase();
const sigWords = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
const overlap = (a: string, b: string): number => { const A = sigWords(a); let n = 0; for (const w of sigWords(b)) if (A.has(w)) n++; return n; };

export async function assembleJourney(input: AssembleInput, actor = 'journey-assembler'): Promise<AssembleResult> {
  const { productId, outcomeId } = input;
  if (!productId || !outcomeId) throw new Error('productId + outcomeId required');

  const prod = (await db().query<{ id: string; name: string; workspace_id: string }>(
    `SELECT id, name, workspace_id FROM products WHERE id = $1`, [productId])).rows[0];
  if (!prod) throw new Error('product not found');
  const outcome = (await db().query<{ id: string; title: string; description: string | null; metric: string | null; baseline: string | null; target: string | null }>(
    `SELECT id, title, description, metric, baseline, target FROM business_outcomes WHERE id = $1 AND product_id = $2 AND archived_at IS NULL`, [outcomeId, productId])).rows[0];
  if (!outcome) throw new Error('outcome not found for product');

  // committee (subset if given, else all)
  const allCommittee = (await db().query<{ id: string; name: string; role: string | null; influence: string | null; decision_authority: string | null; objections: any; decision_criteria: any }>(
    `SELECT id, name, role, influence, decision_authority, objections, decision_criteria FROM product_stakeholders WHERE product_id = $1 AND archived_at IS NULL ORDER BY sort_order, created_at`, [productId])).rows;
  const committee = input.committeeIds?.length ? allCommittee.filter((c) => input.committeeIds!.includes(c.id)) : allCommittee;

  // ── 1. DISCOVER existing assets (validated/non-archived only — consume, never create) ──
  const workflows = (await db().query<any>(
    `SELECT w.id, w.workflow_name AS name, w.business_purpose, w.success_criteria, w.business_outcome_id, w.stakeholder_type, w.persona_type, (w.approved_at IS NOT NULL) AS approved
       FROM demo_graph_workflows w JOIN demo_graphs g ON g.id = w.demo_graph_id
      WHERE g.product_id = $1 AND w.archived_at IS NULL`, [productId])).rows;
  const tours = (await db().query<any>(`SELECT id, name, description, steps FROM demo_tours WHERE product_id = $1 AND archived_at IS NULL`, [productId])).rows;
  const knowledge = (await db().query<any>(
    `SELECT kc.id, kc.content, kc.category, kc.confidence FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
      WHERE kb.product_id = $1 AND kc.archived_at IS NULL AND (kc.lifecycle_state = 'validated' OR kc.validation_status = 'validated')`, [productId])).rows;
  const personas = (await db().query<any>(`SELECT id, name, expertise FROM personas WHERE workspace_id = $1 AND archived_at IS NULL`, [prod.workspace_id]).catch(() => ({ rows: [] as any[] }))).rows;
  const environments = (await db().query<any>(`SELECT id, name, readiness_state, certification_status FROM environments WHERE product_id = $1 AND archived_at IS NULL`, [productId]).catch(() => ({ rows: [] as any[] }))).rows;

  const outcomeText = `${outcome.title} ${outcome.description ?? ''} ${outcome.metric ?? ''}`;
  const committeeText = committee.map((c) => `${c.role ?? ''} ${asArr(c.objections).join(' ')} ${asArr(c.decision_criteria).join(' ')}`).join(' ');
  const committeeRoles = committee.map((c) => norm(c.role ?? '')).filter(Boolean);

  // ── 2. SCORE relevance (deterministic) ──
  const scoredWf = workflows.map((w) => {
    let s = 1;
    if (w.business_outcome_id === outcomeId) s += 4;
    if (w.approved) s += 1;
    const stype = norm(w.stakeholder_type || '');
    if (stype && committeeRoles.some((r) => r && (r.includes(stype) || stype.includes(r)))) s += 1;
    s += Math.min(3, overlap(outcomeText, `${w.name} ${w.business_purpose ?? ''} ${w.success_criteria ?? ''}`));
    return { ...w, score: s };
  }).sort((a, b) => b.score - a.score);
  const scoredTours = tours.map((t) => {
    let s = Math.min(3, overlap(outcomeText, `${t.name} ${t.description ?? ''}`));
    if (Array.isArray(t.steps) && t.steps.length) s += 1;
    return { ...t, score: s };
  }).sort((a, b) => b.score - a.score);
  const scoredK = knowledge.map((k) => ({ ...k, score: overlap(outcomeText, k.content) * 2 + overlap(committeeText, k.content) + (Number(k.confidence) || 0) }))
    .sort((a, b) => b.score - a.score);
  const scoredPersonas = personas.map((p) => ({ ...p, score: overlap(`${outcomeText} ${committeeText}`, `${p.name} ${typeof p.expertise === 'string' ? p.expertise : JSON.stringify(p.expertise ?? '')}`) }))
    .sort((a, b) => b.score - a.score);
  const env = environments.find((e) => norm(e.readiness_state) === 'ready' || norm(e.certification_status) === 'certified') ?? environments[0] ?? null;

  // ── 3. DETECT coverage gaps ──
  const gaps: { kind: string; title: string; detail: string; severity: GapSeverity }[] = [];
  const wfForOutcome = scoredWf.filter((w) => w.business_outcome_id === outcomeId || overlap(outcomeText, `${w.name} ${w.business_purpose ?? ''}`) >= 2);
  const topWf = scoredWf.filter((w) => w.score >= 2);
  if (!workflows.length) gaps.push({ kind: 'workflow', severity: 'blocks', title: `No workflows exist for ${prod.name}`, detail: `A journey needs at least one workflow to demonstrate. Author + approve one in Demo Graphs.` });
  else if (!wfForOutcome.length) gaps.push({ kind: 'workflow', severity: 'blocks', title: `No workflow demonstrates the outcome “${outcome.title}”`, detail: `${workflows.length} workflow(s) exist for ${prod.name} but none is linked to or matches this outcome — link one to this outcome in Demo Graphs.` });
  if (!knowledge.length) gaps.push({ kind: 'knowledge', severity: 'blocks', title: `No validated knowledge for ${prod.name}`, detail: `The journey would have no evidence to cite. Validate knowledge chunks in Knowledge.` });
  if (!committee.length) gaps.push({ kind: 'committee', severity: 'blocks', title: `No buying committee for ${prod.name}`, detail: `Define the committee in Outcomes & Committee.` });
  if (!env) gaps.push({ kind: 'environment', severity: 'weakens', title: `No demo environment for ${prod.name}`, detail: `Configure a demo-ready environment in Environments.` });
  else if (norm(env.readiness_state) !== 'ready' && norm(env.certification_status) !== 'certified') gaps.push({ kind: 'environment', severity: 'weakens', title: `Environment “${env.name}” isn't certified/ready`, detail: `readiness=${env.readiness_state || '—'}, certification=${env.certification_status || '—'}.` });
  if (!outcome.metric && !outcome.target) gaps.push({ kind: 'outcome', severity: 'weakens', title: `Outcome “${outcome.title}” has no measurable metric/target`, detail: `The journey can show the workflow but can't claim a measurable result — add a metric/target to the outcome.` });
  for (const c of committee.filter((c) => norm(c.influence) === 'high')) {
    const objs = asArr(c.objections);
    if (!objs.length) continue;
    const top = String(objs[0]);
    if (!scoredK.some((k) => overlap(top, k.content) >= 2)) gaps.push({ kind: 'knowledge', severity: 'weakens', title: `No evidence addresses ${c.role || c.name}'s top concern`, detail: `“${top.slice(0, 120)}” — add validated knowledge that answers it.` });
  }
  if (personas.length && !scoredPersonas.some((p) => p.score > 0)) gaps.push({ kind: 'persona', severity: 'weakens', title: `No specialist clearly matches this committee/outcome`, detail: `The journey will fall back to the default specialist — tune a persona's expertise to this audience.` });
  else if (!personas.length) gaps.push({ kind: 'persona', severity: 'weakens', title: `No specialists (personas) configured`, detail: `Configure AI specialists in Personas.` });

  // ── 5. ASSEMBLE story_flow (ordered REFS to existing assets; 'note' steps are journey-internal narration) ──
  const story: StoryStep[] = [];
  const committeeSummary = committee.length ? committee.map((c) => c.role || c.name).slice(0, 4).join(', ') : 'the buying committee';
  story.push({ kind: 'note', refId: null, caption: `Frame for ${committeeSummary} — target outcome: ${outcome.title}.` });
  const introK = scoredK.filter((k) => k.score > 0).slice(0, 1);
  for (const k of introK) story.push({ kind: 'knowledge', refId: k.id, caption: `Context: ${outcome.title}` });
  for (const w of (wfForOutcome.length ? wfForOutcome : topWf).slice(0, 2)) story.push({ kind: 'workflow', refId: w.id, caption: `Demonstrate: ${w.name}` });
  for (const t of scoredTours.filter((t) => t.score > 0).slice(0, 1)) story.push({ kind: 'tour', refId: t.id, caption: `Guided tour: ${t.name}` });
  for (const k of scoredK.filter((k) => k.score > 0 && !introK.some((i) => i.id === k.id)).slice(0, 2)) story.push({ kind: 'knowledge', refId: k.id, caption: `Evidence` });
  story.push({ kind: 'note', refId: null, caption: outcome.target ? `Close on the measurable result: ${[outcome.metric, outcome.target].filter(Boolean).join(' → ')}.` : `Close on ${outcome.title}.` });

  // ── 6. SCORE confidence (coverage-based, deterministic + explainable) ──
  let confidence = 100;
  for (const g of gaps) confidence -= g.severity === 'blocks' ? 22 : 7;
  if (!story.some((s) => s.kind === 'workflow')) confidence -= 20;     // a journey with nothing to demonstrate is weak
  if (!story.some((s) => s.kind === 'knowledge')) confidence -= 8;
  confidence = Math.max(0, Math.min(100, confidence));

  // ── CREATE the draft journey (the ONLY artifacts the assembler writes: this journey + the gap records) ──
  const specialistRules: SpecialistRule[] = scoredPersonas.filter((p) => p.score > 0).slice(0, 2).map((p) => ({ personaId: p.id, personaName: p.name, note: 'matched to committee + outcome by the assembler' }));
  const { journeyId } = await createJourney(productId, {
    name: `Assembled — ${outcome.title}`,
    businessGoal: outcome.title,
    businessOutcomeId: outcomeId,
    environmentId: env?.id ?? null,
    storyFlow: story,
    stakeholderRefs: committee.map((c) => c.id),
    specialistRules,
    successCriteria: outcome.target ? [outcome.metric, outcome.target].filter(Boolean).join(' → ') : (outcome.metric ?? null),
    status: 'draft',
    owner: actor,
  }, actor);

  await db().query(
    `UPDATE journeys SET confidence = $2, assembled_inputs = $3::jsonb WHERE id = $1`,
    [journeyId, confidence, JSON.stringify({
      organization: input.organization ?? null, industry: input.industry ?? null, outcomeId,
      committee: committee.map((c) => ({ id: c.id, role: c.role })),
      assets: { workflows: workflows.length, tours: tours.length, knowledge: knowledge.length, personas: personas.length, environment: env?.id ?? null },
    })]);

  // ── 4. PERSIST gap records (first-class; never invent the missing artifact) ──
  const persisted: { id: string; kind: string; title: string; severity: GapSeverity }[] = [];
  for (const g of gaps) {
    const { gapId } = await createGapRecord({ productId, journeyId, outcomeId, kind: g.kind, title: g.title, detail: g.detail, severity: g.severity }, actor);
    persisted.push({ id: gapId, kind: g.kind, title: g.title, severity: g.severity });
  }

  return {
    journeyId, confidence, gaps: persisted, storyFlowLen: story.length,
    assets: { workflows: workflows.length, tours: tours.length, knowledge: knowledge.length, personas: personas.length, committee: committee.length, environment: env?.id ?? null },
  };
}
