/* Console data CONTRACT (client-safe). Real values come from the DB via lib/console-data.ts
   (server) and are provided through DataProvider/useData. EMPTY_VD is the fallback so a DB
   outage renders honest empty states — never fabricated data. */

export interface ProductRow {
  id: string; name: string; domain: string; tagline: string;
  version: string; versions: string[]; mk: string; color: string; status: string; archived: boolean;
  coverage: number; chunks: number; demos: number; readiness: number;
  kbValidated: number; kbReview: number; kbStale: number;
  env: string; envStatus: string; lastReset: string; graphNodes: number; graphFlows: number; graphNodeLabels: string[];
  graphNodeStates: GraphNode[]; // Node Studio: full per-node inspector payload (label/status/type kept for graph colouring)
  graphStatus: string | null; graphVersion: number | null; graphCoverage: number | null; graphBroken: number; // demo-graph truth (Phase A/C)
  coverageEval: { passed: number; total: number } | null; // latest per-product coverage eval run (evidence-backed)
  draftGraph: { id: string; name: string; nodes: number; pending: number } | null; // publishable draft autogen graph
  draftNodesDetail?: DraftSitemapNode[]; // Discover-draft node detail (active⇄draft toggle in the Demo Graphs view)
  activeGraphId: string | null; // active demo-graph id the Workflow Builder authors onto
  activeVersionId: string | null; // active product_version id (used to plan a session)
  workflows: WorkflowRow[]; // active graph's demo journeys (Workflow Builder)
  defaultMode: string; // per-site default execution mode (read-only|safe|approval|execution)
  envId: string | null; connectionTarget: string; isProduction: boolean; resetMechanism: string; refreshCadence: string; seedDataset: string;
  room: RoomMemberRow[]; // scripted demo-room roster (named people the reel/convo address; live seeds none)
  intentMap: IntentMapRow[]; // empirical intent→node registry (Phase 3), built from navigation_attempts
  graphVersions: GraphVersionRow[]; // Phase 4: active/deprecated graph versions (Versions panel + rollback)
  navObserved: number; graphEventsCount: number; // Phase 4 readiness signals
  authorityReadiness: AuthorityReadiness | null; // Phase 4: the navigation-authority promotion gate (computed)
  committee: CommitteeMemberRow[]; // V5 Phase 1: buying-committee Stakeholder Registry (criteria/goals/objections/questions)
  outcomes: OutcomeRow[]; // V5 Phase 1: Business Outcome Registry (first-class, governed)
  stakeholderRelationships: StakeholderRelationshipRow[]; // V5 Phase 1: influence-graph edges between committee members
  journeys: JourneyRow[]; // V5 Phase 2: the orchestration layer — story_flow refs resolved + reference-integrity flagged
  gaps: GapRecordRow[]; // V5 Journey Assembler (0025): persisted missing-dependency records (not invented)
  // V5 Phase 3 — environment execution context + computed readiness gate + knowledge-usage telemetry.
  certificationStatus: string; verificationState: string; seedVersion: string; dataVersion: string; readinessState: string;
  knownIssues: KnownIssueRow[]; envReadiness: EnvReadinessRow; knowledgeGroundedTurns: number;
}
// Phase 4 — a graph version row (for the Versions panel + rollback + blast-radius).
export interface GraphVersionRow { id: string; name: string; version: number; status: string; coverage: number | null; verifiedAt: string | null; nodes: number; workflows: number }
// Phase 4 — the Navigation-Authority Readiness gate (the constitution's promotion checklist, computed from real signals).
export interface AuthorityGate { name: string; ok: boolean; detail: string }
export interface AuthorityReadiness { gates: AuthorityGate[]; passed: number; total: number; ready: boolean }
export interface RoomMemberRow { id: string; name: string; role: string; interests: string[]; influence: string; riskLevel: string; decisionAuthority: string }
// V5 Phase 1 — Business Outcome Registry (first-class, governed) + the buying-committee Stakeholder Registry
// + the influence graph. NOTE: outcome/committee data is telemetry-gated — empty until an operator authors it.
export interface OutcomeRow { id: string; title: string; description: string; metric: string; baseline: string; target: string; stakeholderType: string; status: string; version: number; owner: string }
export interface CommitteeMemberRow { id: string; name: string; role: string; interests: string[]; influence: string; riskLevel: string; decisionAuthority: string; decisionCriteria: string[]; goals: string[]; objections: string[]; questions: string[]; sortOrder: number }
export interface StakeholderRelationshipRow { id: string; from: string; to: string; relation: string; weight: string }
// V5 Phase 2 — the Journey orchestration object. story_flow refs are RESOLVED at read time to real assets
// (workflow/tour/knowledge/note); a dangling ref is flagged ok=false (integrityOk/missingCount), never dropped.
// runs/runsDone come from journey_runs telemetry (0 until a journey is walked — never fabricated).
export interface ResolvedStoryStep { kind: string; refId: string | null; caption: string; label: string; ok: boolean; reason: string }
export interface SpecialistRuleRow { personaId?: string | null; personaName?: string | null; note?: string | null }
// V5 Journey Assembler (0025) — a persisted Gap Record: an upstream dependency the assembler needed but couldn't find.
export interface GapRecordRow { id: string; kind: string; title: string; detail: string; severity: string; status: string; outcomeId: string; journeyId: string }
export interface JourneyRow {
  id: string; name: string; businessGoal: string; businessOutcomeId: string | null; outcomeTitle: string;
  environmentId: string | null; storyFlow: ResolvedStoryStep[]; stakeholderRefs: string[]; stakeholderNames: string[];
  specialistRules: SpecialistRuleRow[]; successCriteria: string; status: string; version: number;
  runs: number; runsDone: number; missingCount: number; integrityOk: boolean; confidence: number | null;
}
// V5 Phase 3 — network extensions. Environment execution-context readiness gate (mirrors the graph one),
// known issues, and the specialist-network metrics rolled up from existing event tables (telemetry-gated).
export interface EnvReadinessRow { gates: { name: string; ok: boolean; detail: string }[]; passed: number; total: number; ready: boolean }
export interface KnownIssueRow { title: string; detail: string }
export interface SpecialistMetricsRow { turns: number; handoffsIn: number; handoffsOut: number; escalations: number; journeys: number }
// A demo journey across the graph's verified screens. status = TECHNICAL (node reachability roll-up);
// approved = EDITORIAL gate (the live consultant only walks approved journeys).
export interface WorkflowRow { id: string; name: string; purpose: string; stakeholderType: string; personaType: string; sequence: string[]; successCriteria: string; stepScript: Record<string, string>; status: string; approved: boolean; sortOrder: number }
// A workflow that consumes a node (computed from node_sequence containment) — the dependency-registry edge.
export interface NodeConsumer { id: string; name: string; approved: boolean; stakeholderType: string; personaType: string }
// Node Studio (V3.2 Experience Registry): the full per-node inspector payload — all REAL stored data.
export interface GraphNode {
  id: string; label: string; status: string; type: string;
  screenName: string; route: string; businessPurpose: string; businessOutcome: string;
  evidence: string; sourceChunkId: string | null; sourceTitle: string;          // provenance: why this node exists
  verificationSource: string; lastVerified: string | null; pageVersion: string;  // verification: how/when
  permissions: string[]; personaLabels: Record<string, string>; locators: any[]; // navigation
  createdBy: string; createdAt: string | null; updatedBy: string; updatedAt: string | null; // authorship
  consumers: NodeConsumer[];                                                      // dependency: who uses me (workflows)
  history: { action: string; actor: string; at: string | null }[];               // graph_events change history
  navAttempts: NavAttemptRow[];                                                   // Phase 2: recent navigation attempts (Diagnostics)
  usage: { attempts: number; observed: number; succeeded: number; successRate: number | null; lastAt: string | null }; // Phase 3 computed usage — successRate null until observed outcomes exist
  resolvingIntents: string[];                                                     // intents whose PRIMARY resolved node is this one (empirical)
  tourConsumers: { id: string; name: string }[];                                  // best-effort tour links (selector/route match)
  pageFacts?: Record<string, any>;                                                // denormalized page snapshot (purpose/layout/counts/faqs)
  elements?: PageElementRow[];                                                    // the page's element registry (buttons/actions/forms/fields)
}
// A single page element (button/action/field/tab/error/faq) on a node — the per-page UX surface (this session).
export interface PageElementRow { type: string; label: string; detail: Record<string, any>; status: string }
// A draft-graph node preview (Discover draft, pre-publish) — lighter shape for the active⇄draft toggle.
export interface DraftSitemapNode { id: string; label: string; status: string; type: string; screenName: string; route: string; businessPurpose: string; pageFacts: Record<string, any>; elements: PageElementRow[] }
// Phase 2 telemetry surfaced in Node Studio Diagnostics (recent attempts; rates computed in Phase 3).
export interface NavAttemptRow { ok: boolean | null; healedVia: string | null; selector: string | null; source: string; url: string; at: string | null }
// Phase 3 empirical Intent Registry row — built from navigation_attempts (no fabrication).
export interface IntentMapRow { intent: string; node: string; nodeId: string; attempts: number; confidence: number | null; fallback: string | null }
export interface KnowledgeRow { id: string; productId: string; product: string; title: string; content: string; type: string; conf: number; source: string; verified: string; ver: string; status: string; lifecycleState: string; validatedBy: string | null; validatedAt: string | null; sourceOwner: string | null; history: { action: string; actor: string; at: string }[] }
export interface CommunicationStyle { tone: string; verbosity: string; technicalDepth: string; questionFrequency: string; storytelling: boolean; challengeAssumptions: boolean; teachingStyle: string }
export interface ObjectionEntry { objection: string; response: string[] }
export interface HandoffCondition { topic: string; toPersona: string }
export interface ConfidencePolicy { high: string; medium: string; low: string; veryLow: string }
export interface GovernanceRuleRow { category: string; restriction: string; action: string }
export interface PersonaRow {
  id: string; name: string; scope: string; limits: string; calls: number; brand: string; color: string;
  status: string; archived: boolean; role: string; lead: boolean; systemPrompt: string; expertiseDomains: string[]; hardGuardrails: string[];
  allowedActions: string[]; prohibitedActions: string[]; escalationRules: string[];
  confidenceThreshold: number; voiceProfileId: string; productIds: string[];
  // Human-level specialist layers (cognition · interaction · relationships):
  mentalModels: string[]; traits: string[]; conversationStrategy: string[];
  communicationStyle: CommunicationStyle | null; decisionFramework: string[];
  objectionPlaybook: ObjectionEntry[]; knowledgePriority: string[];
  participationMode: string; handoffConditions: HandoffCondition[]; confidencePolicy: ConfidencePolicy | null;
  // Governance: identity + citation policy + structured guardrails.
  version: number; owner: string; approver: string; approvalDate: string;
  citationPolicy: string; governanceRules: GovernanceRuleRow[];
  metrics: SpecialistMetricsRow; // V5 Phase 3 — real network metrics (turns/handoffs/escalations/journeys)
}
export interface StakeholderRow { id: string; name: string; role: string; initials: string; color: string; active: boolean; customerId: string | null; interest: string; open: number; asked: number; influence: string; riskLevel: string; decisionAuthority: string }
export interface GovHandoff { from: string; to: string; trigger: string; when: string }
export interface GovEscalation { source: string; dest: string; trigger: string; reason: string; when: string }
export interface GovViolation { persona: string; action: string; rules: string; when: string }
export interface GovLowConf { persona: string; band: string; utterance: string; when: string }
export interface GovUsage { persona: string; turns: number }
export interface GovernanceData {
  handoffs: GovHandoff[]; escalations: GovEscalation[]; violations: GovViolation[]; lowConfidence: GovLowConf[]; usage: GovUsage[];
  freshness: { fresh: number; stale: number; total: number };
  totals: { handoffs: number; escalations: number; violations: number; lowConfidence: number; executionBlocks: number; auditTurns: number; personasInUse: number };
}
export interface CustomerRow { id: string; name: string; seg: string; stage: string; product: string; sessions: number; stakeholders: number; next: string; color: string; hot: boolean; archived: boolean }
export interface SessionRow { id: string; customer: string; product: string; scenario: string; when: string; mode: string; status: string; dur: string; cost: number; llm: number; stakeholders: number }
export interface EvalRow { id: string; name: string; score: number; passed: number; total: number; runs: number }
export interface CostRow { k: string; v: number; color: string; pct: number }
export interface CostSlice { k: string; v: number; pct: number } // real per-dimension cost (department / product / persona)
export interface EvalRunRow { id: string; suite: string; passed: number; total: number; when: string }
// Guided demo TOUR (record-and-replay) — an ordered list of real product actions + captions, authored by
// driving the live product in the desktop's embedded browser and replayed there. steps:
//   { kind:'navigate'|'click'|'input'|'select'|'check'|'note', url?, selector?, label?, value?, caption? }
export interface TourStep { kind: string; url: string; selector: string; label: string; value: string; caption: string; nodeId?: string | null }
export interface TourRow { id: string; productId: string; name: string; description: string; steps: TourStep[] }
// Org Chart (migration 0024) — the REAL organization's people + reporting lines. job_title is the operator-assigned ROLE.
export interface OrgPersonRow { id: string; name: string; jobTitle: string; department: string; sourcePersonId: string; supervisorSourceId: string; supervisorName: string; location: string; photoUrl: string; reports: number; sortOrder: number }

