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
    `SELECT p.id, p.name, p.metadata,
       av.version_label AS version,
       (SELECT array_agg(version_label ORDER BY created_at DESC) FROM product_versions WHERE product_id=p.id) AS versions,
       (SELECT count(*)::int FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=p.id) AS chunks,
       (SELECT count(*)::int FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=p.id AND kc.validation_status='validated') AS kb_validated,
       (SELECT count(*)::int FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=p.id AND kc.validation_status IN ('needs-review','unverified')) AS kb_review,
       (SELECT count(*)::int FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=p.id AND kc.validation_status='stale') AS kb_stale,
       (SELECT count(*)::int FROM demo_graph_nodes n JOIN demo_graphs g ON g.id=n.demo_graph_id WHERE g.product_id=p.id) AS graph_nodes,
       (SELECT count(*)::int FROM demo_graphs g WHERE g.product_id=p.id) AS graph_flows,
       (SELECT count(*)::int FROM demo_sessions ds JOIN product_versions pv ON pv.id=ds.product_version_id WHERE pv.product_id=p.id) AS demos,
       e.name AS env_name, e.connection_target, e.is_production, e.created_at AS env_created
     FROM products p
     LEFT JOIN LATERAL (SELECT version_label FROM product_versions WHERE product_id=p.id AND status='active' ORDER BY created_at DESC LIMIT 1) av ON true
     LEFT JOIN LATERAL (SELECT name, connection_target, is_production, created_at FROM environments WHERE product_id=p.id ORDER BY created_at LIMIT 1) e ON true
     WHERE p.name <> ALL($1::text[])
     ORDER BY p.created_at`,
    [TEST_PRODUCTS],
  )).rows;

  const products = prodRows.map((p: any, i: number) => {
    const meta = p.metadata || {};
    const chunks = p.chunks ?? 0;
    const pct = (n: number) => (chunks ? Math.round((n / chunks) * 100) : 0);
    return {
      id: p.id, name: p.name, domain: p.name,
      tagline: meta.tagline ?? '',
      version: (p.version ?? '—'), versions: (p.versions ?? []),
      mk: meta.mk ?? initials(p.name), color: meta.color ?? colorFor(p.name, i),
      status: chunks > 0 ? 'Ready' : 'Training',
      coverage: meta.coverage ?? pct(p.kb_validated),
      chunks, demos: p.demos ?? 0,
      kbValidated: pct(p.kb_validated), kbReview: pct(p.kb_review), kbStale: pct(p.kb_stale),
      env: p.env_name ?? '—',
      envStatus: p.connection_target ? 'Healthy' : 'Reset pending',
      lastReset: relTime(p.env_created),
      graphNodes: p.graph_nodes ?? 0, graphFlows: p.graph_flows ?? 0,
    };
  });

  // ── knowledge (real chunks + trust metadata) ──
  const kRows = (await pool.query(
    `SELECT kc.id, kc.content, kc.category, kc.confidence, kc.source,
            kc.last_verified::text AS last_verified, kc.validation_status,
            pv.version_label AS ver
       FROM knowledge_chunks kc
       JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
       LEFT JOIN product_versions pv ON pv.id = kc.product_version_id
       JOIN products p ON p.id = kb.product_id
      WHERE p.name <> ALL($1::text[])
      ORDER BY kc.confidence DESC NULLS LAST, kc.created_at DESC
      LIMIT 60`,
    [TEST_PRODUCTS],
  )).rows;
  const knowledge = kRows.map((k: any) => {
    const type = KB_TYPES[k.category] ? k.category : 'docs';
    const first = String(k.content).split(/(?<=[.!?])\s/)[0];
    return {
      id: k.id,
      title: first.length > 72 ? first.slice(0, 69) + '…' : first,
      content: k.content,
      type, conf: Number(k.confidence) || 0, source: k.source,
      verified: k.last_verified ? relTime(k.last_verified) : '—',
      ver: (k.ver ?? '—').toString().replace(/^v/i, ''),
      status: k.validation_status === 'validated' ? 'validated' : k.validation_status === 'stale' ? 'stale' : 'needs-review',
    };
  });

  // ── personas (real config) ──
  const personas = (await pool.query(`SELECT id, name, definition FROM personas ORDER BY name`)).rows.map((p: any, i: number) => ({
    id: p.id, name: p.name,
    scope: p.definition?.scope ?? '', limits: p.definition?.limits ?? '',
    calls: p.definition?.calls ?? 0, brand: p.definition?.brand ?? 'Approved',
    color: p.definition?.color ?? colorFor(p.name, i),
  }));

  // ── stakeholders (distinct, from real sessions) ──
  const stakeholders = (await pool.query(
    `SELECT DISTINCT ON (name, role) name, role, interests, open_items, is_active
       FROM stakeholders WHERE name IS NOT NULL ORDER BY name, role LIMIT 12`,
  )).rows.map((s: any, i: number) => ({
    id: `s${i + 1}`, name: s.name, role: s.role ?? '',
    initials: initials(s.name), color: colorFor(s.name, i),
    active: !!s.is_active,
    interest: arr(s.interests)[0] ?? '',
    open: arr(s.open_items).length, asked: arr(s.interests).length,
  }));

  // ── customers / departments (real + counts) ──
  const customers = (await pool.query(
    `SELECT c.id, c.name, c.metadata,
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
    conf: null as number | null, stakeholders: s.stakeholders ?? 0,
  }));

  // ── cost breakdown (aggregate real cost_events) ──
  const costRows = (await pool.query(`SELECT type, coalesce(sum(amount_usd),0)::float AS v FROM cost_events GROUP BY type ORDER BY v DESC`)).rows;
  const costLabel: Record<string, string> = { llm: 'LLM tokens', embeddings: 'Embeddings', navigation: 'Navigation / compute', compute: 'Compute', storage: 'Storage' };
  const costColor: Record<string, string> = { llm: '#002855', navigation: '#0097A9', embeddings: '#4D6995', compute: '#007D61', storage: '#B9975B' };
  const costTotal = costRows.reduce((a: number, c: any) => a + (Number(c.v) || 0), 0) || 1;
  const costBreakdown = costRows.map((c: any) => ({
    k: costLabel[c.type] ?? c.type, v: Number(c.v) || 0, color: costColor[c.type] ?? '#4D6995',
    pct: Math.round(((Number(c.v) || 0) / costTotal) * 100),
  }));

  // ── evals (real eval_runs → per-suite cards + run history) ──
  const runRows = (await pool.query(
    `SELECT DISTINCT ON (suite) suite, passed, total, ran_at,
       (SELECT count(*)::int FROM eval_runs e2 WHERE e2.suite = e.suite) AS runs
       FROM eval_runs e ORDER BY suite, ran_at DESC`,
  )).rows;
  const evals = runRows.map((e: any) => ({
    id: e.suite, name: e.suite.replace(/^phase/, 'Phase '),
    score: e.total ? e.passed / e.total : 0, target: 1, runs: e.runs ?? 1, trend: 'flat',
  }));
  const evalRuns = (await pool.query(`SELECT id, suite, passed, total, ran_at::text FROM eval_runs ORDER BY ran_at DESC LIMIT 8`)).rows.map((r: any) => ({
    id: r.id, suite: r.suite, passed: r.passed, total: r.total, when: relTime(r.ran_at),
  }));

  return { workspace, products, knowledge, kbTypes: KB_TYPES, personas, stakeholders, customers, sessions, evals, costBreakdown, evalRuns } as VDType;
}
