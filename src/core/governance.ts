/**
 * Governance — the enterprise control framework around the one loop. Four ORDERED layers that all must
 * pass before a substantive response/action: Identity (persona approved+versioned — gated in loadPersona),
 * Knowledge (retrieval band + citation policy), Behavior (structured machine-enforced guardrails), and
 * Execution (persona permission × session mode — enforced in /agent/step). The Compliance Rules Engine
 * (`validateCompliance`) screens the 5 restriction classes BEFORE the answer is generated and DEGRADES on
 * any violation (governed fallback + escalation) rather than emitting an ungoverned answer. Every turn is
 * recorded to `audit_turns` so the meeting is fully reconstructable. Deterministic + auditable.
 */
import { db } from './db.js';
import type { Persona, GovernanceRule } from './persona.js';
import type { ConfidenceBand } from './retrieval.js';

export type ComplianceAction = 'allow' | 'warn' | 'escalate' | 'block';
export type GovLayer = 'identity' | 'knowledge' | 'behavior' | 'execution' | 'customer';
export interface Violation { layer: GovLayer; rule: string; detail: string; action: ComplianceAction; }
export interface ComplianceResult { ok: boolean; action: ComplianceAction; violations: Violation[]; escalateTo: string | null; }

// Restricted-category → trigger terms (Behavior governance matching). Falls back to the category word.
// Matching is WORD-BOUNDARY, not bare substring, so a term embedded in a larger token can't false-fire
// — e.g. "contract" must NOT trip on the product name "modelcontract.software", and "eta" must NOT trip
// on "beta"/"metadata". A trailing '*' marks a STEM (leading boundary + any suffix: 'contract*' →
// contract/contracts/contractual); a plain term is a WHOLE word (both boundaries: 'eta' → "ETA" only).
// (The bare 'sign' term was removed — it tripped "significant"/"signal"; contract intent is still caught
// by 'contract*'/'msa'/'sla'/'commit to'. 'sla'/'msa' are whole-word so they don't trip "slack"/"msated".)
const CATEGORY_TERMS: Record<string, string[]> = {
  pricing: ['pricing', 'price*', 'quote*', 'cost*', 'discount*', 'how much', 'cheaper'],
  legal: ['legal*', 'liability', 'indemnif*', 'warranty', 'terms of service', 'lawsuit*'],
  contract: ['contract*', 'commit to', 'sla', 'msa', 'terms'],
  security_guarantee: ['guarantee*', '100% secure', 'unhackable', 'fully secure', 'completely safe'],
  roadmap: ['roadmap*', 'future release*', 'when will you', 'eta', 'upcoming', 'next version'],
  compliance: ['hipaa', 'soc 2', 'soc2', 'gdpr', 'iso 27001', 'certif*', 'audit requirement*'],
  custom_development: ['custom development', 'build us', 'bespoke', 'customiz*'],
};
/** Word-boundary matcher. '*' suffix ⇒ stem (leading boundary only); else whole word (both boundaries). */
function termMatches(term: string, lowerText: string): boolean {
  const stem = term.endsWith('*');
  const core = (stem ? term.slice(0, -1) : term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!core) return false;
  return new RegExp(`\\b${core}${stem ? '' : '\\b'}`).test(lowerText); // lowerText is pre-lowercased
}
function categoryHit(category: string, text: string): boolean {
  const t = text.toLowerCase();
  const terms = CATEGORY_TERMS[category.toLowerCase()] ?? [category.toLowerCase().replace(/_/g, ' ')];
  return terms.some((term) => termMatches(term, t));
}

const RANK: Record<ComplianceAction, number> = { allow: 0, warn: 1, escalate: 2, block: 3 };

/** Behavior governance: which of the persona's structured rules fire for this turn's text. */
export function checkBehavior(rules: GovernanceRule[], text: string): Violation[] {
  return rules.filter((r) => categoryHit(r.category, text)).map((r) => ({
    layer: 'behavior' as const, rule: `${r.category}:${r.restriction || 'restricted'}`,
    detail: `restricted category "${r.category}"${r.restriction ? ` — ${r.restriction}` : ''}`,
    action: r.action as ComplianceAction,
  }));
}

