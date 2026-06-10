/**
 * Personas as RUNTIME specialists (not decorative cards). A persona is a delegated mode of the one
 * VIN consultant — a system-prompt OVERLAY + hard guardrails injected into the existing loop. No new
 * agent, no new graph. The flexible config lives in personas.definition (jsonb); `status` gates
 * activation (only 'approved' personas can drive a demo).
 */
import { db } from './db.js';

/** HOW a specialist communicates — materially shapes generated answers (tone/length/depth/etc.). */
export interface CommunicationStyle {
  tone: string;            // strategic | analytical | consultative | …
  verbosity: string;       // concise | balanced | detailed
  technicalDepth: string;  // low | medium | high
  questionFrequency: string; // low | medium | high (how often it asks back)
  storytelling: boolean;   // frames with concrete narrative/examples
  challengeAssumptions: boolean; // pushes back / probes vs. accepts the premise
  teachingStyle: string;   // direct | socratic | example-led | …
}
/** A rehearsed response shape for a recurring objection — the SAME objection answered the specialist's way. */
export interface ObjectionEntry { objection: string; response: string[]; }
/** When another specialist is better suited (topic → persona NAME). Drives a hand-off SUGGESTION. */
export interface HandoffCondition { topic: string; toPersona: string; }
export type ParticipationMode = 'passive' | 'reactive' | 'collaborative' | 'proactive';
/** Per-band behavior text for graded confidence (high/medium/low/very_low). */
export interface ConfidencePolicy { high: string; medium: string; low: string; veryLow: string; }
/** When the specialist must cite its source. */
export type CitationPolicy = 'always' | 'when_uncertain' | 'never';
/** A machine-enforceable behavioral guardrail (Behavior governance): if the turn touches `category`,
 *  apply `action`. Replaces relying on prose alone. e.g. {category:'pricing', restriction:'no_binding_quotes', action:'escalate'}. */
export interface GovernanceRule { category: string; restriction: string; action: 'escalate' | 'block' | 'warn'; }

export interface Persona {
  id: string;
  name: string;
  status: string;
  scope: string;
  limits: string;
  systemPrompt: string;
  expertiseDomains: string[];
  hardGuardrails: string[];
  allowedActions: string[];
  prohibitedActions: string[];
  escalationRules: string[];
  confidenceThreshold: number | null;
  voiceProfileId: string | null;
  // ── Human-level specialist layers (cognition · interaction · relationships) ──
  mentalModels: string[];               // how it THINKS (systems_thinking, roi_evaluation, …)
  traits: string[];                     // who it IS (skeptical, precise, outcome_driven, …)
  conversationStrategy: string[];       // ordered dialogue steps it drives the meeting through
  communicationStyle: CommunicationStyle | null; // HOW it talks
  decisionFramework: string[];          // ordered criteria it evaluates recommendations against
  objectionPlaybook: ObjectionEntry[];  // HOW it answers recurring pushback
  knowledgePriority: string[];          // ordered source classes (re-ranks retrieval)
  participationMode: ParticipationMode; // passive | reactive | collaborative | proactive
  handoffConditions: HandoffCondition[];// topic → better specialist
  confidencePolicy: ConfidencePolicy | null; // per-band behavior
  // ── Governance ──
  version: number;                      // identity governance — prompt/config version (audited per turn)
  owner: string | null;
  approver: string | null;
  approvalDate: string | null;
  citationPolicy: CitationPolicy;       // knowledge governance — when this specialist must cite
  governanceRules: GovernanceRule[];    // behavior governance — structured, machine-enforced
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : d);
const bool = (v: unknown): boolean => v === true;
const PARTICIPATION: ParticipationMode[] = ['passive', 'reactive', 'collaborative', 'proactive'];

function parseCommStyle(v: any): CommunicationStyle | null {
  if (!v || typeof v !== 'object') return null;
  return {
    tone: str(v.tone), verbosity: str(v.verbosity, 'balanced'), technicalDepth: str(v.technicalDepth, 'medium'),
    questionFrequency: str(v.questionFrequency, 'medium'), storytelling: bool(v.storytelling),
    challengeAssumptions: bool(v.challengeAssumptions), teachingStyle: str(v.teachingStyle, 'direct'),
  };
}
function parseObjections(v: unknown): ObjectionEntry[] {
  if (!Array.isArray(v)) return [];
  return v.map((o: any) => ({ objection: str(o?.objection), response: arr(o?.response) })).filter((o) => o.objection && o.response.length);
}
function parseHandoffs(v: unknown): HandoffCondition[] {
  if (!Array.isArray(v)) return [];
  return v.map((h: any) => ({ topic: str(h?.topic), toPersona: str(h?.toPersona) })).filter((h) => h.topic && h.toPersona);
}
function parseConfidencePolicy(v: any): ConfidencePolicy | null {
  if (!v || typeof v !== 'object') return null;
  return { high: str(v.high), medium: str(v.medium), low: str(v.low), veryLow: str(v.veryLow ?? v.very_low) };
}
const CITATION: CitationPolicy[] = ['always', 'when_uncertain', 'never'];
const RULE_ACTIONS = ['escalate', 'block', 'warn'];
function parseGovernanceRules(v: unknown): GovernanceRule[] {
  if (!Array.isArray(v)) return [];
  return v.map((r: any) => ({
    category: str(r?.category), restriction: str(r?.restriction),
    action: (RULE_ACTIONS.includes(r?.action) ? r.action : 'escalate') as GovernanceRule['action'],
  })).filter((r) => r.category);
}

