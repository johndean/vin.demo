'use client';
/* VIN Demo console — Library views: Knowledge, Demo Graphs, Environments, Personas
   (ported from web/views-build.jsx). */
import { useState } from 'react';
import { useData } from './data-context';
import { PageHead, Icon, Pill, ConfBar, VALIDATION, type Go } from './shell';

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
  return (
    <div className="page scroll">
      <PageHead overline="Library" title="Environments"
        desc="The interaction layer always points at a demo environment with seeded data and a reset mechanism — never a customer's live production tenant. Pointing at production requires an explicit, audited opt-in."
        actions={<button className="btn btn-primary"><Icon name="plus" size={14} /> New environment</button>} />
      <div className="banner banner-warn" style={{ marginBottom: 18 }}><Icon name="alert" size={18} style={{ color: 'var(--color-amber)' }} /><div><strong>Production routing is OFF for all environments.</strong> Demo data is part of the architecture — every demo runs against a reset-able tenant so a broken click can never touch real records.</div></div>
      <div className="grid cols-2">
        {VD.products.map((p) => <EnvCard key={p.id} p={p} />)}
      </div>
    </div>
  );
}

function EnvCard({ p }: { p: any }) {
  const healthy = p.envStatus === 'Healthy';
  return (
    <div className="card">
      <div className="card-hd">
        <div className="flex items-center gap-3"><span style={{ width: 30, height: 30, borderRadius: 7, background: p.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12 }}>{p.mk}</span><div><div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 14 }} className="mono">{p.env}</div><div className="muted" style={{ fontSize: 11.5 }}>{p.name}</div></div></div>
        {healthy ? <Pill kind="success" dot>Healthy</Pill> : <Pill kind="warn" dot>Reset pending</Pill>}
      </div>
      <div className="card-pad">
        <dl className="kv">
          <dt>Routing</dt><dd><Pill kind="info">Demo only</Pill></dd>
          <dt>Seed dataset</dt><dd>{p.name === 'demo.vin' ? '240 requests · 18 approvers · 6 vendors' : 'Scenario fixtures loaded'}</dd>
          <dt>Reset mechanism</dt><dd>Snapshot restore</dd>
          <dt>Last reset</dt><dd>{p.lastReset}</dd>
          <dt>Refresh cadence</dt><dd>Nightly + pre-session</dd>
        </dl>
        <div className="flex gap-2" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm"><Icon name="refresh" size={13} /> Reset now</button>
          <button className="btn btn-ghost btn-sm"><Icon name="external" size={13} /> Open env</button>
        </div>
      </div>
    </div>
  );
}
export function EnvironmentInner({ p }: { p: any }) { return <div style={{ maxWidth: 560 }}><EnvCard p={p} /></div>; }

/* ============================ PERSONAS ============================ */
export function Personas({ go }: { go: Go }) {
  const VD = useData();
  return (
    <div className="page scroll">
      <PageHead overline="Library" title="Personas"
        desc="Delegated specialists the consultant can hand off to mid-demo for deep questions. Each has a defined scope and brand / legal limits — they cite docs and never over-commit."
        actions={<button className="btn btn-primary"><Icon name="plus" size={14} /> New persona</button>} />
      <div className="grid cols-3">
        {VD.personas.map((p) => (
          <div key={p.id} className="card card-pad">
            <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
              <span className="avatar-sm" style={{ width: 40, height: 40, fontSize: 14, background: p.color }}>{p.name.split(' ').map((w) => w[0]).join('')}</span>
              <div><div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{p.name}</div><Pill kind="success" dot>{p.brand}</Pill></div>
            </div>
            <div className="overline" style={{ marginBottom: 5 }}>Scope</div>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 14px', lineHeight: 1.5 }}>{p.scope}</p>
            <div className="overline" style={{ marginBottom: 5 }}>Limits</div>
            <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5, color: 'var(--color-amber)', display: 'flex', gap: 7 }}><Icon name="lock" size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {p.limits}</p>
            <div className="flex between" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 14, fontSize: 12 }}><span className="muted">Hand-offs this month</span><span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.calls}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
