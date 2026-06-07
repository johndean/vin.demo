/**
 * Personas as RUNTIME specialists (not decorative cards). A persona is a delegated mode of the one
 * VIN consultant — a system-prompt OVERLAY + hard guardrails injected into the existing loop. No new
 * agent, no new graph. The flexible config lives in personas.definition (jsonb); `status` gates
 * activation (only 'approved' personas can drive a demo).
 */
import { db } from './db.js';

export interface Persona {
  id: string;
  name: string;
  status: string;
  scope: string;
  limits: string;
  systemPrompt: string;
  expertiseDomains: string[];
  retrievalFilters: string[];
  hardGuardrails: string[];
  allowedActions: string[];
  prohibitedActions: string[];
  escalationRules: string[];
  confidenceThreshold: number | null;
  voiceProfileId: string | null;
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

/** Load an APPROVED persona by id (null if missing or not approved — we never activate a draft). */
export async function loadPersona(id: string | null | undefined): Promise<Persona | null> {
  if (!id) return null;
  const { rows } = await db().query<{ name: string; status: string; definition: any }>(
    'SELECT name, status, definition FROM personas WHERE id = $1', [id],
  );
  const r = rows[0];
  if (!r || r.status !== 'approved') return null;
  const d = r.definition ?? {};
  return {
    id, name: r.name, status: r.status,
    scope: d.scope ?? '', limits: d.limits ?? '',
    systemPrompt: d.systemPrompt ?? '',
    expertiseDomains: arr(d.expertiseDomains),
    retrievalFilters: arr(d.retrievalFilters),
    hardGuardrails: arr(d.hardGuardrails),
    allowedActions: arr(d.allowedActions),
    prohibitedActions: arr(d.prohibitedActions),
    escalationRules: arr(d.escalationRules),
    confidenceThreshold: typeof d.confidenceThreshold === 'number' ? d.confidenceThreshold : null,
    voiceProfileId: d.voiceProfileId ?? null,
  };
}

/** The system-prompt overlay injected when a specialist is active — name, scope, expertise, and the
 *  HARD limits the specialist must never violate. Empty string when no persona (the lead consultant). */
export function personaPreamble(p: Persona | null): string {
  if (!p) return '';
  const lines: string[] = [
    `You are now operating as the "${p.name}" specialist — a delegated mode of the VIN consultant (same engine, focused frame).`,
  ];
  if (p.systemPrompt) lines.push(p.systemPrompt);
  if (p.expertiseDomains.length) lines.push(`Your expertise: ${p.expertiseDomains.join(', ')}.`);
  if (p.scope) lines.push(`Scope: ${p.scope}. Stay within it; if asked clearly outside it, say you'll bring the lead consultant back rather than guess.`);
  const limits = [...p.hardGuardrails, ...(p.limits ? [p.limits] : [])];
  if (limits.length) lines.push(`HARD LIMITS — never violate: ${limits.join(' · ')}.`);
  if (p.prohibitedActions.length) lines.push(`Never perform: ${p.prohibitedActions.join(', ')} (escalate instead).`);
  if (p.escalationRules.length) lines.push(`Escalate when: ${p.escalationRules.join('; ')}.`);
  lines.push(`Answer in this specialist's voice and focus.`);
  return lines.join('\n');
}

/** Record a real hand-off event (the metric + audit source). Best-effort; never throws into the loop. */
export async function recordHandoff(sessionId: string | null, fromId: string | null, toId: string | null, trigger: string): Promise<void> {
  if (!sessionId) return;
  try {
    await db().query(
      'INSERT INTO persona_handoff_events (demo_session_id, from_persona_id, to_persona_id, trigger) VALUES ($1, $2, $3, $4)',
      [sessionId, fromId, toId, trigger],
    );
  } catch { /* metric is best-effort; never break a demo over it */ }
}
