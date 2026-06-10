import { db } from './db';
import type { VDType } from '@/app/(console)/_console/data';

/* Real data layer — replaces the mock VD with the engine's real Postgres rows (the SSOT).
   Returns the SAME shape the views consume, so components/CSS stay pixel-identical. Fields
   with no real source are honest (null → views render "—"); presentation config (mk/color/
   tagline) comes from products.metadata (seeded, real config). */

// Engine test artifacts that aren't real demo products — excluded from the console.
const TEST_PRODUCTS = ['eval-phase4-product', 'lifecycle-demo'];

const PALETTE = ['#002855', '#0097A9', '#007D61', '#4D6995', '#0861CE', '#B9975B'];
function colorFor(name: string, i: number): string { return PALETTE[i % PALETTE.length]; }
function initials(name: string): string {
  const base = name.replace(/\.(vin|software)$/i, '').replace(/[^a-zA-Z0-9]/g, ' ').trim();
  const parts = base.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase();
}
function relTime(d: Date | string | null): string {
  if (!d) return '—';
  const t = typeof d === 'string' ? Date.parse(d) : d.getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  const m = Math.floor(s / 60); if (m < 90) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 36) return `${h}h ago`;
  const days = Math.floor(h / 24); return `${days}d ago`;
}
function dur(fromISO: string, toISO: string | null): string {
  if (!toISO) return '—';
  const sec = Math.max(0, Math.floor((Date.parse(toISO) - Date.parse(fromISO)) / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}
const arr = (j: unknown): string[] => (Array.isArray(j) ? (j as string[]) : []);
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// V5 Phase 3 — environment readiness gate (mirrors src/core/environment-readiness.ts; web stays decoupled
// from src/core). Pure computation over REAL env execution-context fields. Never manual.
function envReadinessGate(i: { connectionTarget: string; certificationStatus: string; verificationState: string; lastVerifiedDays: number | null; knownIssues: number; isProduction: boolean }) {
  const g = (name: string, ok: boolean, detail: string) => ({ name, ok, detail });
  const gates = [
    g('Endpoint configured', !!i.connectionTarget, i.connectionTarget ? 'endpoint set' : 'no connection target'),
    g('Certified', i.certificationStatus === 'certified', i.certificationStatus || 'uncertified'),
    g('Verified', i.verificationState === 'verified', i.verificationState || 'unverified'),
    g('Verification fresh', i.lastVerifiedDays != null && i.lastVerifiedDays <= 90, i.lastVerifiedDays == null ? 'never verified' : `${Math.round(i.lastVerifiedDays)}d ago`),
    g('No known issues', i.knownIssues === 0, `${i.knownIssues} known issue(s)`),
    g('Demo (non-prod) target', !i.isProduction, i.isProduction ? 'points at PRODUCTION' : 'non-production'),
  ];
  const passed = gates.filter((x) => x.ok).length;
  return { gates, passed, total: gates.length, ready: passed === gates.length };
}

const KB_TYPES: VDType['kbTypes'] = {
  docs: { label: 'Docs', cls: 'pill-info' },
  faq: { label: 'FAQ', cls: 'pill-steel' },
  sop: { label: 'SOP', cls: 'pill-navy' },
  release_note: { label: 'Release note', cls: 'pill-success' },
  competitor_positioning: { label: 'Competitive', cls: 'pill-warn' },
};

export async function getConsoleData(): Promise<VDType> {
  const pool = db();

  // ── workspace (real org/workspace for the topbar) ──
  const wsRow = (await pool.query<{ org: string; ws: string }>(
    'SELECT o.name AS org, w.name AS ws FROM workspaces w JOIN organizations o ON o.id = w.org_id ORDER BY w.created_at LIMIT 1',
  )).rows[0];
  const workspace = { name: wsRow?.org ?? 'VIN Demo', sub: `${wsRow?.ws ?? 'default'} workspace` };

  // ── products (real + derived; presentation from metadata) ──
  const prodRows = (await pool.query(
    `SELECT p.id, p.name, p.metadata, p.status AS lifecycle_status, p.archived_at,
       av.version_label AS version,
       (SELECT array_agg(version_label ORDER BY created_at DESC) FROM product_versions WHERE product_id=p.id) AS versions,
       (SELECT count(*)::int FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=p.id AND kc.archived_at IS NULL) AS chunks,
       (SELECT count(*)::int FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=p.id AND kc.archived_at IS NULL AND kc.validation_status='validated') AS kb_validated,
       (SELECT count(*)::int FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=p.id AND kc.archived_at IS NULL AND kc.validation_status IN ('needs-review','unverified')) AS kb_review,
       (SELECT count(*)::int FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=p.id AND kc.archived_at IS NULL AND kc.validation_status='stale') AS kb_stale,
       (SELECT count(*)::int FROM demo_graph_nodes n JOIN demo_graphs g ON g.id=n.demo_graph_id WHERE g.product_id=p.id AND g.status='active' AND g.archived_at IS NULL AND n.archived_at IS NULL) AS graph_nodes,
       (SELECT array_agg(n.intent_label ORDER BY n.intent_label) FROM demo_graph_nodes n JOIN demo_graphs g ON g.id=n.demo_graph_id WHERE g.product_id=p.id AND g.status='active' AND g.archived_at IS NULL AND n.archived_at IS NULL) AS graph_node_labels,
       -- Node Studio (V3.2 Experience Registry): the full per-node inspector payload from REAL stored data —
       -- self-explanation (purpose/outcome), navigation (route/selectors/permissions/persona labels), provenance
       -- (evidence + source chunk title), verification (status/date/source), authorship, the workflows that
       -- CONSUME this node (node_sequence containment), and the node's own graph_events change history.
       (SELECT jsonb_agg(jsonb_build_object(
            'id', n.id, 'label', n.intent_label, 'status', n.verification_status, 'type', n.screen_type,
            'screenName', n.screen_name, 'route', n.screen_route,
            'businessPurpose', n.business_purpose, 'businessOutcome', n.business_outcome,
            'evidence', n.derived_evidence, 'sourceChunkId', n.source_chunk_id,
            'sourceTitle', (SELECT ks.title FROM knowledge_chunks kc LEFT JOIN knowledge_sources ks ON ks.id=kc.source_id WHERE kc.id=n.source_chunk_id),
            'verificationSource', n.verification_source, 'lastVerified', n.last_verified, 'pageVersion', n.page_version,
            'permissions', n.permissions_required, 'personaLabels', n.persona_labels, 'locators', n.locator_strategies,
            'createdBy', n.created_by, 'createdAt', n.created_at, 'updatedBy', n.updated_by, 'updatedAt', n.updated_at,
            'consumers', (SELECT jsonb_agg(jsonb_build_object('id', w.id, 'name', w.workflow_name, 'approved', (w.approved_at IS NOT NULL), 'stakeholderType', w.stakeholder_type, 'personaType', w.persona_type) ORDER BY w.workflow_name)
                            FROM demo_graph_workflows w WHERE w.demo_graph_id=g.id AND w.archived_at IS NULL
                              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(w.node_sequence) e WHERE lower(e)=lower(n.intent_label))),
            'history', (SELECT jsonb_agg(h ORDER BY h_at DESC) FROM (SELECT jsonb_build_object('action', action, 'actor', actor, 'at', occurred_at::text) h, occurred_at h_at FROM graph_events WHERE node_id=n.id ORDER BY occurred_at DESC LIMIT 8) hx),
            'navAttempts', (SELECT jsonb_agg(a ORDER BY a_at DESC) FROM (SELECT jsonb_build_object('ok', ok, 'healedVia', healed_via, 'selector', selector_used, 'source', source, 'url', url, 'at', occurred_at::text) a, occurred_at a_at FROM navigation_attempts WHERE node_id=n.id ORDER BY occurred_at DESC LIMIT 8) ax),
            -- Phase 3 usage: REAL aggregate from navigation_attempts. observed = attempts with a known outcome
            -- (ok NOT NULL — client-driven nav is ok=NULL and counts only as usage); successRate derives from
            -- observed only, so a rate is shown ONLY once outcomes exist (telemetry-gated — never a placeholder).
            'usage', (SELECT jsonb_build_object('attempts', count(*)::int, 'observed', count(*) FILTER (WHERE ok IS NOT NULL)::int, 'succeeded', count(*) FILTER (WHERE ok=true)::int, 'lastAt', max(occurred_at)::text) FROM navigation_attempts WHERE node_id=n.id),
            -- Full per-page surface (this session): the page_facts snapshot + the element registry (buttons/actions/forms/fields/errors/faqs).
            'pageFacts', n.page_facts,
            'elements', (SELECT jsonb_agg(jsonb_build_object('type', e.element_type, 'label', e.label, 'detail', e.detail, 'status', e.implementation_status) ORDER BY e.sort_order, e.element_type) FROM demo_graph_node_elements e WHERE e.node_id=n.id AND e.archived_at IS NULL)
          ) ORDER BY n.intent_label)
          FROM demo_graph_nodes n JOIN demo_graphs g ON g.id=n.demo_graph_id
         WHERE g.product_id=p.id AND g.status='active' AND g.archived_at IS NULL AND n.archived_at IS NULL) AS graph_nodes_detail,
       (SELECT jsonb_build_object('id', g.id, 'name', g.name, 'nodes', (SELECT count(*)::int FROM demo_graph_nodes n WHERE n.demo_graph_id=g.id), 'pending', (SELECT count(*)::int FROM demo_graph_nodes n WHERE n.demo_graph_id=g.id AND n.verification_status IN ('draft','pending_review'))) FROM demo_graphs g WHERE g.product_id=p.id AND g.status='draft' AND g.archived_at IS NULL ORDER BY g.graph_version DESC LIMIT 1) AS draft_graph,
       -- Draft-graph NODE DETAIL (this session): render a Discover draft's full sitemap before publishing it.
       (SELECT jsonb_agg(jsonb_build_object('id', n.id, 'label', n.intent_label, 'status', n.verification_status, 'type', n.screen_type,
            'screenName', n.screen_name, 'route', n.screen_route, 'businessPurpose', n.business_purpose, 'pageFacts', n.page_facts,
            'elements', (SELECT jsonb_agg(jsonb_build_object('type', e.element_type, 'label', e.label, 'detail', e.detail, 'status', e.implementation_status) ORDER BY e.sort_order, e.element_type) FROM demo_graph_node_elements e WHERE e.node_id=n.id AND e.archived_at IS NULL)) ORDER BY n.intent_label)
          FROM demo_graph_nodes n
         WHERE n.archived_at IS NULL AND n.demo_graph_id = (SELECT id FROM demo_graphs WHERE product_id=p.id AND status='draft' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1)) AS draft_graph_detail,
       (SELECT jsonb_build_object('passed', passed, 'total', total) FROM eval_runs WHERE product_id=p.id AND suite='coverage' ORDER BY ran_at DESC LIMIT 1) AS coverage_eval,
       (SELECT count(*)::int FROM demo_graph_workflows w JOIN demo_graphs g ON g.id=w.demo_graph_id WHERE g.product_id=p.id AND g.status='active' AND g.archived_at IS NULL AND w.archived_at IS NULL) AS graph_flows,
       (SELECT count(*)::int FROM demo_graph_nodes n JOIN demo_graphs g ON g.id=n.demo_graph_id WHERE g.product_id=p.id AND g.status='active' AND g.archived_at IS NULL AND n.archived_at IS NULL AND n.verification_status='broken') AS graph_broken,
       -- Phase 4 readiness signals + version history (real): observed nav outcomes, audit volume, and every
       -- active/deprecated graph version (for rollback + the blast-radius shown before it).
       (SELECT count(*)::int FROM navigation_attempts WHERE product_id=p.id AND ok IS NOT NULL) AS nav_observed,
       (SELECT count(*)::int FROM graph_events WHERE product_id=p.id) AS graph_events_count,
       (SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'version', g.graph_version, 'status', g.status,
          'coverage', g.coverage_score, 'verifiedAt', g.verified_at::text,
          'nodes', (SELECT count(*)::int FROM demo_graph_nodes n WHERE n.demo_graph_id=g.id AND n.archived_at IS NULL),
          'workflows', (SELECT count(*)::int FROM demo_graph_workflows w WHERE w.demo_graph_id=g.id AND w.archived_at IS NULL))
          ORDER BY g.graph_version DESC)
          FROM demo_graphs g WHERE g.product_id=p.id AND g.status IN ('active','deprecated')) AS graph_versions,
       -- Full workflow detail for the ACTIVE graph (Workflow Builder): journeys, audience, ordered node
       -- sequence, technical status, and the editorial approval gate (approved → the live loop selects it).
       (SELECT jsonb_agg(jsonb_build_object('id', w.id, 'name', w.workflow_name, 'purpose', w.business_purpose,
          'stakeholderType', w.stakeholder_type, 'personaType', w.persona_type, 'sequence', w.node_sequence,
          'success', w.success_criteria, 'script', w.step_script, 'status', w.verification_status, 'approved', (w.approved_at IS NOT NULL), 'sortOrder', w.sort_order)
          ORDER BY w.sort_order, w.workflow_name)
          FROM demo_graph_workflows w JOIN demo_graphs g ON g.id=w.demo_graph_id
         WHERE g.product_id=p.id AND g.status='active' AND g.archived_at IS NULL AND w.archived_at IS NULL) AS workflows,
       ga.status AS graph_status, ga.graph_version AS graph_version, ga.coverage_score AS graph_coverage, ga.id AS active_graph_id,
       av.version_id AS active_version_id,
       (SELECT count(*)::int FROM demo_sessions ds JOIN product_versions pv ON pv.id=ds.product_version_id WHERE pv.product_id=p.id) AS demos,
       -- V5 Phase 3 — REAL knowledge-usage telemetry: audit turns for this product that were grounded in
       -- knowledge (knowledge_used non-empty). 0 until demos run (telemetry-gated; never a fabricated rate).
       (SELECT count(*)::int FROM audit_turns at JOIN demo_sessions ds ON ds.id=at.demo_session_id JOIN product_versions pv ON pv.id=ds.product_version_id WHERE pv.product_id=p.id AND jsonb_array_length(at.knowledge_used) > 0) AS knowledge_grounded_turns,
       e.id AS env_id, e.name AS env_name, e.connection_target, e.is_production, e.created_at AS env_created,
       e.reset_mechanism, e.refresh_cadence, e.seed_dataset, e.default_mode,
       e.certification_status, e.verification_state, e.last_verified::text AS env_last_verified,
       e.seed_version, e.data_version, e.readiness_state, e.known_issues
     FROM products p
     LEFT JOIN LATERAL (SELECT version_label, id AS version_id FROM product_versions WHERE product_id=p.id AND status='active' ORDER BY created_at DESC LIMIT 1) av ON true
     LEFT JOIN LATERAL (SELECT id, name, connection_target, is_production, default_mode, reset_mechanism, refresh_cadence, seed_dataset, created_at, certification_status, verification_state, last_verified, seed_version, data_version, readiness_state, known_issues FROM environments WHERE product_id=p.id AND archived_at IS NULL ORDER BY created_at LIMIT 1) e ON true
     LEFT JOIN LATERAL (SELECT id, status, graph_version, coverage_score FROM demo_graphs WHERE product_id=p.id AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1) ga ON true
     WHERE p.name <> ALL($1::text[])
     ORDER BY p.created_at`,
    [TEST_PRODUCTS],
  )).rows;

  // ── per-product BUYING COMMITTEE (0012 + 0020) — the named people the reel/convo address (live seeds none).
  // `room` keeps the minimal shape the reel roster uses (unchanged); `committee` is the richer Stakeholder
  // Registry view that also carries the decision-criteria / goals / objections / questions added in 0020. ──
  const roomByProduct: Record<string, any[]> = {};
  const committeeByProduct: Record<string, any[]> = {};
  try {
    const roomRows = (await pool.query(
      `SELECT product_id, id, name, role, interests, influence, risk_level, decision_authority,
              decision_criteria, goals, objections, questions, sort_order
         FROM product_stakeholders WHERE archived_at IS NULL ORDER BY sort_order, created_at`,
    )).rows;
    for (const r of roomRows as any[]) {
      (roomByProduct[r.product_id] ??= []).push({
        id: r.id, name: r.name, role: r.role ?? '', interests: arr(r.interests),
        influence: r.influence ?? '', riskLevel: r.risk_level ?? '', decisionAuthority: r.decision_authority ?? '',
      });
      (committeeByProduct[r.product_id] ??= []).push({
        id: r.id, name: r.name, role: r.role ?? '', interests: arr(r.interests),
        influence: r.influence ?? '', riskLevel: r.risk_level ?? '', decisionAuthority: r.decision_authority ?? '',
        decisionCriteria: arr(r.decision_criteria), goals: arr(r.goals), objections: arr(r.objections), questions: arr(r.questions),
        sortOrder: Number(r.sort_order ?? 0),
      });
    }
  } catch { /* table absent pre-migration → every product gets an empty room/committee (code DEFAULTS apply) */ }

  // ── per-product BUSINESS OUTCOME REGISTRY (0020) — the first-class outcome object (active/draft/deprecated;
  // archived excluded). Free-text outcome on nodes/workflows still exists; this is the governed registry. ──
  const outcomesByProduct: Record<string, any[]> = {};
  try {
    const oRows = (await pool.query(
      `SELECT product_id, id, title, description, metric, baseline, target, stakeholder_type, status, version, owner
         FROM business_outcomes WHERE archived_at IS NULL ORDER BY created_at DESC`,
    )).rows;
    for (const o of oRows as any[]) (outcomesByProduct[o.product_id] ??= []).push({
      id: o.id, title: o.title, description: o.description ?? '', metric: o.metric ?? '',
      baseline: o.baseline ?? '', target: o.target ?? '', stakeholderType: o.stakeholder_type ?? '',
      status: o.status ?? 'active', version: Number(o.version ?? 1), owner: o.owner ?? '',
    });
  } catch { /* business_outcomes absent pre-0020 → empty (telemetry-gated, never fabricated) */ }

  // ── per-product INFLUENCE GRAPH (0020) — edges between committee members (reports_to/influences/…). ──
  const relationshipsByProduct: Record<string, any[]> = {};
  try {
    const rRows = (await pool.query(
      `SELECT product_id, id, from_stakeholder_id, to_stakeholder_id, relation, weight
         FROM stakeholder_relationships WHERE archived_at IS NULL`,
    )).rows;
    for (const r of rRows as any[]) (relationshipsByProduct[r.product_id] ??= []).push({
      id: r.id, from: r.from_stakeholder_id, to: r.to_stakeholder_id, relation: r.relation ?? '', weight: r.weight ?? '',
    });
  } catch { /* stakeholder_relationships absent pre-0020 → empty */ }

  // ── Empirical Intent Registry (Phase 3) — built ENTIRELY from real navigation_attempts (no new table, no
  // fabrication). Per (product, intent): the most-selected node = primary; confidence = its REAL success rate
  // among OBSERVED attempts (null until outcomes exist); fallback = the 2nd-most-selected node. This is the
  // "what intent resolves to which screen, and how reliably" map the AI actually exhibits over time. ──
  const intentByProduct: Record<string, { intent: string; node: string; nodeId: string; attempts: number; confidence: number | null; fallback: string | null }[]> = {};
  try {
    const intentRows = (await pool.query(`
      SELECT na.product_id, lower(na.intent) AS intent, na.node_id, n.intent_label,
             count(*)::int AS attempts,
             count(*) FILTER (WHERE na.ok IS NOT NULL)::int AS observed,
             count(*) FILTER (WHERE na.ok = true)::int AS succeeded
        FROM navigation_attempts na
        LEFT JOIN demo_graph_nodes n ON n.id = na.node_id
       WHERE na.intent IS NOT NULL AND na.node_id IS NOT NULL
       GROUP BY na.product_id, lower(na.intent), na.node_id, n.intent_label`)).rows;
    const byPI: Record<string, Record<string, { node: string; nodeId: string; attempts: number; observed: number; succeeded: number }[]>> = {};
    for (const r of intentRows as any[]) {
      ((byPI[r.product_id] ??= {})[r.intent] ??= []).push({ node: r.intent_label ?? '(archived node)', nodeId: r.node_id, attempts: r.attempts, observed: r.observed, succeeded: r.succeeded });
    }
    for (const [pid, intents] of Object.entries(byPI)) {
      intentByProduct[pid] = Object.entries(intents).map(([intent, nodes]) => {
        nodes.sort((a, b) => b.attempts - a.attempts);
        const primary = nodes[0];
        return {
          intent, node: primary.node, nodeId: primary.nodeId,
          attempts: nodes.reduce((s, x) => s + x.attempts, 0),
          confidence: primary.observed > 0 ? Math.round((primary.succeeded / primary.observed) * 100) : null,
          fallback: nodes[1]?.node ?? null,
        };
      }).sort((a, b) => b.attempts - a.attempts);
    }
  } catch { /* navigation_attempts absent (pre-0019) → empty intent map */ }

  const products = prodRows.map((p: any, i: number) => {
    const pIntents = intentByProduct[p.id] ?? [];
    const meta = p.metadata || {};
    const chunks = p.chunks ?? 0;
    const pct = (n: number) => (chunks ? Math.round((n / chunks) * 100) : 0);
    return {
      id: p.id, name: p.name, domain: p.name,
      tagline: meta.tagline ?? '',
      version: (p.version ?? '—'), versions: (p.versions ?? []),
      mk: meta.mk ?? initials(p.name), color: meta.color ?? colorFor(p.name, i),
      // Lifecycle status is a real column (Draft → Processing → Ready → Failed → Archived).
      status: cap(p.lifecycle_status ?? 'ready'),
      archived: !!p.archived_at,
      coverage: meta.coverage ?? pct(p.kb_validated),
      chunks, demos: p.demos ?? 0,
      kbValidated: pct(p.kb_validated), kbReview: pct(p.kb_review), kbStale: pct(p.kb_stale),
      // Demo-readiness (Phase D) — a DERIVED blend of three REAL signals: knowledge coverage, % validated,
      // and % fresh (not stale). No new table; honest the day it ships. A pre-demo "don't walk in with gaps".
      readiness: chunks ? Math.round(0.4 * (meta.coverage ?? pct(p.kb_validated)) + 0.4 * pct(p.kb_validated) + 0.2 * (100 - pct(p.kb_stale))) : 0,
      env: p.env_name ?? '—',
      // Honest status: we only know whether an endpoint is configured (no real health/reset probe exists).
      envStatus: p.connection_target ? 'Configured' : 'No endpoint',
      lastReset: relTime(p.env_created),
      graphNodes: p.graph_nodes ?? 0, graphFlows: p.graph_flows ?? 0,
      graphNodeLabels: arr(p.graph_node_labels),
      // Node Studio (V3.2): per-node inspector payload (keeps label/status/type for graph colouring; adds the
      // full self-explanation / navigation / provenance / verification / authorship / consumers / history).
      graphNodeStates: Array.isArray(p.graph_nodes_detail) ? p.graph_nodes_detail.map((n: any) => ({
        id: String(n?.id ?? ''), label: String(n?.label ?? ''), status: String(n?.status ?? 'draft'), type: String(n?.type ?? ''),
        screenName: n?.screenName ?? '', route: n?.route ?? '',
        businessPurpose: n?.businessPurpose ?? '', businessOutcome: n?.businessOutcome ?? '',
        evidence: n?.evidence ?? '', sourceChunkId: n?.sourceChunkId ?? null, sourceTitle: n?.sourceTitle ?? '',
        verificationSource: n?.verificationSource ?? '', lastVerified: n?.lastVerified ?? null, pageVersion: n?.pageVersion ?? '',
        permissions: Array.isArray(n?.permissions) ? n.permissions.map((x: any) => String(x)) : [],
        personaLabels: (n?.personaLabels && typeof n.personaLabels === 'object') ? n.personaLabels as Record<string, string> : {},
        locators: Array.isArray(n?.locators) ? n.locators : [],
        createdBy: n?.createdBy ?? '', createdAt: n?.createdAt ?? null, updatedBy: n?.updatedBy ?? '', updatedAt: n?.updatedAt ?? null,
        consumers: Array.isArray(n?.consumers) ? n.consumers.map((c: any) => ({ id: String(c?.id ?? ''), name: String(c?.name ?? ''), approved: !!c?.approved, stakeholderType: c?.stakeholderType ?? '', personaType: c?.personaType ?? '' })) : [],
        history: Array.isArray(n?.history) ? n.history.map((h: any) => ({ action: String(h?.action ?? ''), actor: String(h?.actor ?? ''), at: h?.at ?? null })) : [],
        navAttempts: Array.isArray(n?.navAttempts) ? n.navAttempts.map((a: any) => ({ ok: (a?.ok === null || a?.ok === undefined) ? null : !!a.ok, healedVia: a?.healedVia ?? null, selector: a?.selector ?? null, source: String(a?.source ?? ''), url: a?.url ?? '', at: a?.at ?? null })) : [],
        // Phase 3 usage (telemetry-gated): successRate null until observed outcomes exist — never a placeholder.
        usage: (() => { const u = n?.usage || {}; const observed = Number(u.observed ?? 0); return { attempts: Number(u.attempts ?? 0), observed, succeeded: Number(u.succeeded ?? 0), successRate: observed > 0 ? Math.round((Number(u.succeeded ?? 0) / observed) * 100) : null, lastAt: u.lastAt ?? null }; })(),
        // Intents whose PRIMARY resolved node is this one (empirical, from the intent registry).
        resolvingIntents: pIntents.filter((e) => e.nodeId === String(n?.id ?? '')).map((e) => e.intent),
        tourConsumers: [] as { id: string; name: string }[], // best-effort tour links — filled by the post-pass below
        // Full per-page surface (this session): the page_facts snapshot + the element registry (buttons/actions/forms/fields).
        pageFacts: (n?.pageFacts && typeof n.pageFacts === 'object') ? n.pageFacts : {},
        elements: Array.isArray(n?.elements) ? n.elements.map((e: any) => ({ type: String(e?.type ?? ''), label: String(e?.label ?? ''), detail: (e?.detail && typeof e.detail === 'object') ? e.detail : {}, status: String(e?.status ?? 'live') })) : [],
      })) : [],
      draftGraph: p.draft_graph ?? null, // latest draft autogen graph — publishable / archivable from the console
      // Draft-graph node detail (this session) — render a Discover draft's full sitemap before publishing it.
      draftNodesDetail: Array.isArray(p.draft_graph_detail) ? p.draft_graph_detail.map((n: any) => ({
        id: String(n?.id ?? ''), label: String(n?.label ?? ''), status: String(n?.status ?? 'draft'), type: String(n?.type ?? ''),
        screenName: n?.screenName ?? '', route: n?.route ?? '', businessPurpose: n?.businessPurpose ?? '',
        pageFacts: (n?.pageFacts && typeof n.pageFacts === 'object') ? n.pageFacts : {},
        elements: Array.isArray(n?.elements) ? n.elements.map((e: any) => ({ type: String(e?.type ?? ''), label: String(e?.label ?? ''), detail: (e?.detail && typeof e.detail === 'object') ? e.detail : {}, status: String(e?.status ?? 'live') })) : [],
      })) : [],
      activeGraphId: p.active_graph_id ?? null, // active graph the Workflow Builder authors onto
      activeVersionId: p.active_version_id ?? null, // active product_version — used to plan a session
      // Workflow Builder detail (0015): the active graph's journeys + audience + sequence + status + approval.
      workflows: Array.isArray(p.workflows) ? p.workflows.map((w: any) => ({
        id: String(w?.id ?? ''), name: String(w?.name ?? ''), purpose: w?.purpose ?? '',
        stakeholderType: w?.stakeholderType ?? '', personaType: w?.personaType ?? '',
        sequence: Array.isArray(w?.sequence) ? w.sequence.map((s: any) => String(s)) : [],
        successCriteria: w?.success ?? '',
        stepScript: (w?.script && typeof w.script === 'object') ? w.script as Record<string, string> : {},
        status: String(w?.status ?? 'draft'), approved: !!w?.approved, sortOrder: Number(w?.sortOrder ?? 0),
      })) : [],
      // Demo-graph truth (Phase A/C): active graph's real status/version + computed coverage + broken-node count.
      graphStatus: p.graph_status ?? null, graphVersion: p.graph_version ?? null,
      graphCoverage: p.graph_coverage ?? null, graphBroken: p.graph_broken ?? 0,
      coverageEval: p.coverage_eval ?? null, // latest per-product coverage eval run (evidence-backed; null if none)
      defaultMode: p.default_mode ?? 'read-only',
      // Real environment fields (de-faked — these were hardcoded strings in the UI).
      envId: p.env_id ?? null,
      connectionTarget: p.connection_target ?? '',
      isProduction: !!p.is_production,
      resetMechanism: p.reset_mechanism ?? '',
      refreshCadence: p.refresh_cadence ?? '',
      seedDataset: (p.seed_dataset && (p.seed_dataset.summary ?? '')) || '',
      // V5 Phase 3 — environment execution context + computed readiness gate (mirrors environment-readiness.ts).
      certificationStatus: p.certification_status ?? 'uncertified',
      verificationState: p.verification_state ?? '',
      seedVersion: p.seed_version ?? '', dataVersion: p.data_version ?? '', readinessState: p.readiness_state ?? '',
      knownIssues: Array.isArray(p.known_issues) ? p.known_issues.map((k: any) => ({ title: String(k?.title ?? k ?? ''), detail: String(k?.detail ?? '') })).filter((k: any) => k.title) : [],
      envReadiness: envReadinessGate({
        connectionTarget: p.connection_target ?? '', certificationStatus: p.certification_status ?? 'uncertified',
        verificationState: p.verification_state ?? '',
        lastVerifiedDays: p.env_last_verified ? Math.max(0, Math.floor((Date.now() - Date.parse(p.env_last_verified)) / 86400000)) : null,
        knownIssues: Array.isArray(p.known_issues) ? p.known_issues.length : 0,
        isProduction: !!p.is_production,
      }),
      knowledgeGroundedTurns: p.knowledge_grounded_turns ?? 0,
      room: roomByProduct[p.id] ?? [], // scripted demo-room roster (named people the reel addresses)
      committee: committeeByProduct[p.id] ?? [], // Stakeholder Registry (0020) — buying committee w/ criteria/goals/objections
      outcomes: outcomesByProduct[p.id] ?? [], // Business Outcome Registry (0020) — first-class governed outcomes
      stakeholderRelationships: relationshipsByProduct[p.id] ?? [], // influence-graph edges (0020)
      intentMap: pIntents, // empirical intent→node registry (Phase 3) — built from real navigation_attempts
      // Phase 4: every active/deprecated graph version (for the Versions panel + rollback + blast-radius).
      graphVersions: Array.isArray(p.graph_versions) ? p.graph_versions.map((v: any) => ({ id: String(v.id), name: String(v.name ?? ''), version: Number(v.version ?? 1), status: String(v.status ?? ''), coverage: v.coverage ?? null, verifiedAt: v.verifiedAt ?? null, nodes: Number(v.nodes ?? 0), workflows: Number(v.workflows ?? 0) })) : [],
      navObserved: p.nav_observed ?? 0, graphEventsCount: p.graph_events_count ?? 0,
      authorityReadiness: null as any, // computed in the readiness post-pass below (needs graphNodeStates)
    };
  });

  // ── knowledge (real chunks + trust metadata) ──
  const kRows = (await pool.query(
    `SELECT kc.id, kc.content, kc.category, kc.confidence, kc.source,
            kc.last_verified::text AS last_verified, kc.validation_status, kc.lifecycle_state,
            kc.validated_by, kc.validated_at::text AS validated_at,
            kb.product_id AS product_id, p.name AS product, ks.owner AS source_owner,
            pv.version_label AS ver,
            (SELECT jsonb_agg(h) FROM (
               SELECT jsonb_build_object('action', action, 'actor', actor, 'at', occurred_at::text) AS h
                 FROM knowledge_events WHERE chunk_id = kc.id ORDER BY occurred_at DESC LIMIT 6) sub) AS history
       FROM knowledge_chunks kc
       JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
       LEFT JOIN knowledge_sources ks ON ks.id = kc.source_id
       LEFT JOIN product_versions pv ON pv.id = kc.product_version_id
       JOIN products p ON p.id = kb.product_id
      WHERE p.name <> ALL($1::text[]) AND kc.archived_at IS NULL
      ORDER BY p.name, kc.confidence DESC NULLS LAST, kc.created_at DESC
      LIMIT 1000`,
    [TEST_PRODUCTS],
  )).rows;
  const knowledge = kRows.map((k: any) => {
    const type = KB_TYPES[k.category] ? k.category : 'docs';
    const first = String(k.content).split(/(?<=[.!?])\s/)[0];
    return {
      id: k.id, productId: k.product_id, product: k.product ?? '—',
      title: first.length > 72 ? first.slice(0, 69) + '…' : first,
      content: k.content,
      type, conf: Number(k.confidence) || 0, source: k.source,
      verified: k.last_verified ? relTime(k.last_verified) : '—',
      ver: (k.ver ?? '—').toString().replace(/^v/i, ''),
      status: k.validation_status === 'validated' ? 'validated' : k.validation_status === 'stale' ? 'stale' : 'needs-review',
      lifecycleState: k.lifecycle_state ?? 'validated',
      validatedBy: k.validated_by ?? null,
      validatedAt: k.validated_at ? relTime(k.validated_at) : null,
      sourceOwner: k.source_owner ?? null,
      history: Array.isArray(k.history) ? k.history : [],
    };
  });

  // ── personas (real config + REAL hand-off metric this month from persona_handoff_events) ──
  const personas = (await pool.query(
    `SELECT p.id, p.name, p.status, p.definition, p.archived_at,
            p.version, p.owner, p.approver, p.approval_date::text AS approval_date,
            (SELECT count(*)::int FROM persona_handoff_events h
              WHERE h.to_persona_id = p.id AND h.occurred_at >= date_trunc('month', now())) AS handoffs,
            -- V5 Phase 3 — REAL specialist metrics rolled up from EXISTING event tables (no new instrumentation).
            (SELECT count(*)::int FROM audit_turns t WHERE t.persona_id = p.id) AS turns,
            (SELECT count(*)::int FROM persona_handoff_events h WHERE h.to_persona_id = p.id) AS handoffs_in,
            (SELECT count(*)::int FROM persona_handoff_events h WHERE h.from_persona_id = p.id) AS handoffs_out,
            (SELECT count(*)::int FROM persona_escalation_events e WHERE e.source_persona_id = p.id) AS escalations,
            -- Journey participation (Phase 2 seam): journeys whose specialist_rules name this persona.
            (SELECT count(*)::int FROM journeys j WHERE j.archived_at IS NULL
               AND j.specialist_rules @> jsonb_build_array(jsonb_build_object('personaId', p.id::text))) AS journeys
       FROM personas p ORDER BY (p.definition->>'lead')::boolean DESC NULLS LAST, p.name`,
  )).rows.map((p: any, i: number) => ({
    id: p.id, name: p.name,
    status: p.status ?? 'approved', archived: !!p.archived_at,
    role: p.definition?.role ?? p.name,
    lead: p.definition?.lead === true,
    // V5 Phase 3 — real specialist network metrics (telemetry-gated; 0 until events exist).
    metrics: { turns: p.turns ?? 0, handoffsIn: p.handoffs_in ?? 0, handoffsOut: p.handoffs_out ?? 0, escalations: p.escalations ?? 0, journeys: p.journeys ?? 0 },
    scope: p.definition?.scope ?? '', limits: p.definition?.limits ?? '',
    systemPrompt: p.definition?.systemPrompt ?? '',
    expertiseDomains: arr(p.definition?.expertiseDomains),
    hardGuardrails: arr(p.definition?.hardGuardrails),
    allowedActions: arr(p.definition?.allowedActions),
    prohibitedActions: arr(p.definition?.prohibitedActions),
    escalationRules: arr(p.definition?.escalationRules),
    confidenceThreshold: typeof p.definition?.confidenceThreshold === 'number' ? p.definition.confidenceThreshold : 0.7,
    voiceProfileId: p.definition?.voiceProfileId ?? '',
    productIds: arr(p.definition?.productIds), // sites this specialist is assigned to ([] = all)
    // Human-level layers (cognition · interaction · relationships) — pass the jsonb through verbatim.
    mentalModels: arr(p.definition?.mentalModels),
    traits: arr(p.definition?.traits),
    conversationStrategy: arr(p.definition?.conversationStrategy),
    communicationStyle: (p.definition?.communicationStyle && typeof p.definition.communicationStyle === 'object') ? p.definition.communicationStyle : null,
    decisionFramework: arr(p.definition?.decisionFramework),
    objectionPlaybook: Array.isArray(p.definition?.objectionPlaybook)
      ? p.definition.objectionPlaybook.map((o: any) => ({ objection: String(o?.objection ?? ''), response: arr(o?.response) })).filter((o: any) => o.objection)
      : [],
    knowledgePriority: arr(p.definition?.knowledgePriority),
    participationMode: p.definition?.participationMode ?? 'reactive',
    handoffConditions: Array.isArray(p.definition?.handoffConditions)
      ? p.definition.handoffConditions.map((h: any) => ({ topic: String(h?.topic ?? ''), toPersona: String(h?.toPersona ?? '') })).filter((h: any) => h.topic && h.toPersona)
      : [],
    confidencePolicy: (p.definition?.confidencePolicy && typeof p.definition.confidencePolicy === 'object') ? p.definition.confidencePolicy : null,
    // Governance: identity (real columns) + citation policy + structured guardrails (jsonb).
    version: typeof p.version === 'number' ? p.version : 1,
    owner: p.owner ?? '', approver: p.approver ?? '', approvalDate: p.approval_date ? relTime(p.approval_date) : '',
    citationPolicy: p.definition?.citationPolicy ?? 'when_uncertain',
    governanceRules: Array.isArray(p.definition?.governanceRules)
      ? p.definition.governanceRules.map((r: any) => ({ category: String(r?.category ?? ''), restriction: String(r?.restriction ?? ''), action: String(r?.action ?? 'escalate') })).filter((r: any) => r.category)
      : [],
    calls: p.handoffs ?? 0, // real hand-offs this month (was a fabricated static number)
    brand: p.definition?.brand ?? 'Approved',
    color: p.definition?.color ?? colorFor(p.name, i),
  }));

  // ── stakeholders (from real sessions, carrying their customer so detail views scope correctly) ──
  const stakeholders = (await pool.query(
    `SELECT DISTINCT ON (ds.customer_id, s.name, s.role) s.name, s.role, s.interests, s.open_items, s.is_active, ds.customer_id,
            s.influence, s.risk_level, s.decision_authority
       FROM stakeholders s JOIN demo_sessions ds ON ds.id = s.demo_session_id
      WHERE s.name IS NOT NULL ORDER BY ds.customer_id, s.name, s.role LIMIT 80`,
  )).rows.map((s: any, i: number) => ({
    id: `s${i + 1}`, name: s.name, role: s.role ?? '',
    initials: initials(s.name), color: colorFor(s.name, i),
    active: !!s.is_active, customerId: s.customer_id ?? null,
    interest: arr(s.interests)[0] ?? '',
    open: arr(s.open_items).length, asked: arr(s.interests).length,
    // Stakeholder governance.
    influence: s.influence ?? '', riskLevel: s.risk_level ?? '', decisionAuthority: s.decision_authority ?? '',
  }));

  // ── customers / departments (real + counts) ──
  const customers = (await pool.query(
    `SELECT c.id, c.name, c.metadata, c.archived_at,
       (SELECT count(*)::int FROM demo_sessions WHERE customer_id=c.id) AS sessions,
       (SELECT count(DISTINCT s.name)::int FROM stakeholders s JOIN demo_sessions ds ON ds.id=s.demo_session_id WHERE ds.customer_id=c.id) AS stakeholders,
       (SELECT bool_or(status='active') FROM demo_sessions WHERE customer_id=c.id) AS hot,
       (SELECT p.name FROM demo_sessions ds JOIN product_versions pv ON pv.id=ds.product_version_id JOIN products p ON p.id=pv.product_id WHERE ds.customer_id=c.id ORDER BY ds.started_at DESC LIMIT 1) AS product
     FROM customers c ORDER BY c.name`,
  )).rows.map((c: any, i: number) => ({
    id: c.id, name: c.name,
    seg: c.metadata?.seg ?? `${c.stakeholders ?? 0} stakeholders`,
    stage: c.metadata?.stage ?? (c.hot ? 'Live demo' : c.sessions ? 'Follow-up' : 'Qualifying'),
    product: c.product ?? '—', sessions: c.sessions ?? 0, stakeholders: c.stakeholders ?? 0,
    next: c.metadata?.next ?? (c.hot ? 'In session now' : 'Unscheduled'),
    color: c.metadata?.color ?? colorFor(c.name, i), hot: !!c.hot,
    archived: !!c.archived_at,
  }));

  // ── sessions (real demo_sessions + cost + duration) ──
  const sessions = (await pool.query(
    `SELECT ds.id, ds.execution_mode, ds.status, ds.started_at::text AS started_at,
       c.name AS customer, p.name AS product,
       (SELECT coalesce(sum(amount_usd),0)::float FROM cost_events WHERE demo_session_id=ds.id) AS cost,
       (SELECT coalesce(sum(amount_usd),0)::float FROM cost_events WHERE demo_session_id=ds.id AND type='llm') AS llm,
       (SELECT count(*)::int FROM stakeholders WHERE demo_session_id=ds.id) AS stakeholders,
       (SELECT max(occurred_at)::text FROM cost_events WHERE demo_session_id=ds.id) AS last_event,
       sd.business_objective
     FROM demo_sessions ds
     JOIN customers c ON c.id = ds.customer_id
     LEFT JOIN product_versions pv ON pv.id = ds.product_version_id
     LEFT JOIN products p ON p.id = pv.product_id
     LEFT JOIN session_discovery sd ON sd.demo_session_id = ds.id
     WHERE (p.name IS NULL OR p.name <> ALL($1::text[]))
     ORDER BY ds.started_at DESC LIMIT 40`,
    [TEST_PRODUCTS],
  )).rows.map((s: any) => ({
    id: s.id, customer: s.customer, product: s.product ?? '—',
    scenario: s.business_objective ?? 'Demo session',
    when: relTime(s.started_at), mode: s.execution_mode,
    status: s.status === 'active' ? 'Live' : s.status === 'done' ? 'Completed' : s.status.charAt(0).toUpperCase() + s.status.slice(1),
    dur: dur(s.started_at, s.last_event), cost: Number(s.cost) || 0, llm: Number(s.llm) || 0,
    stakeholders: s.stakeholders ?? 0,
  }));

  // ── cost breakdown (aggregate real cost_events) ──
  const costRows = (await pool.query(`SELECT type, coalesce(sum(amount_usd),0)::float AS v FROM cost_events GROUP BY type ORDER BY v DESC`)).rows;
  // Real month-to-date spend for the topbar (was all-time, mislabeled "MTD").
  const mtdSpend = Number((await pool.query(`SELECT coalesce(sum(amount_usd),0)::float AS v FROM cost_events WHERE occurred_at >= date_trunc('month', now())`)).rows[0]?.v) || 0;
  const costLabel: Record<string, string> = { llm: 'LLM tokens', embeddings: 'Embeddings', navigation: 'Navigation / compute', compute: 'Compute', storage: 'Storage', stt: 'Voice — speech-to-text', tts: 'Voice — text-to-speech' };
  const costColor: Record<string, string> = { llm: '#002855', navigation: '#0097A9', embeddings: '#4D6995', compute: '#007D61', storage: '#B9975B', stt: '#8E6FB0', tts: '#C26B9A' };
  const costTotal = costRows.reduce((a: number, c: any) => a + (Number(c.v) || 0), 0) || 1;
  const costBreakdown = costRows.map((c: any) => ({
    k: costLabel[c.type] ?? c.type, v: Number(c.v) || 0, color: costColor[c.type] ?? '#4D6995',
    pct: Math.round(((Number(c.v) || 0) / costTotal) * 100),
  }));
  // Real per-DEPARTMENT / per-PRODUCT / per-PERSONA cost — every dollar attributed through the session join
  // (cost_events → demo_sessions → customer/product/persona). Replaces the old blended 'Cost / dept' metric.
  const slice = (rows: any[]) => rows.map((r: any) => ({ k: r.k ?? '—', v: Number(r.v) || 0, pct: Math.round(((Number(r.v) || 0) / costTotal) * 100) }));
  const costByDept = slice((await pool.query(`SELECT c.name AS k, coalesce(sum(ce.amount_usd),0)::float AS v FROM cost_events ce JOIN demo_sessions ds ON ds.id=ce.demo_session_id JOIN customers c ON c.id=ds.customer_id GROUP BY c.name ORDER BY v DESC`)).rows);
  const costByProduct = slice((await pool.query(`SELECT coalesce(p.name,'—') AS k, coalesce(sum(ce.amount_usd),0)::float AS v FROM cost_events ce JOIN demo_sessions ds ON ds.id=ce.demo_session_id LEFT JOIN product_versions pv ON pv.id=ds.product_version_id LEFT JOIN products p ON p.id=pv.product_id GROUP BY p.name ORDER BY v DESC`)).rows);
  const costByPersona = slice((await pool.query(`SELECT coalesce(per.name,'Lead Consultant') AS k, coalesce(sum(ce.amount_usd),0)::float AS v FROM cost_events ce JOIN demo_sessions ds ON ds.id=ce.demo_session_id LEFT JOIN personas per ON per.id=ds.persona_id GROUP BY per.name ORDER BY v DESC`)).rows);

  // ── evals (real eval_runs → per-suite cards + run history) ──
  const runRows = (await pool.query(
    `SELECT DISTINCT ON (suite) suite, passed, total, ran_at,
       (SELECT count(*)::int FROM eval_runs e2 WHERE e2.suite = e.suite) AS runs
       FROM eval_runs e ORDER BY suite, ran_at DESC`,
  )).rows;
  const evals = runRows.map((e: any) => ({
    id: e.suite, name: e.suite.replace(/^phase/, 'Phase '),
    score: e.total ? e.passed / e.total : 0, passed: e.passed ?? 0, total: e.total ?? 0, runs: e.runs ?? 1,
  }));
  const evalRuns = (await pool.query(`SELECT id, suite, passed, total, ran_at::text FROM eval_runs ORDER BY ran_at DESC LIMIT 8`)).rows.map((r: any) => ({
    id: r.id, suite: r.suite, passed: r.passed, total: r.total, when: relTime(r.ran_at),
  }));

  // ── governance dashboard (real, from the audit + event tables; empty until live sessions run) ──
  const govHandoffs = (await pool.query(
    `SELECT h.trigger, h.occurred_at::text AS at, f.name AS from_name, t.name AS to_name
       FROM persona_handoff_events h LEFT JOIN personas f ON f.id=h.from_persona_id LEFT JOIN personas t ON t.id=h.to_persona_id
      ORDER BY h.occurred_at DESC LIMIT 25`,
  )).rows.map((h: any) => ({ from: h.from_name ?? 'Lead Consultant', to: h.to_name ?? '—', trigger: h.trigger ?? 'operator', when: relTime(h.at) }));
  const govEscalations = (await pool.query(
    `SELECT e.trigger, e.reason, e.occurred_at::text AS at, s.name AS source_name, d.name AS dest_name
       FROM persona_escalation_events e LEFT JOIN personas s ON s.id=e.source_persona_id LEFT JOIN personas d ON d.id=e.destination_persona_id
      ORDER BY e.occurred_at DESC LIMIT 25`,
  )).rows.map((e: any) => ({ source: e.source_name ?? '—', dest: e.dest_name ?? '—', trigger: e.trigger ?? '', reason: e.reason ?? '', when: relTime(e.at) }));
  const govViolations = (await pool.query(
    `SELECT persona_name, compliance, occurred_at::text AS at FROM audit_turns
      WHERE (compliance->>'ok')='false' ORDER BY occurred_at DESC LIMIT 25`,
  )).rows.map((v: any) => ({ persona: v.persona_name ?? '—', action: v.compliance?.action ?? '—', rules: (v.compliance?.violations ?? []).map((x: any) => x.rule).join(', '), when: relTime(v.at) }));
  const govLowConf = (await pool.query(
    `SELECT persona_name, confidence_band, utterance, occurred_at::text AS at FROM audit_turns
      WHERE confidence_band IN ('low','very_low') ORDER BY occurred_at DESC LIMIT 25`,
  )).rows.map((r: any) => ({ persona: r.persona_name ?? '—', band: r.confidence_band, utterance: r.utterance ?? '', when: relTime(r.at) }));
  const govUsage = (await pool.query(
    `SELECT persona_name, count(*)::int AS turns FROM audit_turns WHERE persona_name IS NOT NULL GROUP BY persona_name ORDER BY turns DESC LIMIT 12`,
  )).rows.map((u: any) => ({ persona: u.persona_name, turns: u.turns }));
  const fresh = (await pool.query(
    `SELECT count(*) FILTER (WHERE last_verified >= now() - interval '180 days')::int AS fresh,
            count(*) FILTER (WHERE last_verified IS NULL OR last_verified < now() - interval '180 days')::int AS stale,
            count(*)::int AS total FROM knowledge_chunks`,
  )).rows[0];
  // TRUE totals via count(*) — the lists above are LIMIT-capped for display; counts must not be (else
  // they'd silently under-report once any event type exceeds the display cap).
  const gc = (await pool.query<{ handoffs: string; escalations: string; violations: string; lowconf: string; execblocks: string; audits: string; personas: string }>(
    `SELECT (SELECT count(*) FROM persona_handoff_events) AS handoffs,
            (SELECT count(*) FROM persona_escalation_events) AS escalations,
            (SELECT count(*) FROM audit_turns WHERE (compliance->>'ok')='false') AS violations,
            (SELECT count(*) FROM audit_turns WHERE confidence_band IN ('low','very_low')) AS lowconf,
            (SELECT count(*) FROM audit_turns WHERE jsonb_array_length(actions_rejected) > 0) AS execblocks,
            (SELECT count(*) FROM audit_turns) AS audits,
            (SELECT count(DISTINCT persona_name) FROM audit_turns WHERE persona_name IS NOT NULL) AS personas`,
  )).rows[0];
  const governance = {
    handoffs: govHandoffs, escalations: govEscalations, violations: govViolations, lowConfidence: govLowConf, usage: govUsage,
    freshness: { fresh: Number(fresh?.fresh) || 0, stale: Number(fresh?.stale) || 0, total: Number(fresh?.total) || 0 },
    totals: {
      handoffs: Number(gc?.handoffs) || 0, escalations: Number(gc?.escalations) || 0, violations: Number(gc?.violations) || 0,
      lowConfidence: Number(gc?.lowconf) || 0, executionBlocks: Number(gc?.execblocks) || 0, auditTurns: Number(gc?.audits) || 0,
      personasInUse: Number(gc?.personas) || 0,
    },
  };

  // ── Guided demo TOURS (record-and-replay) — the scripted-demo model the desktop records + plays ──
  const tours = (await pool.query(
    `SELECT id, product_id, name, description, steps FROM demo_tours WHERE archived_at IS NULL ORDER BY created_at DESC`,
  )).rows.map((t: any) => ({
    id: String(t.id), productId: String(t.product_id), name: String(t.name ?? ''), description: t.description ?? '',
    steps: Array.isArray(t.steps) ? t.steps.map((s: any) => ({ kind: String(s?.kind ?? 'note'), url: s?.url ?? '', selector: s?.selector ?? '', label: s?.label ?? '', value: s?.value ?? '', caption: s?.caption ?? '', nodeId: s?.nodeId ?? null })) : [],
  }));

  // Best-effort TOUR → NODE linkage (Phase 3): a tour step references a node when its selector matches one of
  // the node's locator_strategies OR its URL contains the node's screen_route. Read-time + fuzzy (labeled as
  // such in the UI) — no node ids are stored on tours (that's the Phase-4 re-model). Lets "who consumes me"
  // answer tours too, where provable; nodes with no match keep showing "Not yet modeled".
  for (const prod of products as any[]) {
    const ptours = tours.filter((t) => t.productId === prod.id);
    if (!ptours.length) continue;
    for (const node of prod.graphNodeStates as any[]) {
      const route = String(node.route || '').toLowerCase();
      const locVals = (Array.isArray(node.locators) ? node.locators : [])
        .map((l: any) => String((l && (l.value ?? l.selector)) ?? (typeof l === 'string' ? l : '')).toLowerCase()).filter(Boolean);
      const matched = ptours.filter((t) => (t.steps || []).some((s: any) => {
        if (s.nodeId && s.nodeId === node.id) return true; // EXACT — after tour.link (Phase 4 re-model)
        const sel = String(s.selector || '').toLowerCase();
        const url = String(s.url || '').toLowerCase();
        return (sel.length > 1 && locVals.some((lv: string) => lv === sel || lv.includes(sel) || sel.includes(lv)))
          || (route.length > 1 && url.includes(route)); // best-effort fallback (Phase 3)
      }));
      node.tourConsumers = matched.map((t) => ({ id: t.id, name: t.name }));
    }
  }

  // Phase 4 — Navigation-Authority Readiness gate, computed from REAL signals (the constitution's promotion
  // gates). The dashboard that governs whether the graph is ready to become the single navigation authority;
  // the actual hard-constrain flip of the desktop driver stays a deferred toggle until these all pass.
  for (const prod of products as any[]) {
    const nodes = prod.graphNodeStates as any[];
    const total = nodes.length;
    const withRoute = nodes.filter((n) => n.route).length;
    // Orphan = an active node no workflow's node_sequence references. This is NOT a defect: it's a real screen
    // reachable by intent in free-roam, just not part of a scripted workflow (peripheral admin/config/utility
    // screens are legitimately orphan). So it's reported as informational context, never a failure.
    const orphans = nodes.filter((n) => !(n.consumers && n.consumers.length)).length;
    // Dependency INTEGRITY is the opposite: a workflow step that points at a node which does NOT exist (a
    // DANGLING reference) — that's the real broken dependency. Compute it from the workflows' sequences.
    const nodeLabelSet = new Set(nodes.map((n) => String(n.label ?? '').toLowerCase()).filter(Boolean));
    const dangling: { workflow: string; ref: string }[] = [];
    for (const w of ((prod.workflows ?? []) as any[])) for (const e of (w.sequence ?? [])) if (!nodeLabelSet.has(String(e).toLowerCase())) dangling.push({ workflow: String(w?.name ?? ''), ref: String(e) });
    prod.graphDangling = dangling;        // surfaced for the Workflow Builder to flag + the operator to fix
    prod.graphOrphans = orphans;          // informational coverage signal
    const cov = prod.graphCoverage; // 0..1 | null
    const g = (ok: boolean, detail: string) => ({ ok, detail });
    const gates: Record<string, { ok: boolean; detail: string }> = {
      'Node observability': g(total > 0 && withRoute === total, total ? `${withRoute}/${total} active nodes have a route` : 'no active nodes'),
      'Intent visibility': g((prod.intentMap?.length ?? 0) > 0, `${prod.intentMap?.length ?? 0} intent(s) mapped`),
      'Navigation diagnostics': g((prod.navObserved ?? 0) > 0, `${prod.navObserved ?? 0} observed attempt(s)`),
      // Integrity = every workflow step resolves to a real node (no dangling refs). Orphans are shown as
      // context, not a failure — forcing every screen into a workflow would mean fabricating workflows.
      'Dependency mapping': g(dangling.length === 0, dangling.length ? `${dangling.length} dangling workflow ref(s)${orphans ? ` · ${orphans} unscripted screen(s)` : ''}` : (total ? `all workflow refs resolve${orphans ? ` · ${orphans} screen(s) reachable but unscripted` : ''}` : 'no active nodes')),
      'Verification': g(cov != null && cov >= 0.8, cov != null ? `coverage ${Math.round(cov * 100)}%` : 'not validated'),
      'Audit trail': g((prod.graphEventsCount ?? 0) > 0, `${prod.graphEventsCount ?? 0} graph event(s)`),
      'Versioning + rollback': g((prod.graphVersions?.length ?? 0) >= 1, `${prod.graphVersions?.length ?? 0} version(s)`),
    };
    const keys = Object.keys(gates);
    const passed = keys.filter((k) => gates[k].ok).length;
    prod.authorityReadiness = { gates: keys.map((k) => ({ name: k, ok: gates[k].ok, detail: gates[k].detail })), passed, total: keys.length, ready: passed === keys.length };
  }

  // ── Journeys (V5 Phase 2 — the orchestration layer). For each product, RESOLVE every story_flow ref to a
  // REAL asset (workflow/tour/knowledge) belonging to that product, at read time — reference integrity that
  // mirrors src/core/journeys.ts resolveStoryFlow (duplicated here over already-loaded data so the web app
  // stays decoupled from src/core). A dangling ref is FLAGGED ok=false, never dropped. runs come from
  // journey_runs (0 until a journey is actually walked — telemetry-gated, never a fabricated number). ──
  let journeyRows: any[] = [];
  try {
    journeyRows = (await pool.query(
      `SELECT j.product_id, j.id, j.name, j.business_goal, j.business_outcome_id, j.environment_id,
              j.story_flow, j.stakeholder_refs, j.specialist_rules, j.success_criteria, j.status, j.version, j.confidence,
              (SELECT count(*)::int FROM journey_runs r WHERE r.journey_id=j.id) AS runs,
              (SELECT count(*)::int FROM journey_runs r WHERE r.journey_id=j.id AND r.status='completed') AS runs_done
         FROM journeys j WHERE j.archived_at IS NULL ORDER BY j.created_at DESC`,
    )).rows;
  } catch { journeyRows = []; /* journeys absent pre-0021 → every product gets [] */ }
  const jByProduct: Record<string, any[]> = {};
  for (const r of journeyRows) (jByProduct[r.product_id] ??= []).push(r);

  for (const prod of products as any[]) {
    const wfName = new Map<string, string>((prod.workflows as any[]).map((w) => [w.id, w.name]));
    const tourName = new Map<string, string>(tours.filter((t) => t.productId === prod.id).map((t) => [t.id, t.name]));
    const kTitle = new Map<string, string>(knowledge.filter((k) => k.productId === prod.id).map((k) => [k.id, k.title]));
    const outcomeTitle = new Map<string, string>((prod.outcomes as any[]).map((o: any) => [o.id, o.title]));
    const committeeName = new Map<string, string>((prod.committee as any[]).map((m: any) => [m.id, m.name]));
    const resolveStep = (s: any) => {
      const kind = String(s?.kind ?? 'note');
      const refId = s?.refId ? String(s.refId) : null;
      const caption = s?.caption ?? '';
      if (kind === 'note') return { kind, refId: null, caption, label: (caption || '').trim() || '(note)', ok: true, reason: '' };
      if (!refId) return { kind, refId: null, caption, label: '(no reference)', ok: false, reason: 'no reference set' };
      const m = kind === 'workflow' ? wfName : kind === 'tour' ? tourName : kTitle;
      const label = m.get(refId);
      return label ? { kind, refId, caption, label, ok: true, reason: '' } : { kind, refId, caption, label: '(missing)', ok: false, reason: `${kind} not found or archived` };
    };
    prod.journeys = (jByProduct[prod.id] ?? []).map((j: any) => {
      const storyFlow = (Array.isArray(j.story_flow) ? j.story_flow : []).map(resolveStep);
      const stakeholderRefs = (Array.isArray(j.stakeholder_refs) ? j.stakeholder_refs : []).map(String);
      return {
        id: String(j.id), name: String(j.name ?? ''), businessGoal: j.business_goal ?? '',
        businessOutcomeId: j.business_outcome_id ?? null,
        outcomeTitle: j.business_outcome_id ? (outcomeTitle.get(j.business_outcome_id) ?? '(archived outcome)') : '',
        environmentId: j.environment_id ?? null,
        storyFlow, stakeholderRefs,
        stakeholderNames: stakeholderRefs.map((id: string) => committeeName.get(id) ?? '(archived)'),
        specialistRules: Array.isArray(j.specialist_rules) ? j.specialist_rules : [],
        successCriteria: j.success_criteria ?? '', status: String(j.status ?? 'draft'), version: Number(j.version ?? 1),
        runs: Number(j.runs ?? 0), runsDone: Number(j.runs_done ?? 0),
        missingCount: storyFlow.filter((s: any) => !s.ok).length, integrityOk: storyFlow.every((s: any) => s.ok),
        confidence: j.confidence ?? null,
      };
    });
  }

  // ── Gap Records (0025) — the Journey Assembler's persisted "missing upstream dependency" records, per product.
  // Open first, newest first. Absent pre-0025 → every product gets []. ──
  let gapRows: any[] = [];
  try {
    gapRows = (await pool.query(
      `SELECT product_id, id, journey_id, outcome_id, kind, title, detail, severity, status
         FROM gap_records WHERE archived_at IS NULL ORDER BY (status='open') DESC, created_at DESC`)).rows;
  } catch { gapRows = []; }
  const gapsByProduct: Record<string, any[]> = {};
  for (const g of gapRows) (gapsByProduct[g.product_id] ??= []).push({ id: String(g.id), kind: String(g.kind), title: String(g.title), detail: g.detail ?? '', severity: String(g.severity ?? 'weakens'), status: String(g.status ?? 'open'), outcomeId: g.outcome_id ?? '', journeyId: g.journey_id ?? '' });
  for (const prod of products as any[]) prod.gaps = gapsByProduct[prod.id] ?? [];

  // ── Org Chart (0024) — the REAL organization's people + reporting lines. job_title is the operator-assigned
  // ROLE (the import leaves it empty; never fabricated). Supervisor names + report counts resolved here over the
  // flat list (self-referential by source ids) so the editor can show the reporting tree. Absent pre-0024 → []. ──
  let orgPeople: any[] = [];
  try {
    const op = (await pool.query(
      `SELECT id, name, job_title, department, source_person_id, supervisor_source_id, location, photo_url, sort_order
         FROM org_people WHERE archived_at IS NULL ORDER BY sort_order, name`)).rows;
    const nameBySource = new Map<string, string>(op.filter((p: any) => p.source_person_id).map((p: any) => [String(p.source_person_id), String(p.name)]));
    const reportCount = new Map<string, number>();
    for (const p of op) { const sup = p.supervisor_source_id ? String(p.supervisor_source_id) : ''; if (sup) reportCount.set(sup, (reportCount.get(sup) ?? 0) + 1); }
    orgPeople = op.map((p: any) => ({
      id: String(p.id), name: String(p.name ?? ''), jobTitle: p.job_title ?? '', department: p.department ?? '',
      sourcePersonId: p.source_person_id ? String(p.source_person_id) : '',
      supervisorSourceId: p.supervisor_source_id ? String(p.supervisor_source_id) : '',
      supervisorName: p.supervisor_source_id ? (nameBySource.get(String(p.supervisor_source_id)) ?? '') : '',
      location: p.location ?? '', photoUrl: p.photo_url ?? '',
      reports: p.source_person_id ? (reportCount.get(String(p.source_person_id)) ?? 0) : 0, sortOrder: Number(p.sort_order ?? 0),
    }));
  } catch { orgPeople = []; }

  // ── AI Conversation History (0027) — recent LLM calls (prompt → reply), tagged to their session's product
  // + demo, so the view can group BY CONVERSATION (session) and filter by product / demo / date / function. ──
  let aiCalls: any[] = [];
  try {
    aiCalls = (await pool.query(`
      SELECT ac.id, ac.demo_session_id, ac.fn, ac.model, ac.system_prompt, ac.user_prompt, ac.reply,
             ac.input_tokens, ac.output_tokens, ac.created_at::text AS created_at,
             p.name AS product, cu.name AS demo, ds.execution_mode AS mode
        FROM ai_calls ac
        LEFT JOIN demo_sessions ds ON ds.id = ac.demo_session_id
        LEFT JOIN product_versions pv ON pv.id = ds.product_version_id
        LEFT JOIN products p ON p.id = pv.product_id
        LEFT JOIN customers cu ON cu.id = ds.customer_id
       ORDER BY ac.created_at DESC LIMIT 300`)).rows.map((r: any) => ({
      id: String(r.id), sessionId: r.demo_session_id ? String(r.demo_session_id) : '', fn: String(r.fn ?? 'llm'),
      model: r.model ?? '', systemPrompt: r.system_prompt ?? '', userPrompt: r.user_prompt ?? '', reply: r.reply ?? '',
      inTokens: Number(r.input_tokens ?? 0), outTokens: Number(r.output_tokens ?? 0),
      at: r.created_at ?? '', product: r.product ?? '', demo: r.demo ?? '', mode: r.mode ?? '',
    }));
  } catch { aiCalls = []; }

  return { workspace, mtdSpend, products, knowledge, kbTypes: KB_TYPES, personas, stakeholders, customers, sessions, evals, costBreakdown, costByDept, costByProduct, costByPersona, evalRuns, governance, tours, orgPeople, aiCalls } as VDType;
}
