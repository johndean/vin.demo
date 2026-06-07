'use client';
/* VIN Demo console — Pipeline + Operations views (ported from web/views-ops.jsx). */
import { useState, useEffect } from 'react';
import { useData } from './data-context';
import { PageHead, Icon, Pill, ModeChip, Avatar, Metric, type Go } from './shell';

/* ============================ CUSTOMERS ============================ */
export function Customers({ go, selected }: { go: Go; selected?: string | null }) {
  const VD = useData();
  const [sel, setSel] = useState<string | null>(selected || null);
  useEffect(() => { setSel(selected || null); }, [selected]);
  const { customers } = VD;
  if (sel) { const c = customers.find((x) => x.id === sel); if (c) return <CustomerDetail c={c} go={go} back={() => setSel(null)} />; }
  return (
    <div className="page scroll">
      <PageHead overline="Pipeline" title="Departments"
        desc="Departments evaluating the products. Each carries demo sessions and a stakeholder graph — a collection of roles, interests, and open items tracked per person."
        actions={<button className="btn btn-primary"><Icon name="plus" size={14} /> Add department</button>} />
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>Department</th><th>Stage</th><th>Product</th><th>Stakeholders</th><th>Sessions</th><th>Next</th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} onClick={() => setSel(c.id)}>
                <td><div className="flex items-center gap-3"><Avatar initials={c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')} color={c.color} size={30} /><div><div className="cell-strong">{c.name}</div><div className="cell-sub">{c.seg}</div></div></div></td>
                <td>{c.hot ? <Pill kind="danger" dot>Live demo</Pill> : c.stage === 'Demo scheduled' ? <Pill kind="info">{c.stage}</Pill> : c.stage === 'Follow-up' ? <Pill kind="warn">{c.stage}</Pill> : <Pill kind="neutral">{c.stage}</Pill>}</td>
                <td><span className="mono" style={{ fontSize: 12 }}>{c.product}</span></td>
                <td className="tnum">{c.stakeholders}</td>
                <td className="tnum">{c.sessions}</td>
                <td><span className="muted" style={{ fontSize: 12.5 }}>{c.next}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerDetail({ c, go, back }: { c: any; go: Go; back: () => void }) {
  const VD = useData();
  const { stakeholders, sessions } = VD;
  const custSessions = sessions.filter((s) => s.customer === c.name);
  return (
    <div className="page scroll">
      <PageHead crumbs={[{ label: 'Departments', to: 'customers' }, { label: c.name }]} go={(r) => { if (r === 'customers') back(); else go(r); }}
        overline={c.seg} title={<span className="flex items-center gap-3"><Avatar initials={c.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')} color={c.color} size={32} />{c.name}</span>}
        actions={<><button className="btn btn-secondary"><Icon name="plus" size={13} /> Add stakeholder</button>{c.hot ? <a className="btn btn-primary" href="#"><Icon name="external" size={13} /> Open control room</a> : <button className="btn btn-primary"><Icon name="sessions" size={13} /> Plan session</button>}</>} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 6 }}>
        <div className="overline">Stakeholder graph · {stakeholders.length} people</div>
      </div>
      <div className="grid cols-3" style={{ marginBottom: 24 }}>
        {stakeholders.map((s) => (
          <div key={s.id} className="card card-pad" style={{ borderColor: s.active ? 'var(--color-blue)' : 'var(--border-subtle)' }}>
            <div className="flex items-center gap-3" style={{ marginBottom: 10 }}>
              <Avatar initials={s.initials} color={s.color} size={36} />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{s.name}</div><div className="muted" style={{ fontSize: 12 }}>{s.role}</div></div>
              {s.active && <Pill kind="info" dot>Active</Pill>}
            </div>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '0 0 12px' }}>{s.interest}</p>
            <div className="flex between" style={{ fontSize: 11.5, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
              <span className="muted">{s.asked} questions raised</span>
              <span style={{ fontWeight: 700, color: s.open ? 'var(--color-amber)' : 'var(--color-green)' }}>{s.open ? `${s.open} open item${s.open > 1 ? 's' : ''}` : 'All resolved'}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-hd"><h3>Demo sessions</h3><a className="btn btn-ghost btn-sm" onClick={() => go('sessions')}>All sessions</a></div>
        {custSessions.length ? (
          <table className="tbl"><thead><tr><th>Scenario</th><th>Product</th><th>When</th><th>Mode</th><th>Conf.</th><th>Cost</th></tr></thead>
            <tbody>{custSessions.map((s) => (<tr key={s.id} onClick={() => go('sessions')}><td className="cell-strong">{s.scenario}</td><td className="mono" style={{ fontSize: 12 }}>{s.product}</td><td className="muted">{s.when}</td><td><ModeChip mode={s.mode} /></td><td className="tnum">{s.conf == null ? '—' : `${Math.round(s.conf * 100)}%`}</td><td className="tnum">${s.cost.toFixed(2)}</td></tr>))}</tbody>
          </table>
        ) : <div className="empty">No sessions yet — this prospect is still qualifying.</div>}
      </div>
    </div>
  );
}

/* ============================ SESSIONS ============================ */
export function Sessions({ go }: { go: Go }) {
  const VD = useData();
  const { sessions } = VD;
  const live = sessions.find((s) => s.status === 'Live');
  return (
    <div className="page scroll">
      <PageHead overline="Pipeline" title="Demo Sessions"
        desc="Intent-driven, never script-driven. The consultant plans a demo, but questions, objections, and curiosity interrupt the plan — and it returns to context afterward."
        actions={<button className="btn btn-primary"><Icon name="plus" size={14} /> Plan a session</button>} />
      {live && (
        <div className="card" style={{ marginBottom: 22, overflow: 'hidden' }}>
          <div className="card-hd" style={{ background: 'var(--color-navy)', borderColor: 'transparent' }}>
            <div className="flex items-center gap-3"><span style={{ width: 9, height: 9, borderRadius: 99, background: 'var(--color-red)', boxShadow: '0 0 0 4px rgba(197,70,68,.3)' }} /><h3 style={{ color: '#fff' }}>Live now — {live.customer}</h3></div>
            <a className="btn btn-on-dark btn-sm" href="#"><Icon name="external" size={13} /> Control room</a>
          </div>
          <div className="grid cols-4" style={{ padding: 18, gap: 14 }}>
            <div><div className="overline">Scenario</div><div style={{ fontWeight: 800, marginTop: 4 }}>{live.scenario}</div></div>
            <div><div className="overline">Running</div><div style={{ fontWeight: 800, marginTop: 4 }} className="tnum">{live.dur}</div></div>
            <div><div className="overline">Confidence</div><div style={{ fontWeight: 800, marginTop: 4 }} className="tnum">{live.conf == null ? '—' : `${Math.round(live.conf * 100)}%`}</div></div>
            <div><div className="overline">Mode</div><div style={{ marginTop: 6 }}><ModeChip mode={live.mode} /></div></div>
          </div>
          <div style={{ padding: '0 18px 18px' }}>
            <div className="overline" style={{ marginBottom: 8 }}>Demo plan — business objective: prove approval coverage stays audit-clean when approvers are out</div>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              {['Understand intent', 'Retrieve (cited)', 'Navigate to feature', 'Demonstrate', 'Explain value', 'Handle follow-up', 'Return to context'].map((s, i) => (
                <span key={s} className="tag" style={i < 3 ? { background: 'var(--color-green)', color: '#fff', borderColor: 'transparent' } : i === 3 ? { background: 'var(--color-blue)', color: '#fff', borderColor: 'transparent' } : {}}>{s}</span>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-hd"><h3>Session history</h3><span className="muted" style={{ fontSize: 12 }}>{sessions.length} sessions</span></div>
        <table className="tbl">
          <thead><tr><th>Department</th><th>Scenario</th><th>When</th><th>Duration</th><th>Mode</th><th>Conf.</th><th>Cost</th><th>Status</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td><div className="cell-strong">{s.customer}</div><div className="cell-sub mono">{s.product} · {s.stakeholders} stakeholders</div></td>
                <td>{s.scenario}</td><td className="muted">{s.when}</td><td className="tnum">{s.dur}</td><td><ModeChip mode={s.mode} /></td><td className="tnum">{s.conf == null ? '—' : `${Math.round(s.conf * 100)}%`}</td><td className="tnum">${s.cost.toFixed(2)}</td>
                <td>{s.status === 'Live' ? <Pill kind="danger" dot>Live</Pill> : s.status === 'Recovered' ? <Pill kind="warn">Recovered</Pill> : <Pill kind="success">Done</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================ SAFETY & MODES ============================ */
const MODES = [
  { id: 'read-only', name: 'Read-only', icon: 'eye', kind: 'readonly', def: true, desc: 'Navigate, highlight, explain. No mutations of any kind.', allow: ['Navigate UI', 'Highlight elements', 'Read & explain data'], deny: ['Any form submit', 'Create / edit / delete', 'State changes'] },
  { id: 'safe', name: 'Safe', icon: 'check', kind: 'safe', desc: 'Whitelisted non-destructive actions only (e.g. open a filter).', allow: ['Everything in Read-only', 'Whitelisted reversible UI', 'Apply view filters'], deny: ['Mutating writes', 'Anything off the whitelist'] },
  { id: 'approval', name: 'Approval', icon: 'lockOpen', kind: 'approval', desc: 'Mutating actions allowed but each requires explicit human confirm.', allow: ['Everything in Safe', 'Mutating action w/ confirm'], deny: ['Unconfirmed mutations', 'Bulk / irreversible w/o review'] },
  { id: 'execution', name: 'Execution', icon: 'lock', kind: 'execution', desc: 'Full write. Only when a customer explicitly authorizes it in their env.', allow: ['Full mutating workflows'], deny: ['— enabled per signed authorization —'] },
];
export function Safety({ go }: { go: Go }) {
  const VD = useData();
  return (
    <div className="page scroll">
      <PageHead overline="Operations" title="Safety & Execution Modes"
        desc="A first-class, default-deny control sitting beside governance. The mode and the specific action must both be permitted before the consultant ever acts. A hard kill switch is always available."
        actions={<button className="btn btn-secondary"><Icon name="settings" size={13} /> Edit policy</button>} />
      <div className="banner banner-warn" style={{ marginBottom: 18 }}><Icon name="lock" size={18} style={{ color: 'var(--color-amber)' }} /><div><strong>Default mode is Read-only.</strong> The system never fires a real workflow — e.g. submitting a request — in a demo unless both the mode and the action are explicitly permitted. Mutating actions are blocked by default.</div></div>
      <div className="grid cols-4">
        {MODES.map((m, i) => (
          <div key={m.id} className="card" style={{ borderColor: m.def ? 'var(--color-green)' : 'var(--border-subtle)', borderWidth: m.def ? 2 : 1 }}>
            <div className="card-pad">
              <div className="flex between items-center" style={{ marginBottom: 10 }}>
                <span className={`mode-chip mode-${m.kind}`}><Icon name={m.icon} size={11} /> {m.name}</span>
                {m.def ? <Pill kind="success" dot>Default</Pill> : <span className="muted" style={{ fontSize: 11 }}>Tier {i + 1}</span>}
              </div>
              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '0 0 12px', minHeight: 54 }}>{m.desc}</p>
              <div className="overline" style={{ marginBottom: 5, color: 'var(--color-green)' }}>Permitted</div>
              {m.allow.map((a) => <div key={a} style={{ fontSize: 12, display: 'flex', gap: 7, marginBottom: 4 }}><Icon name="check" size={13} style={{ color: 'var(--color-green)', flexShrink: 0, marginTop: 1 }} />{a}</div>)}
              <div className="overline" style={{ margin: '10px 0 5px', color: 'var(--color-red)' }}>Blocked</div>
              {m.deny.map((a) => <div key={a} style={{ fontSize: 12, display: 'flex', gap: 7, marginBottom: 4, color: 'var(--color-steel)' }}><Icon name="x" size={13} style={{ color: 'var(--color-red)', flexShrink: 0, marginTop: 1 }} />{a}</div>)}
            </div>
          </div>
        ))}
      </div>
      <div className="grid cols-2 section-gap">
        <div className="card card-pad">
          <div className="overline" style={{ marginBottom: 10 }}>Action classifier</div>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>Every candidate action is tagged before execution. The mode gate then decides.</p>
          {([['read', 'Read / navigate', 'success'], ['non-destructive', 'Reversible UI', 'info'], ['mutating', 'Writes state', 'danger']] as [string, string, string][]).map(([t, l, k]) => (
            <div key={t} className="flex between items-center" style={{ padding: '9px 0', borderBottom: '1px solid var(--border-subtle)' }}><span style={{ fontSize: 13 }}>{l}</span><Pill kind={k}>{t}</Pill></div>
          ))}
        </div>
        <div className="card card-pad">
          <div className="overline" style={{ marginBottom: 10 }}>Per-department default mode</div>
          <table className="tbl" style={{ fontSize: 12.5 }}><tbody>
            {VD.customers.map((c) => (<tr key={c.id} style={{ cursor: 'default' }}><td style={{ paddingLeft: 0 }} className="cell-strong">{c.name}</td><td style={{ textAlign: 'right', paddingRight: 0 }}><ModeChip mode={c.id === 'c3' ? 'safe' : 'read-only'} /></td></tr>))}
          </tbody></table>
          <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0, display: 'flex', gap: 7 }}><Icon name="info" size={14} style={{ flexShrink: 0, marginTop: 1 }} /> Execution mode is never the default — it&apos;s granted per signed authorization in the customer&apos;s own environment.</p>
        </div>
      </div>
    </div>
  );
}

/* ============================ EVALS ============================ */
export function Evals({ go }: { go: Go }) {
  const VD = useData();
  const { evals } = VD;
  return (
    <div className="page scroll">
      <PageHead overline="Operations" title="Eval Harness"
        desc="Repeatable scoring of the core loop: intent recognition, navigation success, hallucination rate, recovery, and context retention. MVP is done when the approval-delegation scenario passes reliably here."
        actions={<><button className="btn btn-secondary"><Icon name="file" size={13} /> View suite</button><button className="btn btn-primary"><Icon name="play" size={13} /> Run evals</button></>} />
      <div className="grid cols-3" style={{ marginBottom: 8 }}>
        {evals.map((e: any) => {
          const pct = e.fmt === 'pct' ? `${(e.score * 100).toFixed(1)}%` : `${Math.round(e.score * 100)}%`;
          const targetPct = e.fmt === 'pct' ? `${(e.target * 100).toFixed(1)}%` : `${Math.round(e.target * 100)}%`;
          const pass = e.invert ? e.score <= e.target : e.score >= e.target;
          return (
            <div key={e.id} className="card card-pad">
              <div className="flex between items-center"><div className="metric__label">{e.name}</div>{pass ? <Pill kind="success" dot>Passing</Pill> : <Pill kind="warn" dot>Below target</Pill>}</div>
              <div className="flex items-baseline gap-2" style={{ marginTop: 8 }}><div style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-primary)' }} className="tnum">{pct}</div><span className="muted" style={{ fontSize: 12 }}>target {targetPct}</span></div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--app-track)', overflow: 'hidden', margin: '12px 0 8px' }}><i style={{ display: 'block', height: '100%', width: `${(e.invert ? 1 - e.score : e.score) * 100}%`, background: pass ? 'var(--color-green)' : 'var(--color-amber)' }} /></div>
              <div className="flex between" style={{ fontSize: 11.5 }}><span className="muted">{e.runs} runs</span><span className={`metric__delta ${e.trend}`}><Icon name={e.trend === 'down' ? 'down' : e.trend === 'up' ? 'up' : 'arrow'} size={12} /> {e.trend === 'flat' ? 'stable' : 'trending'}</span></div>
            </div>
          );
        })}
      </div>
      <div className="card section-gap" style={{ overflow: 'hidden' }}>
        <div className="card-hd"><h3>Recent eval runs</h3><span className="tag">{VD.evalRuns.length} run{VD.evalRuns.length === 1 ? '' : 's'} recorded</span></div>
        {VD.evalRuns.length ? (
          <table className="tbl">
            <thead><tr><th>Run</th><th>Suite</th><th>Passed</th><th>When</th><th>Result</th></tr></thead>
            <tbody>
              {VD.evalRuns.map((r) => (
                <tr key={r.id} style={{ cursor: 'default' }}>
                  <td className="mono cell-strong">{r.id.slice(0, 8)}</td>
                  <td>{r.suite}</td>
                  <td className="tnum">{r.passed}/{r.total}</td>
                  <td className="muted">{r.when}</td>
                  <td>{r.passed === r.total ? <Pill kind="success" dot>Pass</Pill> : <Pill kind="warn" dot>Review</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No eval runs recorded yet — run <span className="mono">npm run eval:phase1</span> (each run records here).</div>}
      </div>
    </div>
  );
}

/* ============================ COSTS ============================ */
export function Costs({ go }: { go: Go }) {
  const VD = useData();
  const { costBreakdown, sessions } = VD;
  const total = costBreakdown.reduce((a, c) => a + c.v, 0);
  const demos = VD.products.reduce((a, p) => a + p.demos, 0) || sessions.length;
  const perDemo = demos ? total / demos : 0;
  const depts = VD.customers.length;
  return (
    <div className="page scroll">
      <PageHead overline="Operations" title="Cost & Unit Economics"
        desc="Cost is telemetry, not an afterthought. Every demo emits cost events tagged to the session, so per-demo and per-department unit cost is queryable from day one. The pricing decision is a parallel business track."
        actions={<button className="btn btn-secondary"><Icon name="file" size={13} /> Export</button>} />
      <div className="grid cols-4" style={{ marginBottom: 22 }}>
        <Metric label="Total spend" value={`$${total.toFixed(2)}`} delta={`${demos} demos`} dir="flat" />
        <Metric label="Avg cost / demo" value={demos ? `$${perDemo.toFixed(2)}` : '—'} delta="all demos" dir="flat" />
        <Metric label="Cost / dept" value={depts ? `$${(total / depts).toFixed(2)}` : '—'} delta="blended" dir="flat" />
        <Metric label="Demos run" value={String(demos)} delta="all-time" dir="flat" />
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
        <div className="card card-pad">
          <div className="overline" style={{ marginBottom: 14 }}>Spend by event type</div>
          <div className="flex items-baseline gap-2" style={{ marginBottom: 14 }}><div style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)' }} className="tnum">${total.toFixed(2)}</div><span className="muted">total · tagged to sessions</span></div>
          {costBreakdown.map((c) => (
            <div key={c.k} style={{ marginBottom: 12 }}>
              <div className="flex between" style={{ fontSize: 12.5, marginBottom: 5 }}><span className="flex items-center gap-2"><i style={{ width: 10, height: 10, borderRadius: 3, background: c.color }} />{c.k}</span><span style={{ fontWeight: 700 }} className="tnum">${c.v.toFixed(2)} · {c.pct}%</span></div>
              <div style={{ height: 7, borderRadius: 99, background: 'var(--app-track)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${c.pct}%`, background: c.color }} /></div>
            </div>
          ))}
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd"><h3>Cost by session</h3><span className="muted" style={{ fontSize: 12 }}>tagged events</span></div>
          <table className="tbl">
            <thead><tr><th>Department</th><th>Scenario</th><th>Duration</th><th>LLM</th><th>Total</th></tr></thead>
            <tbody>
              {sessions.map((s) => (<tr key={s.id} style={{ cursor: 'default' }}><td className="cell-strong">{s.customer}</td><td>{s.scenario}</td><td className="tnum muted">{s.dur}</td><td className="tnum muted">${s.llm.toFixed(2)}</td><td className="tnum cell-strong">${s.cost.toFixed(2)}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="banner banner-info section-gap"><Icon name="info" size={18} style={{ color: 'var(--color-blue)' }} /><div>Budgets and alerts come later. Today this is pure instrumentation — the unit-economics decision (price, margin, what a demo is worth) runs on the parallel founder track.</div></div>
    </div>
  );
}

/* ============================ SETTINGS ============================ */
export function Settings({ go }: { go: Go }) {
  const deferred = [
    ['Multi-agent split', 'Tool needs independent scaling / owner, or loop exceeds budget'],
    ['Desktop / Citrix / vision automation', 'Signed customer requiring a non-web target'],
    ['Self-service onboarding', 'Adapter contract stable across 3 manual products'],
    ['pgvector → Pinecone', 'Retrieval scale / latency exceeds pgvector'],
    ['Product Lifecycle engine', 'Onboarding product #3 / first version bump'],
    ['Active discovery behavior', 'Phase 1 loop reliable; fields already captured'],
    ['Competitive content', 'Sales / customer asks; category already in schema'],
    ['Billing / metering', 'Pricing validated + first paying customer'],
    ['execution (full-write) mode', 'Customer authorizes mutating actions in their env'],
  ];
  return (
    <div className="page scroll">
      <PageHead overline="Workspace" title="Settings" desc="Architectural posture, interface seams, and the deferral register — the zero-untracked-gaps guarantee." />
      <div className="grid cols-2" style={{ marginBottom: 22 }}>
        <div className="card card-pad">
          <div className="overline" style={{ marginBottom: 12 }}>Interface seams — built narrow, designed broad</div>
          <dl className="kv" style={{ gridTemplateColumns: '1fr auto', rowGap: 12 }}>
            <dt>LLM provider</dt><dd><Pill kind="info">Cloud only built</Pill></dd>
            <dt>Interaction layer</dt><dd><Pill kind="info">Playwright / web only</Pill></dd>
            <dt>Vector retrieval</dt><dd><Pill kind="info">pgvector (default)</Pill></dd>
            <dt>Orchestration</dt><dd><Pill kind="navy">Single LangGraph loop</Pill></dd>
            <dt>State vs. memory</dt><dd><Pill kind="neutral">Session state + memory</Pill></dd>
          </dl>
        </div>
        <div className="card card-pad">
          <div className="overline" style={{ marginBottom: 12 }}>Defaults</div>
          <dl className="kv" style={{ gridTemplateColumns: '1fr auto', rowGap: 12 }}>
            <dt>Default execution mode</dt><dd><ModeChip mode="read-only" /></dd>
            <dt>Environment routing</dt><dd><Pill kind="success" dot>Demo only</Pill></dd>
            <dt>Confidence threshold</dt><dd className="tnum">0.70</dd>
            <dt>Hallucination policy</dt><dd>Cite or decline</dd>
            <dt>Cost events</dt><dd><Pill kind="success" dot>On</Pill></dd>
          </dl>
        </div>
      </div>
      <div className="card">
        <div className="card-hd"><h3>Deferral register</h3><span className="tag">build only when trigger fires</span></div>
        <table className="tbl"><thead><tr><th>Deferred item</th><th>Trigger to revisit</th></tr></thead>
          <tbody>{deferred.map((d, i) => (<tr key={i} style={{ cursor: 'default' }}><td className="cell-strong">{d[0]}</td><td className="muted">{d[1]}</td></tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
