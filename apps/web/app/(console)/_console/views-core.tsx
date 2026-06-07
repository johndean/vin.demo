'use client';
/* VIN Demo console — core views: Dashboard, Products (ported from web/views-core.jsx). */
import { useState, useEffect } from 'react';
import { useData } from './data-context';
import { PageHead, Icon, ModeChip, Metric, Pill, type Go } from './shell';
import { Knowledge, DemoGraphInner, EnvironmentInner } from './views-build';

/* ============================ DASHBOARD ============================ */
export function Dashboard({ go }: { go: Go }) {
  const VD = useData();
  const { sessions, products } = VD;
  const live = sessions.find((s) => s.status === 'Live');
  return (
    <div className="page scroll">
      <PageHead overline={`Field Demos · ${VD.workspace.name}`}
        title="Demo operations"
        desc="One orchestrated consultant loop across every product. Read-only by default, every answer cited, every demo costed."
        actions={<><button className="btn btn-secondary"><Icon name="plus" size={14} /> New product</button><button className="btn btn-primary" onClick={() => go('sessions')}><Icon name="play" size={13} /> Plan a session</button></>} />

      {live && (
        <div className="card hatch" style={{ background: 'var(--color-navy)', border: 'none', marginBottom: 20, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 18, position: 'relative', overflow: 'hidden' }}>
          <div style={{ width: 9, height: 9, borderRadius: 99, background: 'var(--color-red)', boxShadow: '0 0 0 4px rgba(197,70,68,.3)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-steel-hover)', fontWeight: 800 }}>Live demo in progress</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginTop: 3 }}>{live.customer} — {live.scenario}</div>
            <div style={{ color: 'var(--color-light-steel)', fontSize: 13, marginTop: 2 }}>{live.product} · {live.stakeholders} stakeholders · running {live.dur}{live.conf != null ? ` · confidence ${Math.round(live.conf * 100)}%` : ''}</div>
          </div>
          <ModeChip mode={live.mode} />
          {/* Control room is the separate desktop app */}
          <a className="btn btn-on-dark" href="#" style={{ background: '#fff', color: 'var(--color-navy)' }}><Icon name="external" size={13} /> Open control room</a>
        </div>
      )}

      {(() => {
        const totalDemos = products.reduce((a, p) => a + p.demos, 0);
        const totalChunks = products.reduce((a, p) => a + p.chunks, 0);
        const totalSpend = VD.costBreakdown.reduce((a, c) => a + c.v, 0);
        return (
          <div className="grid cols-4" style={{ marginBottom: 22 }}>
            <Metric label="Demos run" value={String(totalDemos)} delta="all-time" dir="flat" />
            <Metric label="Products" value={String(products.length)} delta={`${products.filter((p) => p.status === 'Ready').length} ready`} dir="flat" />
            <Metric label="Knowledge chunks" value={totalChunks.toLocaleString()} delta="trust-tagged" dir="flat" />
            <Metric label="Cost / demo" value={totalDemos ? `$${(totalSpend / totalDemos).toFixed(2)}` : '—'} delta="across all demos" dir="flat" />
          </div>
        );
      })()}

      <div className="grid" style={{ gridTemplateColumns: '1.55fr 1fr', marginBottom: 22 }}>
        <div className="card">
          <div className="card-hd"><h3>Recent demo sessions</h3><a className="btn btn-ghost btn-sm" onClick={() => go('sessions')}>View all <Icon name="arrow" size={13} /></a></div>
          <table className="tbl">
            <thead><tr><th>Department</th><th>Scenario</th><th>Mode</th><th>Conf.</th><th>Cost</th><th>Status</th></tr></thead>
            <tbody>
              {sessions.slice(0, 5).map((s) => (
                <tr key={s.id} onClick={() => go('sessions')}>
                  <td><div className="cell-strong">{s.customer}</div><div className="cell-sub">{s.product} · {s.when}</div></td>
                  <td>{s.scenario}</td>
                  <td><ModeChip mode={s.mode} /></td>
                  <td className="tnum">{s.conf == null ? '—' : `${Math.round(s.conf * 100)}%`}</td>
                  <td className="tnum">${s.cost.toFixed(2)}</td>
                  <td>{s.status === 'Live' ? <Pill kind="danger" dot>Live</Pill> : s.status === 'Recovered' ? <Pill kind="warn">Recovered</Pill> : <Pill kind="success">Done</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card card-pad">
            <div className="overline" style={{ marginBottom: 12 }}>Attention</div>
            {(() => {
              const attn = products.reduce((a, p) => a + Math.round(p.chunks * (p.kbStale + p.kbReview) / 100), 0);
              const needReset = products.filter((p) => p.envStatus !== 'Healthy');
              if (!attn && !needReset.length) {
                return <div className="banner" style={{ background: '#e2f1ec', borderLeft: '4px solid var(--color-green)', color: 'var(--color-navy)' }}><Icon name="check" size={18} style={{ color: 'var(--color-green)' }} /><div><strong>All clear.</strong> Knowledge is validated and current; every environment is configured for demo-only routing.</div></div>;
              }
              return (
                <>
                  {attn > 0 && (
                    <div className="banner banner-warn" style={{ marginBottom: needReset.length ? 10 : 0 }}>
                      <Icon name="alert" size={18} style={{ color: 'var(--color-amber)' }} />
                      <div><strong>{attn} knowledge chunk{attn > 1 ? 's' : ''} need attention.</strong> Below-threshold or stale chunks degrade to &quot;I&apos;m not certain.&quot; <a onClick={() => go('knowledge')} style={{ display: 'block', marginTop: 2 }}>Review knowledge →</a></div>
                    </div>
                  )}
                  {needReset.length > 0 && (
                    <div className="banner banner-info">
                      <Icon name="refresh" size={18} style={{ color: 'var(--color-blue)' }} />
                      <div><strong>{needReset.length} environment{needReset.length > 1 ? 's' : ''} need a reset.</strong> <a onClick={() => go('environments')} style={{ display: 'block', marginTop: 2 }}>Open environments →</a></div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          <div className="card card-pad">
            <div className="flex between items-center" style={{ marginBottom: 12 }}><div className="overline">Cost this month</div><a className="btn btn-ghost btn-sm" onClick={() => go('costs')}>Details</a></div>
            <div className="flex items-center gap-3" style={{ alignItems: 'baseline' }}><div style={{ fontSize: 32, fontWeight: 800, color: 'var(--color-navy)' }} className="tnum">${VD.costBreakdown.reduce((a, c) => a + c.v, 0).toFixed(2)}</div><span className="muted" style={{ fontSize: 12 }}>all demos</span></div>
            <div style={{ height: 8, borderRadius: 99, background: 'var(--color-light-steel)', overflow: 'hidden', margin: '12px 0 6px', display: 'flex' }}>
              {VD.costBreakdown.map((c) => <i key={c.k} style={{ width: `${c.pct}%`, background: c.color }} />)}
            </div>
            <div className="flex" style={{ flexWrap: 'wrap', gap: '4px 14px' }}>
              {VD.costBreakdown.map((c) => <span key={c.k} className="muted" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: c.color, display: 'inline-block' }} />{c.k}</span>)}
            </div>
          </div>
        </div>
      </div>

      <div className="card-hd" style={{ border: 'none', padding: 0, marginBottom: 14 }}><h3 style={{ fontSize: 18 }}>Products</h3><a className="btn btn-ghost btn-sm" onClick={() => go('products')}>Manage <Icon name="arrow" size={13} /></a></div>
      <div className="grid cols-3">
        {products.map((p) => <ProductCard key={p.id} p={p} onClick={() => go('products', p.id)} />)}
      </div>
    </div>
  );
}

function ProductCard({ p, onClick }: { p: any; onClick: () => void }) {
  return (
    <div className="card" style={{ cursor: 'pointer', transition: 'transform .3s var(--easing-out), box-shadow .3s' }} onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}>
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="flex between items-center">
          <div className="flex items-center gap-3">
            <span style={{ width: 38, height: 38, borderRadius: 9, background: p.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15 }}>{p.mk}</span>
            <div><div style={{ fontWeight: 800, fontSize: 16, color: 'var(--color-navy)' }}>{p.name}</div><div className="muted" style={{ fontSize: 12 }}>v{p.version}</div></div>
          </div>
          {p.status === 'Ready' ? <Pill kind="success" dot>Ready</Pill> : <Pill kind="warn" dot>Training</Pill>}
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{p.tagline}</p>
        <div className="flex between" style={{ fontSize: 12 }}>
          <span className="muted">Coverage</span><span style={{ fontWeight: 700, color: 'var(--color-navy)' }}>{p.coverage}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: 'var(--color-light-steel)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${p.coverage}%`, background: p.coverage > 80 ? 'var(--color-green)' : p.coverage > 60 ? 'var(--color-amber)' : 'var(--color-red)' }} /></div>
        <div className="flex between" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, fontSize: 12 }}>
          <span className="muted">{p.chunks.toLocaleString()} chunks</span><span className="muted">{p.demos} demos run</span>
        </div>
      </div>
    </div>
  );
}

/* ============================ PRODUCTS ============================ */
export function Products({ go, selected }: { go: Go; selected?: string | null }) {
  const VD = useData();
  const [sel, setSel] = useState<string | null>(selected || null);
  useEffect(() => { setSel(selected || null); }, [selected]);
  const { products } = VD;
  if (sel) { const p = products.find((x) => x.id === sel); if (p) return <ProductDetail p={p} go={go} back={() => setSel(null)} />; }
  return (
    <div className="page scroll">
      <PageHead overline="Library" title="Products" desc="Each product VIN Demo can demonstrate carries its own version, knowledge base, demo graph, and demo environment. Build the relations now; lifecycle automation comes later."
        actions={<button className="btn btn-primary"><Icon name="plus" size={14} /> Add product</button>} />
      <div className="grid cols-3">{products.map((p) => <ProductCard key={p.id} p={p} onClick={() => setSel(p.id)} />)}</div>
      <div className="banner banner-info section-gap"><Icon name="info" size={18} style={{ color: 'var(--color-blue)' }} />
        <div><strong>Onboarding is still manual.</strong> Self-service &quot;Add → Train → Demo&quot; unlocks once the adapter contract is stable across three hand-onboarded products (currently {products.length}).</div></div>
    </div>
  );
}

const PROD_TABS = ['Overview', 'Versions', 'Knowledge base', 'Demo graph', 'Environment'];
function ProductDetail({ p, go, back }: { p: any; go: Go; back: () => void }) {
  const [tab, setTab] = useState('Overview');
  return (
    <div className="page scroll">
      <PageHead crumbs={[{ label: 'Products', to: 'products' }, { label: p.name }]} go={(r) => { if (r === 'products') back(); else go(r); }}
        overline={`v${p.version} · ${p.tagline}`} title={<span className="flex items-center gap-3"><span style={{ width: 34, height: 34, borderRadius: 8, background: p.color, color: '#fff', display: 'inline-grid', placeItems: 'center', fontWeight: 800, fontSize: 14 }}>{p.mk}</span>{p.name}</span>}
        actions={<><button className="btn btn-secondary"><Icon name="edit" size={13} /> Edit</button><a className="btn btn-primary" href="#"><Icon name="play" size={13} /> Launch demo</a></>} />
      <div className="tabs">{PROD_TABS.map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'Overview' && <ProductOverview p={p} setTab={setTab} />}
      {tab === 'Versions' && <ProductVersions p={p} />}
      {tab === 'Knowledge base' && <Knowledge embedded productName={p.name} go={go} />}
      {tab === 'Demo graph' && <DemoGraphInner p={p} />}
      {tab === 'Environment' && <EnvironmentInner p={p} />}
    </div>
  );
}

function ProductOverview({ p, setTab }: { p: any; setTab: (t: string) => void }) {
  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <Metric label="Demo coverage" value={`${p.coverage}%`} delta="of graph reachable" dir="flat" />
        <Metric label="Knowledge chunks" value={p.chunks.toLocaleString()} delta={`${p.kbValidated}% validated`} dir="up" />
        <Metric label="Demos run" value={p.demos} delta="all-time" dir="flat" />
        <Metric label="Graph nodes" value={p.graphNodes} delta={`${p.graphFlows} flows`} dir="flat" />
      </div>
      <div className="grid cols-2">
        <div className="card">
          <div className="card-hd"><h3>Entity model</h3><span className="tag">persisted</span></div>
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {([['Version', `v${p.version} · ${p.versions.length} tracked`, 'Versions'], ['Knowledge base', `${p.chunks.toLocaleString()} chunks · trust metadata`, 'Knowledge base'], ['Demo graph', `${p.graphNodes} screens · ${p.graphFlows} workflows`, 'Demo graph'], ['Environment', `${p.env} · ${p.envStatus}`, 'Environment']] as [string, string, string][]).map(([k, v, to]) => (
              <button key={k} className="flex between items-center" onClick={() => setTab(to)} style={{ background: 'var(--color-off-white)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '11px 14px', cursor: 'pointer', textAlign: 'left' }}>
                <div><div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-navy)' }}>{k}</div><div className="muted" style={{ fontSize: 12 }}>{v}</div></div>
                <Icon name="chevR" size={14} style={{ color: 'var(--color-steel)' }} />
              </button>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-hd"><h3>Knowledge health</h3><a className="btn btn-ghost btn-sm" onClick={() => setTab('Knowledge base')}>Open</a></div>
          <div className="card-pad">
            <div style={{ display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', marginBottom: 14 }}>
              <i style={{ width: `${p.kbValidated}%`, background: 'var(--color-green)' }} /><i style={{ width: `${p.kbReview}%`, background: 'var(--color-amber)' }} /><i style={{ width: `${p.kbStale}%`, background: 'var(--color-red)' }} />
            </div>
            {([['Validated', p.kbValidated, 'var(--color-green)'], ['Needs review', p.kbReview, 'var(--color-amber)'], ['Stale', p.kbStale, 'var(--color-red)']] as [string, number, string][]).map(([k, v, c]) => (
              <div key={k} className="flex between items-center" style={{ padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span className="flex items-center gap-2" style={{ fontSize: 13 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{k}</span><span style={{ fontWeight: 700 }} className="tnum">{v}%</span>
              </div>
            ))}
            <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>Stale or low-confidence chunks trigger graceful degradation in live demos — the consultant says &quot;I&apos;m not certain&quot; and offers the source rather than guessing.</p>
          </div>
        </div>
      </div>
    </>
  );
}

function ProductVersions({ p }: { p: any }) {
  return (
    <div className="card">
      <div className="card-hd"><h3>Versions</h3><span className="tag">lifecycle engine deferred</span></div>
      <table className="tbl">
        <thead><tr><th>Version</th><th>State</th><th>Knowledge synced</th><th>Demos</th><th></th></tr></thead>
        <tbody>
          {p.versions.map((v: string, i: number) => (
            <tr key={v}>
              <td className="cell-strong">{v.replace(' (current)', '')}</td>
              <td>{i === 0 ? <Pill kind="success" dot>Current</Pill> : i === 1 ? <Pill kind="info">Supported</Pill> : <Pill kind="neutral">Archived</Pill>}</td>
              <td>{i === 0 ? <Pill kind="success">In sync</Pill> : i < 2 ? <Pill kind="warn">Partial</Pill> : <Pill kind="danger">Out of date</Pill>}</td>
              <td className="tnum muted">{i === 0 ? p.demos : Math.max(0, p.demos - i * 7)}</td>
              <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-sm"><Icon name="chevR" size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="banner banner-info" style={{ margin: 16 }}><Icon name="info" size={18} style={{ color: 'var(--color-blue)' }} /><div>The version <strong>field</strong> exists on every knowledge chunk today (so answers can cite a version). The full <strong>lifecycle engine</strong> — release-sync, retirement, drift alerts — turns on at product #3 / the first version bump.</div></div>
    </div>
  );
}
