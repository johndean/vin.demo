'use client';
/* VIN Demo console — Library views: Knowledge, Demo Graphs, Environments, Personas
   (ported from web/views-build.jsx). */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from './data-context';
import { PageHead, Icon, Pill, ConfBar, VALIDATION, type Go } from './shell';
import { FormShell, Field } from './Modal';
import { adminMutate } from './admin';

/* ============================ KNOWLEDGE ============================ */
export function Knowledge({ go, embedded, productName }: { go?: Go; embedded?: boolean; productName?: string }) {
  const VD = useData();
  const { knowledge, kbTypes } = VD;
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState<any>(knowledge[0]);
  const filtered = filter === 'all' ? knowledge : knowledge.filter((k) => k.status === filter);
  return (
    <div className={embedded ? '' : 'page scroll'}>
      {!embedded && (
        <PageHead overline="Library" title="Knowledge"
          desc="Every chunk carries trust metadata — confidence, source, last-verified, product version, and validation status. Stale or low-confidence knowledge degrades gracefully in live demos instead of being asserted."
          actions={<><button className="btn btn-secondary"><Icon name="refresh" size={13} /> Re-ingest</button><button className="btn btn-primary"><Icon name="plus" size={14} /> Add source</button></>} />
      )}
      {!embedded && (
        <div className="banner banner-info" style={{ marginBottom: 18 }}><Icon name="info" size={18} style={{ color: 'var(--color-blue)' }} />
          <div><strong>Trust metadata is a hard schema requirement.</strong> An answer below the confidence threshold or tied to a stale product version degrades to &quot;let me show you the source / I&apos;m not certain.&quot; Categories include docs, FAQ, SOP, release notes, and competitive positioning.</div></div>
      )}
      <div className="flex between items-center" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {([['all', 'All', knowledge.length], ['validated', 'Validated', knowledge.filter((k) => k.status === 'validated').length], ['needs-review', 'Needs review', knowledge.filter((k) => k.status === 'needs-review').length], ['stale', 'Stale', knowledge.filter((k) => k.status === 'stale').length]] as [string, string, number][]).map(([id, lbl, n]) => (
            <button key={id} className={`btn btn-sm ${filter === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(id)}>{lbl} <span style={{ opacity: .7 }}>{n}</span></button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{embedded ? `${productName} knowledge base` : 'demo.vin · v3.4'}</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tbl">
            <thead><tr><th>Chunk</th><th>Type</th><th>Conf.</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((k) => (
                <tr key={k.id} onClick={() => setSel(k)} style={sel?.id === k.id ? { background: 'var(--app-active)' } : {}}>
                  <td><div className="cell-strong">{k.title}</div><div className="cell-sub mono">{k.source}</div></td>
                  <td><Pill kind={kbTypes[k.type].cls.replace('pill-', '')}>{kbTypes[k.type].label}</Pill></td>
                  <td style={{ minWidth: 110 }}><div className="flex items-center gap-2"><ConfBar v={k.conf} max={70} /><span className="tnum" style={{ fontSize: 12, fontWeight: 700 }}>{Math.round(k.conf * 100)}</span></div></td>
                  <td><Pill kind={VALIDATION[k.status].kind} dot>{VALIDATION[k.status].label}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sel && <ChunkPanel k={sel} kbTypes={kbTypes} />}
      </div>
    </div>
  );
}

function ChunkPanel({ k, kbTypes }: { k: any; kbTypes: any }) {
  const conf = Math.round(k.conf * 100);
  const degrades = k.conf < 0.7 || k.status === 'stale';
  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div className="card-hd"><div><div className="overline">Chunk · trust metadata</div><h3 style={{ marginTop: 4, fontSize: 14, lineHeight: 1.3 }}>{k.title}</h3></div></div>
      <div className="card-pad">
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, fontStyle: 'italic', borderLeft: '2px solid var(--border-subtle)', paddingLeft: 12, margin: '0 0 18px' }}>
          &quot;{k.content}&quot;
        </p>
        <div className="trust">
          <div className="trust__row"><span className="trust__k">Confidence</span><ConfBar v={k.conf} /><span className="trust__v tnum">{conf}%</span></div>
          <div className="trust__row"><span className="trust__k">Source</span><span className="trust__v mono" style={{ fontSize: 12 }}>{k.source}</span></div>
          <div className="trust__row"><span className="trust__k">Last verified</span><span className="trust__v">{k.verified}</span></div>
          <div className="trust__row"><span className="trust__k">Product version</span><span className="trust__v">v{k.ver}</span></div>
          <div className="trust__row"><span className="trust__k">Category</span><span><Pill kind={kbTypes[k.type].cls.replace('pill-', '')}>{kbTypes[k.type].label}</Pill></span></div>
          <div className="trust__row"><span className="trust__k">Validation</span><span><Pill kind={VALIDATION[k.status].kind} dot>{VALIDATION[k.status].label}</Pill></span></div>
        </div>
        <hr className="divider" style={{ margin: '16px 0' }} />
        <div className="overline" style={{ marginBottom: 8 }}>Live-demo behavior</div>
        {degrades ? (
          <div className="banner banner-warn" style={{ fontSize: 12.5 }}><Icon name="alert" size={16} style={{ color: 'var(--color-amber)' }} /><div>Below threshold / stale → the consultant <strong>degrades</strong>: &quot;I&apos;m not certain — here&apos;s the source,&quot; and won&apos;t assert this in a demo.</div></div>
        ) : (
          <div className="banner" style={{ fontSize: 12.5, background: '#e2f1ec', borderLeft: '4px solid var(--color-green)', color: 'var(--color-navy)' }}><Icon name="check" size={16} style={{ color: 'var(--color-green)' }} /><div>Validated and current → the consultant will cite this with source + version when answering.</div></div>
        )}
        <div className="flex gap-2" style={{ marginTop: 14 }}><button className="btn btn-secondary btn-sm"><Icon name="edit" size={13} /> Edit</button><button className="btn btn-ghost btn-sm"><Icon name="refresh" size={13} /> Re-verify</button></div>
      </div>
    </div>
  );
}

/* ============================ DEMO GRAPHS ============================ */
export function DemoGraphs({ go }: { go: Go }) {
  const VD = useData();
  return (
    <div className="page scroll">
      <PageHead overline="Library" title="Demo Graphs"
        desc="Each product's feature / screen / workflow map. The consultant plans navigation over this graph — and self-heals when a real selector drifts from it."
        actions={<button className="btn btn-primary"><Icon name="plus" size={14} /> New graph</button>} />
      <div className="grid cols-3">
        {VD.products.map((p) => (
          <div key={p.id} className="card card-pad" style={{ cursor: 'pointer' }} onClick={() => go('products', p.id)}>
            <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
              <span style={{ width: 34, height: 34, borderRadius: 8, background: p.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{p.mk}</span>
              <div><div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{p.name}</div><div className="muted" style={{ fontSize: 12 }}>{p.graphNodes} screens · {p.graphFlows} workflows</div></div>
            </div>
            <MiniGraph color={p.color} />
            <div className="flex between" style={{ marginTop: 12, fontSize: 12 }}><span className="muted">Coverage</span><span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.coverage}%</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniGraph({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 280 110" style={{ width: '100%', height: 100, background: 'var(--app-surface-2)', borderRadius: 8 }}>
      <line x1="40" y1="55" x2="110" y2="30" stroke="var(--border-subtle)" strokeWidth="2" />
      <line x1="40" y1="55" x2="110" y2="80" stroke="var(--border-subtle)" strokeWidth="2" />
      <line x1="110" y1="30" x2="190" y2="30" stroke="var(--border-subtle)" strokeWidth="2" />
      <line x1="110" y1="80" x2="190" y2="80" stroke="var(--border-subtle)" strokeWidth="2" />
      <line x1="190" y1="30" x2="245" y2="55" stroke={color} strokeWidth="2" strokeDasharray="4 3" />
      <line x1="190" y1="80" x2="245" y2="55" stroke="var(--border-subtle)" strokeWidth="2" />
      {[[40, 55], [110, 30], [110, 80], [190, 30], [190, 80]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="9" fill="var(--surface-card)" stroke={i === 0 ? color : 'var(--border-subtle)'} strokeWidth="2.5" />)}
      <circle cx="245" cy="55" r="10" fill={color} />
    </svg>
  );
}

export function DemoGraphInner({ p }: { p: any }) {
  const nodes = [
    { id: 'home', label: 'Dashboard', x: 60, y: 150, kind: 'screen' },
    { id: 'approvals', label: 'Approvals', x: 230, y: 80, kind: 'screen' },
    { id: 'settings', label: 'Approval settings', x: 230, y: 220, kind: 'screen' },
    { id: 'delegation', label: 'Delegation rules', x: 430, y: 150, kind: 'feature' },
    { id: 'audit', label: 'Audit trail', x: 620, y: 80, kind: 'screen' },
    { id: 'create', label: 'New delegation', x: 620, y: 220, kind: 'workflow' },
  ];
  const edges = [['home', 'approvals'], ['home', 'settings'], ['approvals', 'delegation'], ['settings', 'delegation'], ['delegation', 'audit'], ['delegation', 'create']];
  const pos: Record<string, any> = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const kindColor: Record<string, string> = { screen: 'var(--color-steel)', feature: 'var(--color-navy)', workflow: 'var(--color-blue)' };
  return (
    <>
      <div className="flex gap-3" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {Object.entries(kindColor).map(([k, c]) => <span key={k} className="flex items-center gap-2" style={{ fontSize: 12 }}><i style={{ width: 11, height: 11, borderRadius: 3, background: c }} /><span className="muted" style={{ textTransform: 'capitalize' }}>{k}</span></span>)}
        <span className="flex items-center gap-2" style={{ fontSize: 12, marginLeft: 'auto' }}><span style={{ width: 18, height: 0, borderTop: '2px dashed var(--color-blue)' }} /><span className="muted">Active demo path</span></span>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <svg viewBox="0 0 720 300" style={{ width: '100%', display: 'block', background: 'var(--app-surface-2)' }}>
          {edges.map(([a, b], i) => {
            const active = (a === 'approvals' && b === 'delegation') || (a === 'delegation' && b === 'audit');
            return <line key={i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} stroke={active ? 'var(--color-blue)' : 'var(--border-subtle)'} strokeWidth={active ? 2.5 : 2} strokeDasharray={active ? '6 4' : '0'} />;
          })}
          {nodes.map((n) => (
            <g key={n.id}>
              <rect x={n.x - 56} y={n.y - 18} width="112" height="36" rx="8" fill="var(--surface-card)" stroke={kindColor[n.kind]} strokeWidth="2" />
              <circle cx={n.x - 42} cy={n.y} r="4" fill={kindColor[n.kind]} />
              <text x={n.x - 30} y={n.y + 4} fontSize="12" fontWeight="700" fill="var(--text-primary)" fontFamily="var(--font-family)">{n.label}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="banner banner-info section-gap"><Icon name="info" size={18} style={{ color: 'var(--color-blue)' }} /><div>The consultant plans the shortest path to the asked-about feature. If a live selector breaks, recovery re-grounds against this graph (role/label/nearby-text) rather than failing the demo.</div></div>
    </>
  );
}

/* ============================ ENVIRONMENTS ============================ */
export function Environments({ go }: { go: Go }) {
  const VD = useData();
  const [editing, setEditing] = useState<any | null | undefined>(undefined); // undefined=closed, null=new, obj=edit
  const [deleting, setDeleting] = useState<any | null>(null);
  return (
    <div className="page scroll">
      <PageHead overline="Library" title="Environments"
        desc="The interaction layer points at an environment with seeded data and a reset mechanism. Demo (non-production) is the default; pointing at a production tenant is an explicit, visible choice."
        actions={editing === undefined && !deleting ? <button className="btn btn-primary" onClick={() => setEditing(null)}><Icon name="plus" size={14} /> New environment</button> : undefined} />
      {editing !== undefined ? <EnvForm env={editing} products={VD.products} onClose={() => setEditing(undefined)} />
        : deleting ? <DeleteEnv env={deleting} onClose={() => setDeleting(null)} />
        : <div className="grid cols-2">
            {VD.products.map((p) => <EnvCard key={p.id} p={p} onEdit={() => setEditing(p)} onDelete={() => setDeleting(p)} />)}
          </div>}
    </div>
  );
}

const ENV_MODES = ['read-only', 'safe', 'approval', 'execution'];
/* Create / edit an environment — all real columns editable; belongs to a product. */
function EnvForm({ env, products, onClose }: { env: any | null; products: any[]; onClose: () => void }) {
  const router = useRouter();
  const [productId, setProductId] = useState(env?.id ?? products[0]?.id ?? '');
  const [name, setName] = useState(env?.env && env.env !== '—' ? env.env : '');
  const [url, setUrl] = useState(env?.connectionTarget ?? '');
  const [reset, setReset] = useState(env?.resetMechanism ?? '');
  const [cadence, setCadence] = useState(env?.refreshCadence ?? '');
  const [seed, setSeed] = useState(env?.seedDataset ?? '');
  const [isProd, setIsProd] = useState(!!env?.isProduction);
  const [mode, setMode] = useState(env?.defaultMode ?? 'read-only');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const editing = !!env?.envId;
  const save = async () => {
    if (!name.trim()) { setErr('Environment name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const fields = { name: name.trim(), connection_target: url.trim(), reset_mechanism: reset.trim(), refresh_cadence: cadence.trim(), seed_dataset: { summary: seed.trim() }, is_production: isProd, default_mode: mode };
      if (editing) await adminMutate('environment', 'update', { id: env.envId, data: fields });
      else await adminMutate('environment', 'create', { data: { ...fields, product_id: productId } });
      onClose(); router.refresh();
    } catch (e: any) { setErr(e?.message || 'Save failed'); setBusy(false); }
  };
  return (
    <FormShell title={editing ? `Edit environment · ${env.env}` : 'New environment'} subtitle={editing ? env.name : undefined} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save environment'}</button></>}>
      {!editing && <Field label="Product"><select value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((p: any) => <option key={p.id} value={p.id}>{p.domain}</option>)}</select></Field>}
      <Field label="Environment name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="demo-04" /></Field>
      <Field label="Connection target (URL)"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://po.vin" /></Field>
      <Field label="Seed dataset (description)"><input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="240 requests · 18 approvers · 6 vendors" /></Field>
      <div className="flex gap-2">
        <Field label="Reset mechanism"><input value={reset} onChange={(e) => setReset(e.target.value)} placeholder="snapshot / script / manual" /></Field>
        <Field label="Refresh cadence"><input value={cadence} onChange={(e) => setCadence(e.target.value)} placeholder="Nightly + pre-session" /></Field>
      </div>
      <div className="flex gap-2">
        <Field label="Default mode"><select value={mode} onChange={(e) => setMode(e.target.value)}>{ENV_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
        <Field label="Production tenant?"><select value={isProd ? 'yes' : 'no'} onChange={(e) => setIsProd(e.target.value === 'yes')}><option value="no">No — demo/QA</option><option value="yes">Yes — production</option></select></Field>
      </div>
      {isProd && <div className="modal__err" style={{ color: 'var(--color-amber, #9a6b1a)' }}>Production tenant — real data. The agent stays read-only unless explicitly raised.</div>}
      {err && <div className="modal__err">{err}</div>}
    </FormShell>
  );
}

function DeleteEnv({ env, onClose }: { env: any; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const del = async () => {
    setBusy(true); setErr('');
    try { await adminMutate('environment', 'delete', { id: env.envId }); onClose(); router.refresh(); }
    catch (e: any) { setErr(e?.message || 'Delete failed'); setBusy(false); }
  };
  return (
    <FormShell title="Delete environment" width={420} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" style={{ background: 'var(--color-danger, #a8332f)' }} onClick={del} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button></>}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-primary)' }}>Delete the <b>{env.env}</b> environment for <b>{env.name}</b>? Sessions that used it keep their history.</p>
      {err && <div className="modal__err">{err}</div>}
    </FormShell>
  );
}

const EXEC_MODES = [
  { id: 'read-only', label: 'Read-only — navigate & explain (no writes)' },
  { id: 'safe', label: 'Safe — + non-destructive actions' },
  { id: 'approval', label: 'Approval — writes need confirmation' },
  { id: 'execution', label: 'Execution — clicks, types & SAVES (real writes)' },
];
/* Per-site DEFAULT execution mode — what the desktop Control Room opens this product in (operator can
   still override per session). Persists to environments.default_mode via /api/console/product-mode. */
function ModeSelect({ p }: { p: any }) {
  const [mode, setMode] = useState<string>(p.defaultMode ?? 'read-only');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const change = async (m: string) => {
    setMode(m); setSaving('saving');
    try {
      const res = await fetch('/api/console/product-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: p.id, mode: m }) });
      setSaving(res.ok ? 'saved' : 'error');
    } catch { setSaving('error'); }
  };
  return (
    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
      <select value={mode} onChange={(e) => change(e.target.value)}
        style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line, #d4dae3)', background: 'var(--surface, #fff)', color: 'var(--text-primary, #1a2b45)' }}>
        {EXEC_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {mode === 'execution' && <Pill kind="warn">live writes</Pill>}
      {saving === 'saving' && <span className="muted" style={{ fontSize: 11 }}>saving…</span>}
      {saving === 'saved' && <span style={{ fontSize: 11, color: 'var(--ok, #1f7a52)' }}>saved ✓</span>}
      {saving === 'error' && <span style={{ fontSize: 11, color: 'var(--danger, #a8332f)' }}>save failed</span>}
    </div>
  );
}

function EnvCard({ p, onEdit, onDelete }: { p: any; onEdit?: () => void; onDelete?: () => void }) {
  const healthy = p.envStatus === 'Healthy';
  return (
    <div className="card">
      <div className="card-hd">
        <div className="flex items-center gap-3"><span style={{ width: 30, height: 30, borderRadius: 7, background: p.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12 }}>{p.mk}</span><div><div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 14 }} className="mono">{p.env}</div><div className="muted" style={{ fontSize: 11.5 }}>{p.name}</div></div></div>
        {healthy ? <Pill kind="success" dot>Healthy</Pill> : <Pill kind="warn" dot>Reset pending</Pill>}
      </div>
      <div className="card-pad">
        <dl className="kv">
          <dt>Routing</dt><dd>{p.isProduction ? <Pill kind="warn" dot>Production tenant</Pill> : <Pill kind="info">Demo only</Pill>}</dd>
          <dt>URL</dt><dd className="mono" style={{ fontSize: 12 }}>{p.connectionTarget || '—'}</dd>
          <dt>Default mode</dt><dd><ModeSelect p={p} /></dd>
          <dt>Seed dataset</dt><dd>{p.seedDataset || '—'}</dd>
          <dt>Reset mechanism</dt><dd>{p.resetMechanism || '—'}</dd>
          <dt>Last reset</dt><dd>{p.lastReset}</dd>
          <dt>Refresh cadence</dt><dd>{p.refreshCadence || '—'}</dd>
        </dl>
        {(onEdit || onDelete) && (
          <div className="flex gap-2" style={{ marginTop: 16 }}>
            {onEdit && <button className="btn btn-secondary btn-sm" onClick={onEdit}><Icon name="edit" size={13} /> Edit</button>}
            {p.connectionTarget && <a className="btn btn-ghost btn-sm" href={p.connectionTarget} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Open env</a>}
            {p.envId && onDelete && <button className="btn btn-ghost btn-sm" onClick={onDelete}><Icon name="x" size={13} /> Delete</button>}
          </div>
        )}
      </div>
    </div>
  );
}
export function EnvironmentInner({ p }: { p: any }) { return <div style={{ maxWidth: 560 }}><EnvCard p={p} /></div>; }

/* ============================ PERSONAS ============================ */
const PERSONA_STATUS = ['draft', 'review', 'approved', 'retired'];
const linesToArr = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const commaToArr = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
/* Create / edit a specialist persona — EVERY runtime field surfaced + editable. The config lives in
   definition jsonb and IS what the engine injects when this specialist is handed off to; status is a
   real column (only 'approved' can be activated). Site assignment scopes the specialist to products. */
function PersonaForm({ persona, onClose }: { persona: any | null; onClose: () => void }) {
  const router = useRouter();
  const VD = useData();
  const [name, setName] = useState(persona?.name ?? '');
  const [role, setRole] = useState(persona?.role ?? '');
  const [status, setStatus] = useState(persona?.status ?? 'approved');
  const [color, setColor] = useState(persona?.color ?? '#002855');
  const [systemPrompt, setSystemPrompt] = useState(persona?.systemPrompt ?? '');
  const [scope, setScope] = useState(persona?.scope ?? '');
  const [guardrails, setGuardrails] = useState((persona?.hardGuardrails?.length ? persona.hardGuardrails.join('\n') : persona?.limits) ?? '');
  const [expertise, setExpertise] = useState((persona?.expertiseDomains ?? []).join(', '));
  const [retrieval, setRetrieval] = useState((persona?.retrievalFilters ?? []).join(', '));
  const [allowed, setAllowed] = useState((persona?.allowedActions ?? []).join(', '));
  const [prohibited, setProhibited] = useState((persona?.prohibitedActions ?? []).join(', '));
  const [escalation, setEscalation] = useState((persona?.escalationRules ?? []).join('\n'));
  const [confidence, setConfidence] = useState<number>(persona?.confidenceThreshold ?? 0.7);
  const [voiceId, setVoiceId] = useState(persona?.voiceProfileId ?? '');
  const [sites, setSites] = useState<string[]>(persona?.productIds ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toggleSite = (id: string) => setSites((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (!systemPrompt.trim()) { setErr('A system prompt is required — it’s what focuses this specialist.'); return; }
    setBusy(true); setErr('');
    try {
      const guards = linesToArr(guardrails);
      const definition = {
        role: role.trim() || name.trim(), lead: persona?.lead ?? false, color, brand: 'Approved',
        scope, limits: guards.join(' · '), systemPrompt,
        expertiseDomains: commaToArr(expertise), hardGuardrails: guards,
        retrievalFilters: commaToArr(retrieval), allowedActions: commaToArr(allowed),
        prohibitedActions: commaToArr(prohibited), escalationRules: linesToArr(escalation),
        confidenceThreshold: Number(confidence) || 0.7, voiceProfileId: voiceId.trim() || null,
        productIds: sites,
      };
      const data = { name: name.trim(), status, definition };
      if (persona?.id) await adminMutate('persona', 'update', { id: persona.id, data });
      else await adminMutate('persona', 'create', { data });
      onClose(); router.refresh();
    } catch (e: any) { setErr(e?.message || 'Save failed'); setBusy(false); }
  };
  return (
    <FormShell title={persona ? `Edit ${persona.name}` : 'New specialist persona'} onClose={onClose} width={600}
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save persona'}</button></>}>
      <div className="flex gap-2">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Integration Engineer" /></Field>
        <Field label="Role"><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Integration Engineer" /></Field>
        <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}>{PERSONA_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
        <Field label="Color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ padding: 3, height: 38, width: 48 }} /></Field>
      </div>
      <Field label="System prompt — the runtime overlay the AI adopts when handed off to"><textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} style={{ minHeight: 130 }} placeholder="You are the Integration Engineer. Focus on APIs, SSO, SCIM… Do not promise roadmap or custom development. When uncertain, cite documentation." /></Field>
      <Field label="Scope (what this specialist covers)"><textarea value={scope} onChange={(e) => setScope(e.target.value)} placeholder="APIs, SSO, SCIM, ERP, webhooks, data flows" /></Field>
      <Field label="Hard guardrails (one per line — never violated)"><textarea value={guardrails} onChange={(e) => setGuardrails(e.target.value)} placeholder={'Do not promise future integrations\nDo not promise custom development\nWhen uncertain, cite documentation'} /></Field>
      <Field label="Escalation rules (one per line)"><textarea value={escalation} onChange={(e) => setEscalation(e.target.value)} placeholder={'Roadmap questions → lead consultant\nContractual terms → procurement'} /></Field>
      <div className="flex gap-2">
        <Field label="Expertise domains (comma)"><input value={expertise} onChange={(e) => setExpertise(e.target.value)} placeholder="APIs, Identity, Data exchange" /></Field>
        <Field label="Retrieval filters (comma)"><input value={retrieval} onChange={(e) => setRetrieval(e.target.value)} placeholder="api-docs, integration, sso" /></Field>
      </div>
      <div className="flex gap-2">
        <Field label="Allowed actions (comma)"><input value={allowed} onChange={(e) => setAllowed(e.target.value)} placeholder="navigate, explain" /></Field>
        <Field label="Prohibited actions (comma)"><input value={prohibited} onChange={(e) => setProhibited(e.target.value)} placeholder="submit, pay, delete" /></Field>
      </div>
      <div className="flex gap-2">
        <Field label="Confidence threshold (0–1)"><input type="number" min={0} max={1} step={0.05} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} /></Field>
        <Field label="Voice profile id (optional)"><input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} placeholder="consultant-f / executive-m …" /></Field>
      </div>
      <Field label="Assigned sites (none = available on every product)">
        <div className="persona-sites">
          {VD.products.map((p) => (
            <label key={p.id} className={`persona-site ${sites.includes(p.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={sites.includes(p.id)} onChange={() => toggleSite(p.id)} />
              <span className="persona-site__mk" style={{ background: p.color }}>{p.mk}</span>{p.domain}
            </label>
          ))}
        </div>
      </Field>
      {status !== 'approved' && <div className="modal__err" style={{ color: 'var(--color-amber, #9a6b1a)' }}>Only <b>approved</b> personas can be handed off to in a live demo.</div>}
      {err && <div className="modal__err">{err}</div>}
    </FormShell>
  );
}

function DeletePersona({ persona, onClose }: { persona: any; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const del = async () => {
    setBusy(true); setErr('');
    try { await adminMutate('persona', 'delete', { id: persona.id }); onClose(); router.refresh(); }
    catch (e: any) { setErr(e?.message || 'Delete failed'); setBusy(false); }
  };
  return (
    <FormShell title="Delete persona" onClose={onClose} width={400}
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" style={{ background: 'var(--color-danger, #a8332f)' }} onClick={del} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button></>}>
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>Delete <b>{persona.name}</b>? This removes the persona permanently.</p>
      {err && <div className="modal__err">{err}</div>}
    </FormShell>
  );
}

export function Personas({ go }: { go: Go }) {
  const VD = useData();
  const [editing, setEditing] = useState<any | null | undefined>(undefined); // undefined = closed, null = new, object = edit
  const [deleting, setDeleting] = useState<any | null>(null);
  return (
    <div className="page scroll">
      <PageHead overline="Library" title="Personas"
        desc="Delegated specialists the consultant can hand off to mid-demo for deep questions. Each has a defined scope and brand / legal limits — they cite docs and never over-commit."
        actions={editing === undefined && !deleting ? <button className="btn btn-primary" onClick={() => setEditing(null)}><Icon name="plus" size={14} /> New persona</button> : undefined} />
      {editing !== undefined ? <PersonaForm persona={editing} onClose={() => setEditing(undefined)} />
        : deleting ? <DeletePersona persona={deleting} onClose={() => setDeleting(null)} />
        : <div className="grid cols-3">
        {VD.personas.map((p) => (
          <div key={p.id} className="card card-pad">
            <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
              <span className="avatar-sm" style={{ width: 40, height: 40, fontSize: 14, background: p.color }}>{p.name.split(' ').map((w) => w[0]).join('')}</span>
              <div><div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{p.name}{p.lead ? ' · default' : ''}</div><Pill kind={p.status === 'approved' ? 'success' : p.status === 'retired' ? 'steel' : 'warn'} dot>{p.status}</Pill></div>
            </div>
            <div className="overline" style={{ marginBottom: 5 }}>Scope</div>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 14px', lineHeight: 1.5 }}>{p.scope}</p>
            <div className="overline" style={{ marginBottom: 5 }}>Limits</div>
            <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5, color: 'var(--color-amber)', display: 'flex', gap: 7 }}><Icon name="lock" size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {p.limits}</p>
            <div className="flex between" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 14, fontSize: 12 }}><span className="muted">Hand-offs this month</span><span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.calls}</span></div>
            <div className="card-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(p)}><Icon name="edit" size={12} /> Edit</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(p)}><Icon name="x" size={12} /> Delete</button>
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}
