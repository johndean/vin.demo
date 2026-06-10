'use client';
/* VIN Demo console — Pipeline + Operations views (ported from web/views-ops.jsx). */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from './data-context';
import { PageHead, Icon, Pill, ModeChip, Avatar, Metric, Unavailable, type Go } from './shell';
import { FormShell, Field } from './Modal';
import { adminMutate, runEval } from './admin';
import { ArchiveFilter } from './views-build';

/* Real client-side CSV export — builds a file from already-loaded real rows and downloads it. */
function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}
function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

const CUSTOMER_STAGES = ['Qualifying', 'Demo scheduled', 'Live demo', 'Follow-up', 'Evaluation', 'Closed'];
/* Create / edit a department (account). Pipeline fields live in metadata jsonb — editable here (were heuristic fallbacks). */
function CustomerForm({ customer, onClose }: { customer: any | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(customer?.name ?? '');
  const [seg, setSeg] = useState(customer?.seg ?? '');
  const [stage, setStage] = useState(customer?.stage ?? 'Qualifying');
  const [next, setNext] = useState(customer?.next ?? '');
  const [color, setColor] = useState(customer?.color ?? '#4D6995');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const data = { name: name.trim(), metadata: { seg, stage, next, color } };
      if (customer?.id) await adminMutate('customer', 'update', { id: customer.id, data });
      else await adminMutate('customer', 'create', { data });
      onClose(); router.refresh();
    } catch (e: any) { setErr(e?.message || 'Save failed'); setBusy(false); }
  };
  return (
    <FormShell title={customer ? `Edit ${customer.name}` : 'New department'} onClose={onClose} grid
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <Field label="Department / account name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Procurement · Acme Corp" /></Field>
      <Field label="Segment"><input value={seg} onChange={(e) => setSeg(e.target.value)} placeholder="Enterprise · Manufacturing" /></Field>
      <Field label="Stage"><select value={stage} onChange={(e) => setStage(e.target.value)}>{CUSTOMER_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
      <Field label="Color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ padding: 3, height: 38, width: '100%' }} /></Field>
      <Field full label="Next step"><input value={next} onChange={(e) => setNext(e.target.value)} placeholder="Exec readout · Tue" /></Field>
      {err && <div className="modal__err fld--full">{err}</div>}
    </FormShell>
  );
}

function ArchiveCustomer({ customer, onClose }: { customer: any; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { await adminMutate('customer', 'archive', { id: customer.id }); onClose(); router.refresh(); }
    catch (e: any) { setErr(e?.message || 'Archive failed'); setBusy(false); }
  };
  return (
    <FormShell title="Archive department" width={420} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'Archiving…' : 'Archive'}</button></>}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-primary)' }}>Archive <b>{customer.name}</b>? Its demo sessions and stakeholder history are kept and it can be restored from the Archived filter.</p>
      {err && <div className="modal__err">{err}</div>}
    </FormShell>
  );
}