/** Load an APPROVED persona by id (null if missing or not approved — we never activate a draft). */
export async function loadPersona(id: string | null | undefined): Promise<Persona | null> {
  if (!id) return null;
  const { rows } = await db().query<{ name: string; status: string; definition: any; version: number; owner: string | null; approver: string | null; approval_date: string | null }>(
    'SELECT name, status, definition, version, owner, approver, approval_date::text AS approval_date FROM personas WHERE id = $1', [id],
  );
  const r = rows[0];
  if (!r || r.status !== 'approved') return null; // Identity governance: only Approved personas activate.
  const d = r.definition ?? {};
  const mode = PARTICIPATION.includes(d.participationMode) ? d.participationMode : 'reactive';
  return {
    id, name: r.name, status: r.status,
    scope: d.scope ?? '', limits: d.limits ?? '',
    systemPrompt: d.systemPrompt ?? '',
    expertiseDomains: arr(d.expertiseDomains),
    hardGuardrails: arr(d.hardGuardrails),
    allowedActions: arr(d.allowedActions),
    prohibitedActions: arr(d.prohibitedActions),
    escalationRules: arr(d.escalationRules),
    confidenceThreshold: typeof d.confidenceThreshold === 'number' ? d.confidenceThreshold : null,
    voiceProfileId: d.voiceProfileId ?? null,
    mentalModels: arr(d.mentalModels),
    traits: arr(d.traits),
    conversationStrategy: arr(d.conversationStrategy),
    communicationStyle: parseCommStyle(d.communicationStyle),
    decisionFramework: arr(d.decisionFramework),
    objectionPlaybook: parseObjections(d.objectionPlaybook),
    knowledgePriority: arr(d.knowledgePriority),
    participationMode: mode,
    handoffConditions: parseHandoffs(d.handoffConditions),
    confidencePolicy: parseConfidencePolicy(d.confidencePolicy),
    version: typeof r.version === 'number' ? r.version : 1,
    owner: r.owner ?? null,
    approver: r.approver ?? null,
    approvalDate: r.approval_date ?? null,
    citationPolicy: (CITATION.includes(d.citationPolicy) ? d.citationPolicy : 'when_uncertain') as CitationPolicy,
    governanceRules: parseGovernanceRules(d.governanceRules),
  };
}

const humanize = (s: string): string => s.replace(/[_-]+/g, ' ').trim();
const PARTICIPATION_GUIDANCE: Record<ParticipationMode, string> = {
  passive: 'Answer only what is asked; do not volunteer beyond the question.',
  reactive: 'Answer the question well; add a brief relevant point only when it clearly helps.',
  collaborative: 'Engage as a partner: connect your answer to what others in the room have raised, and invite the next step.',
  proactive: 'Lead: proactively connect the answer to earlier stakeholder concerns by name, surface what they will care about next, and steer toward the business outcome.',
};

/** The system-prompt overlay injected when a specialist is active — now a full "specialist brain":
 *  identity → cognition (mental models) → conversation strategy → communication style + traits →
 *  decision framework → objection playbook → participation → HARD limits. All deterministic, from the
 *  persona's stored config. Empty string when no persona (the lead consultant runs unmodified). */
