/**
 * Journey-aware evaluation framework (V5 Guided Experience Platform, Phase 5). The metrics the constitution
 * asks for — journey success, outcome success, specialist accuracy, decision readiness — computed from REAL
 * telemetry (journey_runs / audit_turns) + the registries. HONEST BY CONSTRUCTION (Rule #3): each returns a
 * `null` rate + a "no telemetry yet" note when nothing has run, and is explicit about what still needs a
 * not-yet-captured signal (e.g. true domain correctness, outcome-metric movement, in-demo criteria coverage).
 * It NEVER fabricates a success score. Pure DB; no new table. Used by eval-phase22 + available to the console.
 */
import { db } from './db.js';

export interface JourneySuccess { runs: number; completed: number; aborted: number; completionRate: number | null; note: string }
/** Journey success = run completion from journey_runs (the objective signal). success_criteria "met" is a
 *  qualitative call that needs a post-demo signal we don't capture yet — stated honestly. */
export async function journeySuccess(filter: { productId?: string; journeyId?: string } = {}): Promise<JourneySuccess> {
  const p: any[] = []; const where: string[] = [];
  if (filter.productId) { p.push(filter.productId); where.push(`product_id=$${p.length}`); }
  if (filter.journeyId) { p.push(filter.journeyId); where.push(`journey_id=$${p.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = (await db().query<{ runs: number; completed: number; aborted: number }>(
    `SELECT count(*)::int runs, count(*) FILTER (WHERE status='completed')::int completed, count(*) FILTER (WHERE status='aborted')::int aborted FROM journey_runs ${w}`, p)).rows[0];
  const finished = r.completed + r.aborted;
  return { runs: r.runs, completed: r.completed, aborted: r.aborted,
    completionRate: finished > 0 ? Math.round((r.completed / finished) * 100) : null,
    note: r.runs === 0 ? 'no run telemetry yet — run journeys to populate' : 'completion is the objective signal; success_criteria "met" needs a post-demo signal not yet captured' };
}

export interface SpecialistAccuracy { turns: number; grounded: number; cited: number; groundingRate: number | null; citationRate: number | null; note: string }
/** Specialist accuracy proxy = grounding (answers backed by knowledge) + citation compliance, from audit_turns.
 *  True domain correctness needs human grading — stated honestly; this is the objective, auto-measurable proxy. */
export async function specialistAccuracy(personaId?: string): Promise<SpecialistAccuracy> {
  const p: any[] = []; let w = '';
  if (personaId) { p.push(personaId); w = `WHERE persona_id=$1`; }
  const r = (await db().query<{ turns: number; grounded: number; cited: number }>(
    `SELECT count(*)::int turns,
            count(*) FILTER (WHERE jsonb_array_length(knowledge_used)>0)::int grounded,
            count(*) FILTER (WHERE jsonb_array_length(citations)>0)::int cited
       FROM audit_turns ${w}`, p)).rows[0];
  return { turns: r.turns, grounded: r.grounded, cited: r.cited,
    groundingRate: r.turns > 0 ? Math.round((r.grounded / r.turns) * 100) : null,
    citationRate: r.turns > 0 ? Math.round((r.cited / r.turns) * 100) : null,
    note: r.turns === 0 ? 'no turn telemetry yet' : 'grounding + citation compliance are the objective proxies; true domain correctness needs human grading' };
}

export interface OutcomeSuccess { outcomes: number; withTarget: number; measured: number; note: string }
/** Outcome success — achievement is NOT auto-measured (no product signal is wired to read metric movement);
 *  withTarget = how many outcomes are READY to be measured (have a target). Honest: measured stays 0 until a
 *  real post-demo signal exists. */
export async function outcomeSuccess(productId?: string): Promise<OutcomeSuccess> {
  const p: any[] = []; let w = 'WHERE archived_at IS NULL';
  if (productId) { p.push(productId); w += ` AND product_id=$1`; }
  const r = (await db().query<{ outcomes: number; with_target: number }>(
    `SELECT count(*)::int outcomes, count(*) FILTER (WHERE target IS NOT NULL AND target <> '')::int with_target FROM business_outcomes ${w}`, p)).rows[0];
  return { outcomes: r.outcomes, withTarget: r.with_target, measured: 0,
    note: r.outcomes === 0 ? 'no outcomes defined' : 'achievement is not auto-measured (no product signal wired); withTarget = outcomes ready to measure' };
}

export interface DecisionReadiness { committee: number; withCriteria: number; journeysForCommittee: number; note: string }
/** Decision readiness — structural signals only: committee members with decision criteria + journeys that
 *  target the committee. Whether those criteria were actually ADDRESSED in a demo needs a per-turn topic
 *  signal we don't capture yet — stated honestly. */
export async function decisionReadiness(productId: string): Promise<DecisionReadiness> {
  const c = (await db().query<{ committee: number; with_criteria: number }>(
    `SELECT count(*)::int committee, count(*) FILTER (WHERE jsonb_array_length(decision_criteria)>0)::int with_criteria
       FROM product_stakeholders WHERE product_id=$1 AND archived_at IS NULL`, [productId])).rows[0];
  const j = (await db().query<{ n: number }>(
    `SELECT count(*)::int n FROM journeys WHERE product_id=$1 AND archived_at IS NULL AND jsonb_array_length(stakeholder_refs)>0`, [productId])).rows[0];
  return { committee: c.committee, withCriteria: c.with_criteria, journeysForCommittee: j.n,
    note: c.committee === 0 ? 'no committee defined' : 'criteria-addressed-in-demo needs a per-turn topic signal not yet captured; withCriteria + journeysForCommittee are the structural readiness signals' };
}