/* ============================ CUSTOMERS ============================ */
export function Customers({ go, selected }: { go: Go; selected?: string | null }) {
  const VD = useData();
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(selected || null);
  const [editing, setEditing] = useState<any | null | undefined>(undefined); // undefined=closed, null=new, obj=edit
  const [archiving, setArchiving] = useState<any | null>(null);
  const [view, setView] = useState<'active' | 'archived' | 'all'>('active');
  useEffect(() => { setSel(selected || null); }, [selected]);
  const { customers } = VD;
  if (sel) { const c = customers.find((x) => x.id === sel); if (c) return <CustomerDetail c={c} go={go} back={() => setSel(null)} />; }
  const counts = { active: customers.filter((c) => !c.archived).length, archived: customers.filter((c) => c.archived).length, all: customers.length };
  const shown = customers.filter((c) => view === 'all' ? true : view === 'archived' ? c.archived : !c.archived);
  const unarchive = async (id: string) => { await adminMutate('customer', 'unarchive', { id }); router.refresh(); };
  const open = editing !== undefined || archiving;
  return (
    <div className="page scroll">
      <PageHead overline="Pipeline" title="Departments"
        desc="Departments evaluating the products. Each carries demo sessions and a stakeholder graph — a collection of roles, interests, and open items tracked per person."
        actions={!open ? <button className="btn btn-primary" onClick={() => setEditing(null)}><Icon name="plus" size={14} /> Add department</button> : undefined} />
      {editing !== undefined ? <CustomerForm customer={editing} onClose={() => setEditing(undefined)} />
        : archiving ? <ArchiveCustomer customer={archiving} onClose={() => setArchiving(null)} />
        : <>
        <ArchiveFilter value={view} onChange={setView} counts={counts} />
        <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>Department</th><th>Stage</th><th>Product</th><th>Stakeholders</th><th>Sessions</th><th>Next</th><th></th></tr></thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} onClick={() => setSel(c.id)} style={{ cursor: 'pointer', opacity: c.archived ? .6 : 1 }}>
                <td><div className="flex items-center gap-3"><Avatar initials={c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')} color={c.color} size={30} /><div><div className="cell-strong">{c.name}</div><div className="cell-sub">{c.seg}</div></div></div></td>
                <td>{c.archived ? <Pill kind="steel" dot>Archived</Pill> : c.hot ? <Pill kind="danger" dot>Live demo</Pill> : c.stage === 'Demo scheduled' ? <Pill kind="info">{c.stage}</Pill> : c.stage === 'Follow-up' ? <Pill kind="warn">{c.stage}</Pill> : <Pill kind="neutral">{c.stage}</Pill>}</td>
                <td><span className="mono" style={{ fontSize: 12 }}>{c.product}</span></td>
                <td className="tnum">{c.stakeholders}</td>
                <td className="tnum">{c.sessions}</td>
                <td><span className="muted" style={{ fontSize: 12.5 }}>{c.next}</span></td>
                <td onClick={(e) => e.stopPropagation()}>
                  {c.archived
                    ? <button className="btn btn-ghost btn-sm" onClick={() => unarchive(c.id)}><Icon name="refresh" size={13} /></button>
                    : <div className="flex gap-1"><button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}><Icon name="edit" size={13} /></button><button className="btn btn-ghost btn-sm" onClick={() => setArchiving(c)}><Icon name="archive" size={13} /></button></div>}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={7}><div className="empty">No {view === 'archived' ? 'archived' : view === 'active' ? 'active' : ''} departments.</div></td></tr>}
          </tbody>
        </table>
      </div></>}
    </div>
  );
}