export function personaPreamble(p: Persona | null): string {
  if (!p) return '';
  const L: string[] = [
    `You are operating as the "${p.name}" specialist — a delegated, focused mode of the one VIN consultant (same engine). Speak and reason as a senior ${p.name}, naturally, as if in a live enterprise meeting.`,
  ];
  if (p.systemPrompt) L.push(p.systemPrompt);
  if (p.expertiseDomains.length) L.push(`Expertise: ${p.expertiseDomains.join(', ')}.`);
  if (p.scope) L.push(`Scope: ${p.scope}.`);
  // Cognition — how this specialist THINKS (shapes how it frames and prioritizes).
  if (p.mentalModels.length) L.push(`Think through these mental models: ${p.mentalModels.map(humanize).join(', ')}.`);
  if (p.traits.length) L.push(`Embody these traits in every response: ${p.traits.map(humanize).join(', ')}.`);
  // Interaction — how it RUNS the conversation and TALKS.
  if (p.conversationStrategy.length) L.push(`Drive the conversation through this strategy when it fits: ${p.conversationStrategy.map((s, i) => `${i + 1}) ${humanize(s)}`).join('; ')}.`);
  const cs = p.communicationStyle;
  if (cs) {
    const bits = [
      cs.tone && `tone ${cs.tone}`, cs.verbosity && `${cs.verbosity}`, cs.technicalDepth && `${cs.technicalDepth} technical depth`,
      cs.questionFrequency && `${cs.questionFrequency} question frequency`,
      `${cs.storytelling ? 'use' : 'avoid'} storytelling/examples`,
      `${cs.challengeAssumptions ? 'challenge weak assumptions' : 'do not pick fights with the premise'}`,
      cs.teachingStyle && `${cs.teachingStyle} teaching style`,
    ].filter(Boolean);
    if (bits.length) L.push(`Communication style — ${bits.join(', ')}. This MUST materially shape your wording and length.`);
  }
  // Recommendation — the lens it evaluates options through.
  if (p.decisionFramework.length) L.push(`When you assess or recommend, evaluate strictly against: ${p.decisionFramework.map(humanize).join(' → ')}.`);
  // Objection handling — rehearsed, specialist-specific responses.
  if (p.objectionPlaybook.length) {
    L.push('Objection playbook (answer recurring pushback your way):');
    for (const o of p.objectionPlaybook.slice(0, 8)) L.push(`  • "${o.objection}" → ${o.response.map(humanize).join(', ')}.`);
  }
  L.push(PARTICIPATION_GUIDANCE[p.participationMode]);
  // Governance — unchanged hard rails.
  const limits = [...p.hardGuardrails, ...(p.limits ? [p.limits] : [])];
  if (limits.length) L.push(`HARD LIMITS — never violate: ${limits.join(' · ')}.`);
  if (p.prohibitedActions.length) L.push(`Never perform: ${p.prohibitedActions.join(', ')} (escalate instead).`);
  if (p.escalationRules.length) L.push(`Escalate when: ${p.escalationRules.join('; ')}.`);
  if (p.handoffConditions.length) L.push(`If the question is really about ${p.handoffConditions.map((h) => `${humanize(h.topic)} (→ ${h.toPersona})`).join(', ')}, say so and suggest bringing in that specialist rather than guessing.`);
  return L.join('\n');
}

/** Programmatic guardrail: does this persona's prohibited-actions list forbid acting on `text`?
 *  Returns the matched prohibited token (so the gate can explain), or null. This is enforced in the
 *  /agent/step gate IN ADDITION to the prompt — a specialist's hard limits can't be talked around by
 *  the LLM. Matching is verb/substring based (e.g. prohibited "submit" blocks a "Submit request" button). */
export function personaForbids(p: Persona | null, text: string | null | undefined): string | null {
  if (!p || !p.prohibitedActions.length || !text) return null;
  const t = text.toLowerCase();
  for (const a of p.prohibitedActions) {
    const tok = a.trim().toLowerCase();
    if (tok && t.includes(tok)) return a;
  }
  return null;
}

/** Execution governance (positive allowlist): may this persona act on a control labelled `text`?
 *  `allowedActions` is a WHITELIST — when non-empty, a (confirmed-mutating) control is permitted only
 *  if its label contains one of the allowed tokens. EMPTY allowlist ⇒ true (no positive constraint;
 *  the action is then governed by session mode + the prohibited list alone). No persona ⇒ true.
 *  This is the persona half of the /agent/step gate — paired with `permits(cls, mode)` (the mode half),
 *  BOTH must allow before a confirmed mutating action fires (CLAUDE.md §4 default-deny). */
export function personaPermitsAction(p: Persona | null, text: string | null | undefined): boolean {
  if (!p || !p.allowedActions.length) return true; // no whitelist → governed by mode + prohibited alone
  if (!text) return false;                          // a whitelist exists but nothing to match → deny
  const t = text.toLowerCase();
  return p.allowedActions.some((a) => { const tok = a.trim().toLowerCase(); return !!tok && t.includes(tok); });
}

/** Collaboration intelligence: does the utterance fall under one of this specialist's hand-off
 *  conditions (a topic better served by another specialist)? Returns the matched condition so the
 *  consultant can SUGGEST bringing that specialist in (the operator confirms — no auto agent-switch). */
export function handoffSuggestionFor(p: Persona | null, text: string | null | undefined): HandoffCondition | null {
  if (!p || !p.handoffConditions.length || !text) return null;
  const t = text.toLowerCase();
  for (const h of p.handoffConditions) {
    const topic = h.topic.toLowerCase();
    const words = topic.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    if (t.includes(topic) || words.some((w) => t.includes(w))) return h;
  }
  return null;
}

/** Record a real hand-off event (the metric + audit source). Best-effort; never throws into the loop. */
export async function recordHandoff(sessionId: string | null, fromId: string | null, toId: string | null, trigger: string): Promise<void> {
  if (!sessionId) return;
  try {
    await db().query(
      'INSERT INTO persona_handoff_events (demo_session_id, from_persona_id, to_persona_id, trigger) VALUES ($1, $2, $3, $4)',
      [sessionId, fromId, toId, trigger],
    );
  } catch (e) { console.error('[persona] recordHandoff failed (best-effort, demo continues) — the hand-off metric will under-count:', e); }
}
