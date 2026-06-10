/**
 * Specialist network metrics (V5 Guided Experience Platform, Phase 3). REAL metrics rolled up from event
 * tables that ALREADY exist — no new instrumentation, no new table (Rule #2/#3). Per persona (specialists are
 * workspace-scoped, so metrics are global across sessions):
 *   • turns       — audit_turns answered by this specialist.
 *   • handoffsIn  — persona_handoff_events where it was the destination.
 *   • handoffsOut — persona_handoff_events where it was the source.
 *   • escalations — persona_escalation_events it raised.
 * Telemetry-gated: a specialist with no events simply has zeros (the console shows "Not yet observed"). Pure DB.
 */
import { db } from './db.js';

export interface SpecialistMetric { personaId: string; turns: number; handoffsIn: number; handoffsOut: number; escalations: number }

export async function specialistMetrics(): Promise<Record<string, SpecialistMetric>> {
  const out: Record<string, SpecialistMetric> = {};
  const ensure = (id: string) => (out[id] ??= { personaId: id, turns: 0, handoffsIn: 0, handoffsOut: 0, escalations: 0 });
  for (const r of (await db().query<{ id: string; n: string }>(
    `SELECT persona_id id, count(*)::text n FROM audit_turns WHERE persona_id IS NOT NULL GROUP BY persona_id`)).rows) ensure(r.id).turns = +r.n;
  for (const r of (await db().query<{ id: string; n: string }>(
    `SELECT to_persona_id id, count(*)::text n FROM persona_handoff_events WHERE to_persona_id IS NOT NULL GROUP BY to_persona_id`)).rows) ensure(r.id).handoffsIn = +r.n;
  for (const r of (await db().query<{ id: string; n: string }>(
    `SELECT from_persona_id id, count(*)::text n FROM persona_handoff_events WHERE from_persona_id IS NOT NULL GROUP BY from_persona_id`)).rows) ensure(r.id).handoffsOut = +r.n;
  for (const r of (await db().query<{ id: string; n: string }>(
    `SELECT source_persona_id id, count(*)::text n FROM persona_escalation_events WHERE source_persona_id IS NOT NULL GROUP BY source_persona_id`)).rows) ensure(r.id).escalations = +r.n;
  return out;
}