function CustomerDetail({ c, go, back }: { c: any; go: Go; back: () => void }) {
  const VD = useData();
  const { sessions } = VD;
  // Stakeholders scoped to THIS department (was the workspace-wide list for every dept).
  const stakeholders = VD.stakeholders.filter((s) => s.customerId === c.id);
  const custSessions = sessions.filter((s) => s.customer === c.name);
  return (
    <div className="page scroll">
      <PageHead crumbs={[{ label: 'Departments', to: 'customers' }, { label: c.name }]} go={(r) => { if (r === 'customers') back(); else go(r); }}
        overline={c.seg} title={<span className="flex items-center gap-3"><Avatar initials={c.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')} color={c.color} size={32} />{c.name}</span>}
        actions={<><Unavailable label="Add stakeholder" icon="plus" why="Stakeholders are captured from real demo sessions (engine-side); manual add from the console is deferred." />{c.hot ? <span className="btn btn-secondary" style={{ cursor: 'default' }} title="The live Control Room runs in the VIN Desktop app"><Icon name="external" size={13} /> Control Room · desktop</span> : <Unavailable label="Plan session" icon="sessions" primary why="Sessions are created when a demo runs in the Control Room (desktop). Planning from the console is deferred." />}</>} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 6 }}>
        <div className="overline">Stakeholder graph · {stakeholders.length} {stakeholders.length === 1 ? 'person' : 'people'}</div>
      </div>
      <div className="grid cols-3" style={{ marginBottom: 24 }}>
        {!stakeholders.length && <div className="empty">No stakeholders recorded for this department yet.</div>}
        {stakeholders.map((s) => (
          <div key={s.id} className="card card-pad" style={{ borderColor: s.active ? 'var(--color-blue)' : 'var(--border-subtle)' }}>
            <div className="flex items-center gap-3" style={{ marginBottom: 10 }}>
              <Avatar initials={s.initials} color={s.color} size={36} />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{s.name}</div><div className="muted" style={{ fontSize: 12 }}>{s.role}</div></div>
              {s.active && <Pill kind="info" dot>Active</Pill>}
            </div>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '0 0 10px' }}>{s.interest}</p>
            {(s.decisionAuthority || s.influence || s.riskLevel) && (
              <div className="flex gap-1" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
                {s.decisionAuthority && <Pill kind={s.decisionAuthority === 'decision_maker' ? 'navy' : 'info'}>{s.decisionAuthority.replace(/_/g, ' ')}</Pill>}
                {s.influence && <Pill kind="steel">{s.influence} influence</Pill>}
                {s.riskLevel && <Pill kind={s.riskLevel === 'high' ? 'warn' : 'neutral'}>{s.riskLevel} risk</Pill>}
              </div>
            )}
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
          <table className="tbl"><thead><tr><th>Scenario</th><th>Product</th><th>When</th><th>Mode</th><th>Cost</th></tr></thead>
            <tbody>{custSessions.map((s) => (<tr key={s.id} onClick={() => go('sessions')}><td className="cell-strong">{s.scenario}</td><td className="mono" style={{ fontSize: 12 }}>{s.product}</td><td className="muted">{s.when}</td><td><ModeChip mode={s.mode} /></td><td className="tnum">${s.cost.toFixed(2)}</td></tr>))}</tbody>
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
  const [planning, setPlanning] = useState(false);
  if (planning) return <div className="page scroll"><PlanSessionForm onClose={() => setPlanning(false)} /></div>;
  return (
    <div className="page scroll">
      <PageHead overline="Pipeline" title="Demo Sessions"
        desc="Intent-driven, never script-driven. The consultant plans a demo, but questions, objections, and curiosity interrupt the plan — and it returns to context afterward."
        actions={<button className="btn btn-primary" onClick={() => setPlanning(true)}><Icon name="plus" size={14} /> Plan a session</button>} />
      {live && (
        <div className="card" style={{ marginBottom: 22, overflow: 'hidden' }}>
          <div className="card-hd" style={{ background: 'var(--color-navy)', borderColor: 'transparent' }}>
            <div className="flex items-center gap-3"><span style={{ width: 9, height: 9, borderRadius: 99, background: 'var(--color-red)', boxShadow: '0 0 0 4px rgba(197,70,68,.3)' }} /><h3 style={{ color: '#fff' }}>Live now — {live.customer}</h3></div>
            <span className="btn btn-on-dark btn-sm" style={{ background: 'rgba(255,255,255,.14)', cursor: 'default' }} title="The live Control Room runs in the VIN Desktop app"><Icon name="external" size={13} /> Control Room · desktop</span>
          </div>
          <div className="grid cols-3" style={{ padding: 18, gap: 14 }}>
            <div><div className="overline">Scenario</div><div style={{ fontWeight: 800, marginTop: 4 }}>{live.scenario}</div></div>
            <div><div className="overline">Running</div><div style={{ fontWeight: 800, marginTop: 4 }} className="tnum">{live.dur}</div></div>
            <div><div className="overline">Mode</div><div style={{ marginTop: 6 }}><ModeChip mode={live.mode} /></div></div>
          </div>
          <div style={{ padding: '0 18px 18px' }}>
            <div className="overline" style={{ marginBottom: 8 }}>The consultant&apos;s loop</div>
            {/* Descriptive — the fixed loop stages, not live per-step progress (which isn't tracked here). */}
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              {['Understand intent', 'Retrieve (cited)', 'Navigate to feature', 'Demonstrate', 'Explain value', 'Handle follow-up', 'Return to context'].map((s) => (
                <span key={s} className="tag">{s}</span>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-hd"><h3>Session history</h3><span className="muted" style={{ fontSize: 12 }}>{sessions.length} sessions</span></div>
        <table className="tbl">
          <thead><tr><th>Department</th><th>Scenario</th><th>When</th><th>Duration</th><th>Mode</th><th>Cost</th><th>Status</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td><div className="cell-strong">{s.customer}</div><div className="cell-sub mono">{s.product} · {s.stakeholders} stakeholders</div></td>
                <td>{s.scenario}</td><td className="muted">{s.when}</td><td className="tnum">{s.dur}</td><td><ModeChip mode={s.mode} /></td><td className="tnum">${s.cost.toFixed(2)}</td>
                <td>{s.status === 'Live' ? <Pill kind="danger" dot>Live</Pill> : s.status === 'Recovered' ? <Pill kind="warn">Recovered</Pill> : s.status === 'Planned' ? <Pill kind="neutral" dot>Planned</Pill> : <Pill kind="success">Done</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SESSION_MODES = ['read-only', 'safe', 'approval', 'execution'];
/* Plan (pre-stage) a demo session — a real demo_sessions insert (status='planned'), optionally with a
   captured business objective. The product picker resolves the active product_version + environment client
   side; the Control Room later flips the planned session live. Honest: a planned session has run nothing. */
function PlanSessionForm({ onClose }: { onClose: () => void }) {
  const VD = useData();
  const router = useRouter();
  const customers = VD.customers.filter((c) => !c.archived);
  const products = VD.products.filter((p) => !p.archived);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [personaId, setPersonaId] = useState('');
  const [mode, setMode] = useState('read-only');
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const product = products.find((p) => p.id === productId);

  const save = async () => {
    if (!customerId) { setErr('Pick a department / account.'); return; }
    if (!productId) { setErr('Pick a product.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await adminMutate('demo_session', 'create', { data: {
        customer_id: customerId,
        product_version_id: product?.activeVersionId ?? null,
        environment_id: product?.envId ?? null,
        persona_id: personaId || null,
        execution_mode: mode,
        status: 'planned',
      } });
      if (objective.trim() && r?.id) await adminMutate('session_discovery', 'create', { data: { demo_session_id: r.id, business_objective: objective.trim() } });
      router.refresh(); onClose();
    } catch (e: any) { setErr(e?.message || 'Could not plan the session'); setBusy(false); }
  };

  return (
    <FormShell title="Plan a session" subtitle="Pre-stage a demo: pick the audience, product, persona, and safety mode. It lands as a Planned session the Control Room can pick up and run." onClose={onClose} grid
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Planning…' : 'Plan session'}</button></>}>
      <Field label="Department / account"><select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{customers.length ? customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>) : <option value="">No departments yet</option>}</select></Field>
      <Field label="Product"><select value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Persona (optional)"><select value={personaId} onChange={(e) => setPersonaId(e.target.value)}><option value="">— auto / lead persona —</option>{VD.personas.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Execution mode"><select value={mode} onChange={(e) => setMode(e.target.value)}>{SESSION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
      <Field label="Business objective (optional)" full><input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="e.g. Show the CFO approval-delegation without IT involvement" /></Field>
      <div className="fld--full muted" style={{ fontSize: 12 }}>{product && (product.activeVersionId ? `→ links to ${product.version} · ${product.env}` : '⚠ this product has no active version yet — the planned session won’t link to a version')}</div>
      {err && <div className="fld--full" style={{ color: 'var(--color-red)', fontSize: 12 }}>{err}</div>}
    </FormShell>
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
        desc="A first-class, default-deny control sitting beside governance. The mode and the specific action must both be permitted before the consultant ever acts. A hard kill switch is always available." />
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
          <div className="overline" style={{ marginBottom: 10 }}>Per-site default mode</div>
          <table className="tbl" style={{ fontSize: 12.5 }}><tbody>
            {VD.products.map((p) => (<tr key={p.id} style={{ cursor: 'default' }}><td style={{ paddingLeft: 0 }} className="cell-strong">{p.domain}</td><td style={{ textAlign: 'right', paddingRight: 0 }}><ModeChip mode={p.defaultMode} /></td></tr>))}
          </tbody></table>
          <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0, display: 'flex', gap: 7 }}><Icon name="info" size={14} style={{ flexShrink: 0, marginTop: 1 }} /> Each site&apos;s default mode is set on its Environment; the operator can still override it per session in the Control Room. Execution mode is never the default — it&apos;s granted per signed authorization in the customer&apos;s own environment.</p>
        </div>
      </div>
    </div>
  );
}

/* ============================ EVALS ============================ */
// Console-triggered eval run — RBAC-proxied to the engine, which SPAWNS the real eval npm script (it ships
// the repo + tsx) and records a real eval_runs row. Suite list mirrors the engine's server-side allowlist.
const EVAL_SUITE_OPTIONS = ['coverage', 'phase1', 'phase6', 'phase7', 'phase9', 'phase10', 'phase11', 'phase12', 'phase13', 'phase14', 'phase15', 'phase16', 'phase17', 'phase18', 'phase19', 'phase20', 'phase21', 'phase22'];
function RunEvals() {
  const router = useRouter();
  const [suite, setSuite] = useState('coverage');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await runEval(suite);
      setMsg(r?.passed != null ? `${suite}: ${r.passed}/${r.total} passed${r.ok ? '' : ' · non-zero exit'}.` : `${suite}: finished (exit ${r?.code}).`);
      router.refresh();
    } catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
      <select value={suite} onChange={(e) => setSuite(e.target.value)} disabled={busy} style={{ maxWidth: 150 }}>{EVAL_SUITE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      <button className="btn btn-primary" onClick={run} disabled={busy}><Icon name="play" size={13} /> {busy ? 'Running… (minutes)' : 'Run evals'}</button>
      {msg && <span className="muted" style={{ fontSize: 12, maxWidth: 320 }}>{msg}</span>}
    </div>
  );
}
export function Evals({ go }: { go: Go }) {
  const VD = useData();
  const { evals } = VD;
  return (
    <div className="page scroll">
      <PageHead overline="Operations" title="Eval Harness"
        desc="Repeatable scoring of the core loop: intent recognition, navigation success, hallucination rate, recovery, and context retention. MVP is done when the approval-delegation scenario passes reliably here."
        actions={<RunEvals />} />
      <div className="grid cols-3" style={{ marginBottom: 8 }}>
        {evals.map((e: any) => {
          const pct = `${Math.round(e.score * 100)}%`;
          const pass = e.total > 0 && e.passed === e.total;
          return (
            <div key={e.id} className="card card-pad">
              <div className="flex between items-center"><div className="metric__label">{e.name}</div>{pass ? <Pill kind="success" dot>All passing</Pill> : <Pill kind="warn" dot>{e.total - e.passed} failing</Pill>}</div>
              <div className="flex items-baseline gap-2" style={{ marginTop: 8 }}><div style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-primary)' }} className="tnum">{pct}</div><span className="muted" style={{ fontSize: 12 }}>{e.passed}/{e.total} checks</span></div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--app-track)', overflow: 'hidden', margin: '12px 0 8px' }}><i style={{ display: 'block', height: '100%', width: `${e.score * 100}%`, background: pass ? 'var(--color-green)' : 'var(--color-amber)' }} /></div>
              <div className="flex between" style={{ fontSize: 11.5 }}><span className="muted">{e.runs} run{e.runs === 1 ? '' : 's'} recorded</span></div>
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
/* Real per-dimension cost breakdown (department / product / persona) — every dollar attributed through the
   session join (cost_events → demo_sessions → customer/product/persona). Replaces the blended metric. */
function CostSlices({ title, rows }: { title: string; rows: { k: string; v: number; pct: number }[] }) {
  return (
    <div className="card card-pad">
      <div className="overline" style={{ marginBottom: 14 }}>{title}</div>
      {rows.length ? rows.slice(0, 6).map((c) => (
        <div key={c.k} style={{ marginBottom: 12 }}>
          <div className="flex between" style={{ fontSize: 12.5, marginBottom: 5 }}><span>{c.k}</span><span style={{ fontWeight: 700 }} className="tnum">${c.v.toFixed(2)} · {c.pct}%</span></div>
          <div style={{ height: 7, borderRadius: 99, background: 'var(--app-track)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${c.pct}%`, background: 'var(--color-blue)' }} /></div>
        </div>
      )) : <div className="muted" style={{ fontSize: 12 }}>No cost events yet.</div>}
    </div>
  );
}
export function Costs({ go }: { go: Go }) {
  const VD = useData();
  const { costBreakdown, sessions } = VD;
  const total = costBreakdown.reduce((a, c) => a + c.v, 0);
  const demos = VD.products.reduce((a, p) => a + p.demos, 0) || sessions.length;
  const perDemo = demos ? total / demos : 0;
  const exportCsv = () => downloadCsv('vin-cost-by-session.csv', toCsv(
    ['Department', 'Scenario', 'Product', 'When', 'Duration', 'Mode', 'LLM cost (USD)', 'Total cost (USD)'],
    sessions.map((s) => [s.customer, s.scenario, s.product, s.when, s.dur, s.mode, s.llm.toFixed(4), s.cost.toFixed(4)]),
  ));
  return (
    <div className="page scroll">
      <PageHead overline="Operations" title="Cost & Unit Economics"
        desc="Cost is telemetry, not an afterthought. Every demo emits cost events tagged to the session, so per-demo and per-department unit cost is queryable from day one. The pricing decision is a parallel business track."
        actions={<button className="btn btn-secondary" onClick={exportCsv} disabled={!sessions.length} title={sessions.length ? 'Download cost-by-session as CSV' : 'No sessions to export'}><Icon name="file" size={13} /> Export CSV</button>} />
      <div className="grid cols-4" style={{ marginBottom: 22 }}>
        <Metric label="Total spend" value={`$${total.toFixed(2)}`} delta={`${demos} demos`} dir="flat" />
        <Metric label="Avg cost / demo" value={demos ? `$${perDemo.toFixed(2)}` : '—'} delta="all demos" dir="flat" />
        <Metric label="Cost this month" value={`$${VD.mtdSpend.toFixed(2)}`} delta="MTD · real events" dir="flat" />
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
      <div className="grid cols-3" style={{ marginTop: 22 }}>
        <CostSlices title="Cost by department" rows={VD.costByDept} />
        <CostSlices title="Cost by product" rows={VD.costByProduct} />
        <CostSlices title="Cost by persona" rows={VD.costByPersona} />
      </div>
      <div className="banner banner-info section-gap"><Icon name="info" size={18} style={{ color: 'var(--color-blue)' }} /><div>Budgets and alerts come later. Today this is pure instrumentation — the unit-economics decision (price, margin, what a demo is worth) runs on the parallel founder track.</div></div>
    </div>
  );
}

/* ============================ GOVERNANCE ============================ */
export function Governance({ go }: { go: Go }) {
  const VD = useData();
  const g = VD.governance;
  const fp = g.freshness.total ? Math.round((g.freshness.fresh / g.freshness.total) * 100) : 0;
  const Tbl = ({ title, head, rows, empty }: { title: string; head: string[]; rows: React.ReactNode[]; empty: string }) => (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-hd"><h3>{title}</h3></div>
      {rows.length ? (
        <table className="tbl"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows}</tbody></table>
      ) : <div className="empty">{empty}</div>}
    </div>
  );
  return (
    <div className="page scroll">
      <PageHead overline="Operations" title="Governance"
        desc="Four ordered control layers — Identity · Knowledge · Behavior · Execution — must all pass before any response or action. Every turn is recorded from real sessions; nothing here is hidden or fabricated." />
      <div className="banner banner-info" style={{ marginBottom: 18 }}><Icon name="safety" size={18} style={{ color: 'var(--color-blue)' }} />
        <div><strong>The compliance engine degrades, never fakes.</strong> A guardrail hit blocks or escalates the answer (and is logged) rather than emitting something ungoverned. Counts below are live from the audit trail + event logs — empty until sessions run.</div></div>
      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <Metric label="Audit turns recorded" value={String(g.totals.auditTurns)} delta="reconstructable" dir="flat" />
        <Metric label="Hand-offs" value={String(g.totals.handoffs)} delta="specialist routing" dir="flat" />
        <Metric label="Escalations" value={String(g.totals.escalations)} delta="guardrail / scope" dir={g.totals.escalations ? 'up' : 'flat'} />
        <Metric label="Guardrail violations" value={String(g.totals.violations)} delta="blocked / degraded" dir={g.totals.violations ? 'down' : 'flat'} />
      </div>
      <div className="grid cols-4" style={{ marginBottom: 22 }}>
        <Metric label="Low-confidence answers" value={String(g.totals.lowConfidence)} delta="degraded gracefully" dir="flat" />
        <Metric label="Execution blocks" value={String(g.totals.executionBlocks)} delta="mode / permission" dir="flat" />
        <Metric label="Knowledge fresh" value={`${fp}%`} delta={`${g.freshness.fresh}/${g.freshness.total} chunks ≤180d`} dir={fp >= 80 ? 'up' : 'down'} />
        <Metric label="Personas in use" value={String(g.totals.personasInUse)} delta="this trail" dir="flat" />
      </div>
      <div className="grid cols-2">
        <Tbl title="Escalations" head={['Source', 'Destination', 'Trigger', 'When']} empty="No escalations recorded yet." rows={g.escalations.map((e, i) => (
          <tr key={i} style={{ cursor: 'default' }}><td className="cell-strong">{e.source}</td><td>{e.dest}</td><td><Pill kind="warn">{e.trigger}</Pill></td><td className="muted">{e.when}</td></tr>
        ))} />
        <Tbl title="Guardrail violations" head={['Persona', 'Action', 'Rules', 'When']} empty="No guardrail violations recorded." rows={g.violations.map((v, i) => (
          <tr key={i} style={{ cursor: 'default' }}><td className="cell-strong">{v.persona}</td><td><Pill kind={v.action === 'block' ? 'danger' : 'warn'}>{v.action}</Pill></td><td className="muted" style={{ fontSize: 12 }}>{v.rules}</td><td className="muted">{v.when}</td></tr>
        ))} />
      </div>
      <div className="grid cols-2 section-gap">
        <Tbl title="Low-confidence answers" head={['Persona', 'Band', 'Question', 'When']} empty="No low-confidence answers recorded." rows={g.lowConfidence.map((r, i) => (
          <tr key={i} style={{ cursor: 'default' }}><td className="cell-strong">{r.persona}</td><td><Pill kind={r.band === 'very_low' ? 'danger' : 'warn'}>{r.band}</Pill></td><td className="muted" style={{ fontSize: 12 }}>{r.utterance.slice(0, 60)}</td><td className="muted">{r.when}</td></tr>
        ))} />
        <Tbl title="Recent hand-offs" head={['From', 'To', 'Trigger', 'When']} empty="No hand-offs recorded yet." rows={g.handoffs.map((h, i) => (
          <tr key={i} style={{ cursor: 'default' }}><td>{h.from}</td><td className="cell-strong">{h.to}</td><td><Pill kind="info">{h.trigger}</Pill></td><td className="muted">{h.when}</td></tr>
        ))} />
      </div>
      <div className="card section-gap" style={{ overflow: 'hidden' }}>
        <div className="card-hd"><h3>Persona usage</h3><span className="muted" style={{ fontSize: 12 }}>turns in the audit trail</span></div>
        {g.usage.length ? (
          <div className="card-pad">{g.usage.map((u) => {
            const max = g.usage[0]?.turns || 1;
            return (
              <div key={u.persona} style={{ marginBottom: 10 }}>
                <div className="flex between" style={{ fontSize: 12.5, marginBottom: 4 }}><span className="cell-strong">{u.persona}</span><span className="tnum muted">{u.turns} turn{u.turns === 1 ? '' : 's'}</span></div>
                <div style={{ height: 7, borderRadius: 99, background: 'var(--app-track)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${Math.round((u.turns / max) * 100)}%`, background: 'var(--color-navy)' }} /></div>
              </div>
            );
          })}</div>
        ) : <div className="empty">No persona turns recorded yet — run a live session.</div>}
      </div>
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