export interface VDType {
  workspace: { name: string; sub: string };
  mtdSpend: number; // real month-to-date cost (cost_events this month)
  products: ProductRow[];
  knowledge: KnowledgeRow[];
  kbTypes: Record<string, { label: string; cls: string }>;
  personas: PersonaRow[];
  stakeholders: StakeholderRow[];
  customers: CustomerRow[];
  sessions: SessionRow[];
  evals: EvalRow[];
  costBreakdown: CostRow[];
  costByDept: CostSlice[]; costByProduct: CostSlice[]; costByPersona: CostSlice[]; // real cost attribution (Cost & Unit Economics)
  evalRuns: EvalRunRow[];
  governance: GovernanceData;
  tours: TourRow[]; // guided demo tours (record-and-replay), per product
  orgPeople: OrgPersonRow[]; // Org Chart (0024) — the real organization's people + reporting lines (role = job_title)
  aiCalls: AiCallRow[]; // AI Conversation History (0027) — every LLM call's prompt → reply, by conversation
}
// AI Conversation History (0027): one captured LLM call — the actual prompt sent and the reply, plus the
// session/product/demo context so the view groups by conversation and filters by product/demo/date/function.
export interface AiCallRow { id: string; sessionId: string; fn: string; model: string; systemPrompt: string; userPrompt: string; reply: string; inTokens: number; outTokens: number; at: string; product: string; demo: string; mode: string }

export const EMPTY_VD: VDType = {
  workspace: { name: 'VIN Demo', sub: 'workspace' }, mtdSpend: 0,
  products: [], knowledge: [], kbTypes: {}, personas: [], stakeholders: [],
  customers: [], sessions: [], evals: [], costBreakdown: [], costByDept: [], costByProduct: [], costByPersona: [], evalRuns: [], tours: [], orgPeople: [], aiCalls: [],
  governance: { handoffs: [], escalations: [], violations: [], lowConfidence: [], usage: [], freshness: { fresh: 0, stale: 0, total: 0 }, totals: { handoffs: 0, escalations: 0, violations: 0, lowConfidence: 0, executionBlocks: 0, auditTurns: 0, personasInUse: 0 } },
};