export interface ComplianceCtx {
  persona: Persona | null;
  text: string;          // utterance + intent — what to screen (pre-answer)
  band: ConfidenceBand;
  hasSource: boolean;    // a usable cited source exists for this turn
  isProduction?: boolean;
}
/** The Compliance Rules Engine — validate the 5 restriction classes before final output. Worst action wins. */
export function validateCompliance(ctx: ComplianceCtx): ComplianceResult {
  const v: Violation[] = [];
  const p = ctx.persona;
  // Behavior (persona's structured guardrails).
  if (p) v.push(...checkBehavior(p.governanceRules, ctx.text));
  // Knowledge: 'always' citation but no verified source on a non-refused turn → cannot assert.
  if (p?.citationPolicy === 'always' && !ctx.hasSource && ctx.band !== 'very_low') {
    v.push({ layer: 'knowledge', rule: 'citation:always', detail: 'citation required but no verified source available', action: 'escalate' });
  }
  // Execution + customer restriction classes are enforced at action time in /agent/step (mode × persona
  // permission × prohibited verbs); blocked steps are recorded to audit_turns/escalation there too.
  const action = v.reduce<ComplianceAction>((acc, x) => (RANK[x.action] > RANK[acc] ? x.action : acc), 'allow');
  // Where an escalation should route: the persona's hand-off condition for the fired category, else the lead.
  let escalateTo: string | null = null;
  if (action === 'escalate' && p) {
    const fired = v.find((x) => x.layer === 'behavior');
    const cat = fired?.rule.split(':')[0] ?? '';
    escalateTo = p.handoffConditions.find((h) => h.topic.toLowerCase().includes(cat) || cat.includes(h.topic.toLowerCase()))?.toPersona ?? 'Lead Consultant';
  }
  return { ok: action === 'allow' || action === 'warn', action, violations: v, escalateTo };
}

/** Should this turn cite its source, given the policy + band? (Knowledge governance.) */
export function shouldCite(policy: Persona['citationPolicy'] | undefined, band: ConfidenceBand, hasSource: boolean): boolean {
  if (!hasSource) return false;
  if (policy === 'never') return false;
  if (policy === 'always') return true;
  return band === 'low' || band === 'medium'; // when_uncertain (default)
}

/** Record an escalation (Escalation governance). Resolves the destination persona by name. Best-effort. */
export async function recordEscalation(sessionId: string | null, sourcePersonaId: string | null, destPersonaName: string | null, trigger: string, reason: string): Promise<void> {
  if (!sessionId) return;
  try {
    let destId: string | null = null;
    if (destPersonaName) {
      const { rows } = await db().query<{ id: string }>('SELECT id FROM personas WHERE name = $1 LIMIT 1', [destPersonaName]);
      destId = rows[0]?.id ?? null;
    }
    await db().query(
      'INSERT INTO persona_escalation_events (demo_session_id, source_persona_id, destination_persona_id, trigger, reason) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, sourcePersonaId, destId, trigger, reason],
    );
  } catch (e) { console.error('[governance] recordEscalation failed (best-effort, loop continues):', e); }
}

export interface AuditTurnRow {
  sessionId: string | null;
  personaId: string | null; personaName: string | null; promptVersion: number;
  utterance: string; intent: string;
  knowledgeUsed: unknown[]; citations: unknown[]; confidenceBand: string;
  actionsConsidered: string[]; actionsRejected: string[];
  handoff: unknown | null; escalation: unknown | null; compliance: ComplianceResult;
}
/** Meeting audit trail — one row per turn so the whole meeting is reconstructable. Best-effort. */
export async function recordAuditTurn(r: AuditTurnRow): Promise<void> {
  if (!r.sessionId) return;
  try {
    await db().query(
      `INSERT INTO audit_turns
         (demo_session_id, persona_id, persona_name, prompt_version, utterance, intent, knowledge_used,
          citations, confidence_band, actions_considered, actions_rejected, handoff, escalation, compliance)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb)`,
      [
        r.sessionId, r.personaId, r.personaName, r.promptVersion, r.utterance, r.intent,
        JSON.stringify(r.knowledgeUsed ?? []), JSON.stringify(r.citations ?? []), r.confidenceBand,
        JSON.stringify(r.actionsConsidered ?? []), JSON.stringify(r.actionsRejected ?? []),
        r.handoff ? JSON.stringify(r.handoff) : null, r.escalation ? JSON.stringify(r.escalation) : null,
        JSON.stringify(r.compliance ?? {}),
      ],
    );
  } catch (e) { console.error('[governance] recordAuditTurn failed (best-effort, loop continues) — the audit/dashboard will under-report this turn:', e); }
}
