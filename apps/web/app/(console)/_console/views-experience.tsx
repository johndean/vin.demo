'use client';
/* VIN Demo console — EXPERIENCE views (V5 Guided Experience Platform, Phase 1): the Business Outcome Registry
   + the buying-committee Stakeholder Registry + the influence graph. Read + CRUD over REAL tables (0020) via
   the RBAC-proxied /experience endpoint. Truth discipline: NOTHING is fabricated — a product with no authored
   outcomes/committee shows an honest empty state, never placeholder metrics. This is the top of the authority
   chain (Stakeholder → Business Outcome → … → Workflow); Journeys land here in Phase 2. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from './data-context';
import { PageHead, Pill, Icon, type Go } from './shell';
import { FormShell, Field } from './Modal';
import { experienceMutate } from './admin';
import type { ProductRow, OutcomeRow, CommitteeMemberRow, JourneyRow, GapRecordRow } from './data';

const toList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const fromList = (a: string[] | undefined) => (a ?? []).join(', ');
const STATUS_KIND: Record<string, string> = { active: 'success', draft: 'neutral', deprecated: 'warn', archived: 'danger' };
const AUTHORITY = ['', 'decision_maker', 'approver', 'champion', 'influencer', 'evaluator'];
const LEVEL = ['', 'low', 'medium', 'high'];
const RELATIONS = ['influences', 'reports_to', 'defers_to', 'blocks'];

export function Experience({ go }: { go?: Go }) {
  const data = useData();
  const products = (data.products ?? []).filter((p) => !p.archived);
  const [pid, setPid] = useState(products[0]?.id ?? '');
  const [tab, setTab] = useState<'outcomes' | 'committee'>('outcomes');
  const [subF, setSubF] = useState('all');   // outcomes: status · committee: influence
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const [outcomeForm, setOutcomeForm] = useState<{ mode: 'add' | 'edit'; row?: OutcomeRow; prod: ProductRow } | null>(null);
  const [stakeForm, setStakeForm] = useState<{ mode: 'add' | 'edit'; row?: CommitteeMemberRow; prod: ProductRow } | null>(null);
  const [relForm, setRelForm] = useState<{ prod: ProductRow } | null>(null);
  const closeForms = () => { setOutcomeForm(null); setStakeForm(null); setRelForm(null); };
  const switchTab = (t: 'outcomes' | 'committee') => { setTab(t); setSubF('all'); setSel(''); };

  if (!products.length) {
    return (
      <div className="page scroll">
        <PageHead overline="Experience" title="Outcomes & Buying Committee" desc="The business outcomes a demo must advance, and the people in the room who decide." go={go} />
        <div className="banner banner-info">No products yet — onboard a product first, then define its outcomes and buying committee here.</div>
      </div>
    );
  }
  const allMode = pid === 'all';
  const product = products.find((p) => p.id === pid); // undefined in all-products view
  const needle = q.trim().toLowerCase();

  // Rows carry their product so Edit / Archive operate correctly even in the cross-product "All" view.
  const outcomeRows = (allMode ? products.flatMap((p) => (p.outcomes ?? []).map((o) => ({ o, prod: p })))
    : (product?.outcomes ?? []).map((o) => ({ o, prod: product! })));
  const committeeRows = (allMode ? products.flatMap((p) => (p.committee ?? []).map((m) => ({ m, prod: p })))
    : (product?.committee ?? []).map((m) => ({ m, prod: product! })));

  const oFiltered = outcomeRows.filter(({ o }) => (subF === 'all' || o.status === subF)
    && (!needle || `${o.title} ${o.description} ${o.metric} ${o.stakeholderType}`.toLowerCase().includes(needle)));
  const cFiltered = committeeRows.filter(({ m }) => (subF === 'all' || m.influence === subF)
    && (!needle || `${m.name} ${m.role} ${fromList(m.decisionCriteria)} ${fromList(m.objections)} ${fromList(m.goals)}`.toLowerCase().includes(needle)));

  const oSel = oFiltered.find((r) => r.o.id === sel) ?? (tab === 'outcomes' ? oFiltered[0] : undefined);
  const cSel = cFiltered.find((r) => r.m.id === sel) ?? (tab === 'committee' ? cFiltered[0] : undefined);
  const formOpen = outcomeForm || stakeForm || relForm;

  const addCtx = () => { if (!product) return; tab === 'outcomes' ? setOutcomeForm({ mode: 'add', prod: product }) : setStakeForm({ mode: 'add', prod: product }); };

  return (
    <div className="page scroll">
      <PageHead overline="Experience" title="Outcomes & Buying Committee"
        desc="The business outcomes a demo must advance, and the people in the room who decide — the top of the Stakeholder → Outcome → Journey chain."
        go={go}
        actions={<button className="btn btn-primary btn-sm" disabled={allMode} title={allMode ? 'Pick a product first' : ''} onClick={addCtx}><Icon name="plus" size={13} /> Add {tab === 'outcomes' ? 'outcome' : 'person'}</button>} />

      {/* Add / Edit / relationship forms open FULL-WIDTH (Knowledge idiom), replacing the list+inspector. */}
      {outcomeForm ? <OutcomeForm product={outcomeForm.prod} mode={outcomeForm.mode} row={outcomeForm.row} onClose={closeForms} />
        : stakeForm ? <StakeholderForm product={stakeForm.prod} mode={stakeForm.mode} row={stakeForm.row} onClose={closeForms} />
        : relForm ? <RelationshipForm product={relForm.prod} committee={relForm.prod.committee ?? []} onClose={closeForms} />
        : null}

      {!formOpen && (
        <>
          {/* ── Filter row (Knowledge idiom): product · entity toggle · sub-filter pills · search · count ── */}
          <div className="flex between items-center" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
            <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={pid} onChange={(e) => { setPid(e.target.value); setSel(''); }} aria-label="Filter by product"
                style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line, #d4dae3)', fontWeight: 600, background: 'var(--surface, #fff)', color: 'var(--text-primary, #1a2b45)' }}>
                <option value="all">All products</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line,#e2e7ee)', margin: '0 2px' }} />
              {([['outcomes', 'Outcomes', outcomeRows.length], ['committee', 'Committee', committeeRows.length]] as [('outcomes' | 'committee'), string, number][]).map(([id, lbl, n]) => (
                <button key={id} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchTab(id)}>{lbl} <span style={{ opacity: .7 }}>{n}</span></button>
              ))}
              <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line,#e2e7ee)', margin: '0 2px' }} />
              {(tab === 'outcomes'
                ? [['all', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['deprecated', 'Deprecated']]
                : [['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]
              ).map(([id, lbl]) => {
                const n = id === 'all' ? (tab === 'outcomes' ? outcomeRows.length : committeeRows.length)
                  : (tab === 'outcomes' ? outcomeRows.filter((r) => r.o.status === id).length : committeeRows.filter((r) => r.m.influence === id).length);
                return <button key={id} className={`btn btn-sm ${subF === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setSubF(id); setSel(''); }}>{lbl} <span style={{ opacity: .7 }}>{n}</span></button>;
              })}
              <input value={q} onChange={(e) => { setQ(e.target.value); setSel(''); }} placeholder={tab === 'outcomes' ? 'Search outcomes…' : 'Search committee…'}
                style={{ padding: '6px 10px', border: '1px solid var(--line, #d4dae3)', borderRadius: 6, fontSize: 12.5, flex: '0 1 220px' }} />
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{tab === 'outcomes' ? `${oFiltered.length} of ${outcomeRows.length} outcomes` : `${cFiltered.length} of ${committeeRows.length} committee`}{allMode ? ' · all products' : product ? ` · ${product.name}` : ''}</span>
          </div>

          {/* ── Two-pane: registry list (left) · inspector (right) ── */}
          <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
            <div className="card" style={{ overflow: 'hidden' }}>
              {tab === 'outcomes' ? (
                <table className="tbl">
                  <thead><tr><th>Outcome</th>{allMode && <th>Product</th>}<th>Status</th><th>Metric → Target</th><th>For role</th></tr></thead>
                  <tbody>
                    {oFiltered.map(({ o, prod }) => (
                      <tr key={o.id} onClick={() => setSel(o.id)} style={oSel?.o.id === o.id ? { background: 'var(--app-active)' } : {}}>
                        <td><div className="cell-strong">{o.title}</div>{o.description ? <div className="cell-sub">{o.description}</div> : null}</td>
                        {allMode && <td><Pill kind="neutral">{prod.name}</Pill></td>}
                        <td><Pill kind={STATUS_KIND[o.status] ?? 'neutral'}>{o.status}</Pill></td>
                        <td className="cell-sub">{[o.metric, (o.baseline ? `${o.baseline} → ` : '') + (o.target || '')].filter((s) => s && s.trim()).join(' · ') || '—'}</td>
                        <td className="cell-sub">{o.stakeholderType || '—'}</td>
                      </tr>
                    ))}
                    {oFiltered.length === 0 && <tr><td colSpan={allMode ? 5 : 4} className="muted" style={{ padding: 20, textAlign: 'center' }}>No outcomes in this view.</td></tr>}
                  </tbody>
                </table>
              ) : (
                <table className="tbl">
                  <thead><tr><th>Person</th>{allMode && <th>Product</th>}<th>Role</th><th>Influence</th><th>Authority</th></tr></thead>
                  <tbody>
                    {cFiltered.map(({ m, prod }) => (
                      <tr key={m.id} onClick={() => setSel(m.id)} style={cSel?.m.id === m.id ? { background: 'var(--app-active)' } : {}}>
                        <td><div className="cell-strong">{m.name}</div>{fromList(m.decisionCriteria) ? <div className="cell-sub">evaluates: {fromList(m.decisionCriteria)}</div> : null}</td>
                        {allMode && <td><Pill kind="neutral">{prod.name}</Pill></td>}
                        <td className="cell-sub">{m.role || '—'}</td>
                        <td>{m.influence ? <Pill kind={m.influence === 'high' ? 'success' : m.influence === 'medium' ? 'info' : 'neutral'}>{m.influence}</Pill> : <span className="muted">—</span>}</td>
                        <td className="cell-sub">{m.decisionAuthority ? m.decisionAuthority.replace('_', ' ') : '—'}</td>
                      </tr>
                    ))}
                    {cFiltered.length === 0 && <tr><td colSpan={allMode ? 5 : 4} className="muted" style={{ padding: 20, textAlign: 'center' }}>No committee members in this view.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
            {tab === 'outcomes'
              ? (oSel && <OutcomeInspector o={oSel.o} prod={oSel.prod} onEdit={() => setOutcomeForm({ mode: 'edit', row: oSel.o, prod: oSel.prod })} />)
              : (cSel && <CommitteeInspector m={cSel.m} prod={cSel.prod} onEdit={() => setStakeForm({ mode: 'edit', row: cSel.m, prod: cSel.prod })} onAddEdge={() => setRelForm({ prod: cSel.prod })} />)}
          </div>
        </>
      )}
    </div>
  );
}

/** Outcome inspector (right pane) — full trust-metadata-style detail + edit/archive. */
function OutcomeInspector({ o, prod, onEdit }: { o: OutcomeRow; prod: ProductRow; onEdit: () => void }) {
  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div className="card-hd"><div><div className="overline">Business outcome</div><h3 style={{ marginTop: 4, fontSize: 14, lineHeight: 1.3 }}>{o.title} <Pill kind={STATUS_KIND[o.status] ?? 'neutral'}>{o.status}</Pill></h3></div></div>
      <div className="card-pad">
        {o.description ? <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 16px' }}>{o.description}</p> : null}
        <div className="trust">
          <div className="trust__row"><span className="trust__k">Product</span><span className="trust__v" style={{ fontWeight: 700 }}>{prod.name}</span></div>
          <div className="trust__row"><span className="trust__k">Metric</span><span className="trust__v">{o.metric || '—'}</span></div>
          <div className="trust__row"><span className="trust__k">Baseline → Target</span><span className="trust__v">{[o.baseline, o.target].filter(Boolean).join(' → ') || '—'}</span></div>
          <div className="trust__row"><span className="trust__k">Matters most to</span><span className="trust__v">{o.stakeholderType || '—'}</span></div>
          <div className="trust__row"><span className="trust__k">Owner</span><span className="trust__v">{o.owner || '—'}</span></div>
          <div className="trust__row"><span className="trust__k">Version</span><span className="trust__v">v{o.version}</span></div>
        </div>
        <div className="flex gap-2" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary btn-sm" onClick={onEdit}><Icon name="edit" size={14} /> Edit</button>
          <ArchiveBtn label="Archive outcome" onConfirm={() => experienceMutate('outcome.archive', { outcomeId: o.id })} />
        </div>
      </div>
    </div>
  );
}

/** Committee-member inspector (right pane) — profile + the influence edges they're part of + edit/archive/add-edge. */
function CommitteeInspector({ m, prod, onEdit, onAddEdge }: { m: CommitteeMemberRow; prod: ProductRow; onEdit: () => void; onAddEdge: () => void }) {
  const committee = prod.committee ?? [];
  const rels = (prod.stakeholderRelationships ?? []).filter((r) => r.from === m.id || r.to === m.id);
  const nameOf = (id: string) => committee.find((x) => x.id === id)?.name ?? '(archived)';
  const list = (label: string, v: string) => v ? <div className="trust__row"><span className="trust__k">{label}</span><span className="trust__v">{v}</span></div> : null;
  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div className="card-hd"><div><div className="overline">Committee member</div><h3 style={{ marginTop: 4, fontSize: 14, lineHeight: 1.3 }}>{m.name} {m.influence ? <Pill kind={m.influence === 'high' ? 'success' : m.influence === 'medium' ? 'info' : 'neutral'}>{m.influence}</Pill> : null}</h3></div></div>
      <div className="card-pad">
        <div className="trust">
          <div className="trust__row"><span className="trust__k">Product</span><span className="trust__v" style={{ fontWeight: 700 }}>{prod.name}</span></div>
          {list('Role', m.role)}
          {list('Decision authority', m.decisionAuthority ? m.decisionAuthority.replace('_', ' ') : '')}
          {list('Risk level', m.riskLevel)}
          {list('Interests', fromList(m.interests))}
          {list('Evaluates on', fromList(m.decisionCriteria))}
          {list('Goals', fromList(m.goals))}
          {list('Objections', fromList(m.objections))}
          {list('Open questions', fromList(m.questions))}
        </div>
        <hr className="divider" style={{ margin: '16px 0' }} />
        <div className="flex between items-center" style={{ marginBottom: 8 }}>
          <div className="overline">Influence edges <span className="muted">· {rels.length}</span></div>
          {committee.length >= 2 ? <button className="btn btn-secondary btn-sm" onClick={onAddEdge}><Icon name="plus" size={12} /> Edge</button> : null}
        </div>
        {rels.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No relationships modeled for this person.</div>
          : <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              {rels.map((r) => (
                <span key={r.id} className="pill pill-neutral" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                  {nameOf(r.from)} <b>{(r.relation || 'influences').replace('_', ' ')}</b> {nameOf(r.to)}{r.weight ? ` · ${r.weight}` : ''}
                  <button className="btn btn-secondary btn-sm" title="Remove" onClick={() => experienceMutate('relationship.archive', { relationshipId: r.id }).then(() => location.reload())}>×</button>
                </span>
              ))}
            </div>}
        <div className="flex gap-2" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary btn-sm" onClick={onEdit}><Icon name="edit" size={14} /> Edit</button>
          <ArchiveBtn label="Archive person" onConfirm={() => experienceMutate('stakeholder.archive', { stakeholderId: m.id })} />
        </div>
      </div>
    </div>
  );
}

/** A confirm-then-archive button (soft-archive; never hard-delete). */
function ArchiveBtn({ label, onConfirm }: { label: string; onConfirm: () => Promise<unknown> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={async () => {
      if (!confirm(`${label}? It is soft-archived (kept for history, removed from the active registry).`)) return;
      setBusy(true);
      try { await onConfirm(); router.refresh(); } catch (e: any) { alert(String(e?.message ?? e)); setBusy(false); }
    }}>{busy ? '…' : 'Archive'}</button>
  );
}

function OutcomeForm({ product, mode, row, onClose }: { product: ProductRow; mode: 'add' | 'edit'; row?: OutcomeRow; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: row?.title ?? '', description: row?.description ?? '', metric: row?.metric ?? '',
    baseline: row?.baseline ?? '', target: row?.target ?? '', stakeholderType: row?.stakeholderType ?? '',
    status: row?.status ?? 'active',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!f.title.trim()) { setErr('Title is required.'); return; }
    setBusy(true); setErr('');
    try {
      const data = { title: f.title.trim(), description: f.description, metric: f.metric, baseline: f.baseline, target: f.target, stakeholderType: f.stakeholderType, status: f.status };
      if (mode === 'add') await experienceMutate('outcome.create', { productId: product.id, data });
      else await experienceMutate('outcome.update', { outcomeId: row!.id, data });
      onClose(); router.refresh();
    } catch (e: any) { setErr(String(e?.message ?? e)); setBusy(false); }
  };
  return (
    <FormShell title={mode === 'add' ? 'Add business outcome' : `Edit · ${row?.title}`} subtitle="What this demo must demonstrably advance. Metric/target are operator-stated (auto-measurement comes later)." onClose={onClose} grid
      footer={<><button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save outcome'}</button></>}>
      <Field full label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Reduce approval delays" /></Field>
      <Field full label="Description"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Approvals stall when leadership travels" /></Field>
      <Field label="Metric"><input value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} placeholder="avg approval hours" /></Field>
      <Field label="Matters most to (role)"><input value={f.stakeholderType} onChange={(e) => setF({ ...f, stakeholderType: e.target.value })} placeholder="CFO" /></Field>
      <Field label="Baseline"><input value={f.baseline} onChange={(e) => setF({ ...f, baseline: e.target.value })} placeholder="72h" /></Field>
      <Field label="Target"><input value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="< 24h" /></Field>
      <Field label="Status"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['active', 'draft', 'deprecated'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
      {err && <div className="banner banner-warn" style={{ gridColumn: '1 / -1' }}>{err}</div>}
    </FormShell>
  );
}

function StakeholderForm({ product, mode, row, onClose }: { product: ProductRow; mode: 'add' | 'edit'; row?: CommitteeMemberRow; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: row?.name ?? '', role: row?.role ?? '', influence: row?.influence ?? '', riskLevel: row?.riskLevel ?? '',
    decisionAuthority: row?.decisionAuthority ?? '',
    interests: fromList(row?.interests), decisionCriteria: fromList(row?.decisionCriteria),
    goals: fromList(row?.goals), objections: fromList(row?.objections), questions: fromList(row?.questions),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!f.name.trim()) { setErr('Name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const data = {
        name: f.name.trim(), role: f.role, influence: f.influence || null, riskLevel: f.riskLevel || null,
        decisionAuthority: f.decisionAuthority || null, interests: toList(f.interests), decisionCriteria: toList(f.decisionCriteria),
        goals: toList(f.goals), objections: toList(f.objections), questions: toList(f.questions),
      };
      if (mode === 'add') await experienceMutate('stakeholder.create', { productId: product.id, data });
      else await experienceMutate('stakeholder.update', { stakeholderId: row!.id, data });
      onClose(); router.refresh();
    } catch (e: any) { setErr(String(e?.message ?? e)); setBusy(false); }
  };
  return (
    <FormShell title={mode === 'add' ? 'Add committee member' : `Edit · ${row?.name}`} subtitle="A human in the buying committee (NOT an AI Specialist). Lists are comma-separated." onClose={onClose} grid
      footer={<><button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save person'}</button></>}>
      <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Morgan" /></Field>
      <Field label="Role"><input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="CFO" /></Field>
      <Field label="Influence"><select value={f.influence} onChange={(e) => setF({ ...f, influence: e.target.value })}>{LEVEL.map((s) => <option key={s} value={s}>{s || '—'}</option>)}</select></Field>
      <Field label="Risk level"><select value={f.riskLevel} onChange={(e) => setF({ ...f, riskLevel: e.target.value })}>{LEVEL.map((s) => <option key={s} value={s}>{s || '—'}</option>)}</select></Field>
      <Field label="Decision authority"><select value={f.decisionAuthority} onChange={(e) => setF({ ...f, decisionAuthority: e.target.value })}>{AUTHORITY.map((s) => <option key={s} value={s}>{s || '—'}</option>)}</select></Field>
      <Field label="Interests"><input value={f.interests} onChange={(e) => setF({ ...f, interests: e.target.value })} placeholder="spend control, compliance" /></Field>
      <Field full label="Decision criteria (what they evaluate on)"><input value={f.decisionCriteria} onChange={(e) => setF({ ...f, decisionCriteria: e.target.value })} placeholder="ROI, security, ease of rollout" /></Field>
      <Field full label="Goals"><input value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} placeholder="cut cycle time, improve audit readiness" /></Field>
      <Field full label="Objections"><input value={f.objections} onChange={(e) => setF({ ...f, objections: e.target.value })} placeholder="too costly, change management" /></Field>
      <Field full label="Open questions"><input value={f.questions} onChange={(e) => setF({ ...f, questions: e.target.value })} placeholder="how does delegation work?" /></Field>
      {err && <div className="banner banner-warn" style={{ gridColumn: '1 / -1' }}>{err}</div>}
    </FormShell>
  );
}

function RelationshipForm({ product, committee, onClose }: { product: ProductRow; committee: CommitteeMemberRow[]; onClose: () => void }) {
  const router = useRouter();
  const [fromId, setFromId] = useState(committee[0]?.id ?? '');
  const [toId, setToId] = useState(committee[1]?.id ?? '');
  const [relation, setRelation] = useState('influences');
  const [weight, setWeight] = useState('medium');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (fromId === toId) { setErr('Pick two different people.'); return; }
    setBusy(true); setErr('');
    try {
      await experienceMutate('relationship.create', { productId: product.id, fromId, toId, relation, weight });
      onClose(); router.refresh();
    } catch (e: any) { setErr(String(e?.message ?? e)); setBusy(false); }
  };
  return (
    <FormShell title="Add relationship" subtitle="An influence-graph edge between two committee members." onClose={onClose} grid
      footer={<><button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add edge'}</button></>}>
      <Field label="From"><select value={fromId} onChange={(e) => setFromId(e.target.value)}>{committee.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <Field label="To"><select value={toId} onChange={(e) => setToId(e.target.value)}>{committee.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <Field label="Relation"><select value={relation} onChange={(e) => setRelation(e.target.value)}>{RELATIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></Field>
      <Field label="Weight"><select value={weight} onChange={(e) => setWeight(e.target.value)}>{['low', 'medium', 'high'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
      {err && <div className="banner banner-warn" style={{ gridColumn: '1 / -1' }}>{err}</div>}
    </FormShell>
  );
}

/* ── Journeys (V5 Phase 2 — the orchestration layer). Compose a product's REAL workflows / tours / knowledge
   into an ordered story toward a business outcome. References real assets only; a dangling ref is FLAGGED
   (never hidden). Run counts come from journey_runs telemetry (0 until a journey is walked — never faked). */
export function Journeys({ go }: { go?: Go }) {
  const data = useData();
  const products = (data.products ?? []).filter((p) => !p.archived);
  const [pid, setPid] = useState(products[0]?.id ?? '');
  const [statusF, setStatusF] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; row?: JourneyRow; prod: ProductRow } | null>(null);
  const [assemble, setAssemble] = useState(false);

  if (!products.length) {
    return (<div className="page scroll">
      <PageHead overline="Experience" title="Journeys" desc="Orchestrate existing workflows, tours, knowledge and specialists into a guided story toward a business outcome." go={go} />
      <div className="banner banner-info">No products yet — onboard a product first.</div>
    </div>);
  }
  const allMode = pid === 'all';
  const product = products.find((p) => p.id === pid); // undefined in all-products view
  // Rows carry their product so Edit / Archive / Gap work correctly even in the cross-product "All" view.
  const rows = (allMode ? products.flatMap((p) => (p.journeys ?? []).map((j) => ({ j, prod: p })))
    : (product?.journeys ?? []).map((j) => ({ j, prod: product! })));
  const needle = q.trim().toLowerCase();
  const filtered = rows.filter(({ j }) => (statusF === 'all' || j.status === statusF)
    && (!needle || `${j.name} ${j.businessGoal} ${j.outcomeTitle} ${j.stakeholderNames.join(' ')}`.toLowerCase().includes(needle)));
  const selected = filtered.find((r) => r.j.id === sel) ?? filtered[0];

  return (<div className="page scroll">
    <PageHead overline="Experience" title="Journeys"
      desc="The orchestration layer — string a product's REAL workflows / tours / knowledge into one guided narrative, tied to a business outcome and the committee it's for. References real assets; a missing one is flagged, never hidden."
      go={go}
      actions={<div className="flex gap-2 items-center">
        <button className="btn btn-secondary btn-sm" disabled={allMode} title={allMode ? 'Pick a product first' : ''} onClick={() => setAssemble(true)}>⚙ Assemble from assets</button>
        <button className="btn btn-primary btn-sm" disabled={allMode} title={allMode ? 'Pick a product first' : ''} onClick={() => product && setForm({ mode: 'add', prod: product })}><Icon name="plus" size={12} /> New journey</button>
      </div>} />

    {/* Add / Edit / Assemble open FULL-WIDTH (Knowledge idiom), replacing the list+inspector. */}
    {form ? <JourneyForm product={form.prod} mode={form.mode} row={form.row} onClose={() => setForm(null)} />
      : assemble && product ? <AssembleForm product={product} onClose={() => setAssemble(false)} />
      : <>
    {/* ── Filter row (Knowledge idiom): product · status pills · search · count ── */}
    <div className="flex between items-center" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={pid} onChange={(e) => { setPid(e.target.value); setSel(''); }} aria-label="Filter by product"
          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line, #d4dae3)', fontWeight: 600, background: 'var(--surface, #fff)', color: 'var(--text-primary, #1a2b45)' }}>
          <option value="all">All products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {([['all', 'All', rows.length], ['draft', 'Draft', rows.filter((r) => r.j.status === 'draft').length], ['active', 'Active', rows.filter((r) => r.j.status === 'active').length], ['deprecated', 'Deprecated', rows.filter((r) => r.j.status === 'deprecated').length]] as [string, string, number][]).map(([id, lbl, n]) => (
          <button key={id} className={`btn btn-sm ${statusF === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setStatusF(id); setSel(''); }}>{lbl} <span style={{ opacity: .7 }}>{n}</span></button>
        ))}
        <input value={q} onChange={(e) => { setQ(e.target.value); setSel(''); }} placeholder="Search journeys…"
          style={{ padding: '6px 10px', border: '1px solid var(--line, #d4dae3)', borderRadius: 6, fontSize: 12.5, flex: '0 1 220px' }} />
      </div>
      <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {rows.length} journeys{allMode ? ' · all products' : product ? ` · ${product.name}` : ''}</span>
    </div>

    {/* ── Two-pane: journey list (left) · journey inspector (right) ── */}
    <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>Journey</th>{allMode && <th>Product</th>}<th>Status</th><th>Integrity</th><th>Conf.</th><th>Runs</th></tr></thead>
          <tbody>
            {filtered.map(({ j, prod }) => (
              <tr key={j.id} onClick={() => setSel(j.id)} style={selected?.j.id === j.id ? { background: 'var(--app-active)' } : {}}>
                <td><div className="cell-strong">{j.name}</div>{j.outcomeTitle ? <div className="cell-sub">{j.outcomeTitle}</div> : null}</td>
                {allMode && <td><Pill kind="neutral">{prod.name}</Pill></td>}
                <td><Pill kind={STATUS_KIND[j.status] ?? 'neutral'}>{j.status}</Pill></td>
                <td>{j.missingCount > 0 ? <Pill kind="danger">{j.missingCount} broken</Pill> : (j.storyFlow.length > 0 ? <Pill kind="success" dot>refs ok</Pill> : <span className="muted">—</span>)}</td>
                <td>{j.confidence != null ? <Pill kind={j.confidence >= 75 ? 'success' : j.confidence >= 45 ? 'warn' : 'danger'}>{j.confidence}%</Pill> : <span className="muted">—</span>}</td>
                <td className="muted tnum">{j.runs}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={allMode ? 6 : 5} className="muted" style={{ padding: 20, textAlign: 'center' }}>No journeys in this view{rows.length === 0 ? ` — Assemble from assets or create one for ${product?.name ?? 'this product'}.` : '.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {selected && <JourneyCard j={selected.j} onEdit={() => setForm({ mode: 'edit', row: selected.j, prod: selected.prod })} />}
    </div>

    {!allMode && product && <GapPanel product={product} go={go} />}
      </>}
  </div>);
}

function JourneyCard({ j, onEdit }: { j: JourneyRow; onEdit: () => void }) {
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-hd flex between items-center">
        <div className="flex items-center gap-2">
          <span className="cell-strong">{j.name}</span>
          <Pill kind={STATUS_KIND[j.status] ?? 'neutral'}>{j.status}</Pill>
          <span className="muted tnum">v{j.version}</span>
          {j.missingCount > 0
            ? <Pill kind="danger">{j.missingCount} broken ref{j.missingCount > 1 ? 's' : ''}</Pill>
            : (j.storyFlow.length > 0 ? <Pill kind="success" dot>refs ok</Pill> : null)}
          {j.confidence != null ? <Pill kind={j.confidence >= 75 ? 'success' : j.confidence >= 45 ? 'warn' : 'danger'}>{j.confidence}% confidence</Pill> : null}
          <span className="muted">· {j.runs} run{j.runs === 1 ? '' : 's'}{j.runs ? ` (${j.runsDone} completed)` : ''}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
          <ArchiveBtn label="Archive journey" onConfirm={() => experienceMutate('journey.archive', { journeyId: j.id })} />
        </div>
      </div>
      <div className="card-pad">
        {j.businessGoal ? <div className="muted" style={{ marginBottom: 4 }}>Goal: {j.businessGoal}</div> : null}
        {j.outcomeTitle ? <div className="muted" style={{ marginBottom: 4 }}>Outcome: {j.outcomeTitle}</div> : null}
        <ol style={{ margin: '4px 0 0 18px', padding: 0 }}>
          {j.storyFlow.length === 0 ? <li className="muted">No steps yet.</li> : j.storyFlow.map((s, i) => (
            <li key={i} style={{ marginBottom: 2 }}>
              <b>{s.kind}</b> · {s.ok ? <span>{s.label}</span> : <span style={{ color: '#c0392b' }}>{s.label} — {s.reason}</span>}
              {s.caption && s.kind !== 'note' ? <span className="muted"> · “{s.caption}”</span> : null}
            </li>
          ))}
        </ol>
        {j.stakeholderNames.length ? <div className="muted" style={{ marginTop: 6 }}>Committee: {j.stakeholderNames.join(', ')}</div> : null}
        {j.specialistRules.length ? <div className="muted">Specialists: {j.specialistRules.map((r) => r.personaName).filter(Boolean).join(', ')}</div> : null}
        {j.successCriteria ? <div className="muted" style={{ marginTop: 6 }}>Success: {j.successCriteria}</div> : null}
      </div>
    </div>
  );
}

/* The Journey ASSEMBLER (consume-only): pick a business outcome + committee subset; the engine discovers this
   product's EXISTING validated assets, scores them, detects gaps, assembles a DRAFT journey, and scores
   confidence. It creates nothing but the journey + Gap Records. */
function AssembleForm({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const router = useRouter();
  const outcomes = (product.outcomes ?? []).filter((o) => o.status !== 'archived');
  const committee = product.committee ?? [];
  const [outcomeId, setOutcomeId] = useState(outcomes[0]?.id ?? '');
  const [ids, setIds] = useState<string[]>(committee.map((c) => c.id));
  const [organization, setOrganization] = useState('');
  const [industry, setIndustry] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<any>(null);
  const toggle = (id: string) => setIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const run = async () => {
    if (!outcomeId) { setErr('Pick a business outcome.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await experienceMutate('journey.assemble', { productId: product.id, outcomeId, committeeIds: ids, organization, industry });
      setResult(r); router.refresh();
    } catch (e: any) { setErr(String(e?.message ?? e)); } finally { setBusy(false); }
  };
  return (
    <FormShell title="Assemble a journey" grid
      subtitle="Consumes this product's EXISTING validated assets (workflows, tours, knowledge, specialists, environment) — it creates nothing. Missing dependencies become Gap Records."
      onClose={onClose}
      footer={<><button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button><button className="btn btn-primary btn-sm" disabled={busy || !outcomeId} onClick={run}>{busy ? 'Assembling…' : 'Assemble'}</button></>}>
      <Field full label="Business outcome (the target)">
        <select value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)}>
          {outcomes.length === 0 ? <option value="">(no outcomes — author one in Outcomes &amp; Committee)</option> : outcomes.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
      </Field>
      <Field label="Organization (optional)"><input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="prospect org / customer" /></Field>
      <Field label="Industry (optional)"><input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. veterinary" /></Field>
      <Field full label={`Buying committee (${ids.length}/${committee.length} targeted)`}>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
          {committee.length === 0 ? <span className="muted">No committee — assemble one in Outcomes &amp; Committee.</span>
            : committee.map((c) => (
              <label key={c.id} className="flex items-center gap-1" style={{ fontSize: 12.5, border: '1px solid var(--border-subtle,#d8dde6)', borderRadius: 6, padding: '3px 7px', cursor: 'pointer' }}>
                <input type="checkbox" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} /> {c.role || c.name}
              </label>))}
        </div>
      </Field>
      {result && <div className="banner banner-info" style={{ gridColumn: '1 / -1' }}>
        Assembled a draft journey — <b>{result.confidence}% confidence</b> · {result.storyFlowLen} steps · consumed {result.assets?.workflows ?? 0} workflows / {result.assets?.knowledge ?? 0} knowledge / {result.assets?.tours ?? 0} tours · <b>{result.gaps?.length ?? 0} gap record{(result.gaps?.length ?? 0) === 1 ? '' : 's'}</b>. See the draft + gaps below.
      </div>}
      {err && <div className="banner banner-warn" style={{ gridColumn: '1 / -1' }}>{err}</div>}
    </FormShell>
  );
}

/* Gap Records — the persisted "missing upstream dependency" backlog the Assembler produced. The Assembler never
   INVENTS the asset; the operator supplies it. But the resolution depends on whether the asset actually exists:
     • ATTACH — the asset EXISTS, it just wasn't picked up (e.g. specialists exist in the workspace but none
                scored to this committee; a workflow exists but isn't linked to the outcome). The right move is
                to attach EXISTING ones to THIS journey via an inline multi-select — specialists →
                specialist_rules (managed set: add/remove/change), workflow/tour/knowledge → story_flow (append).
                Pure consumption; nothing new is created. The gap stays open while you adjust — you Resolve it.
     • FIX    — the asset exists but needs work in its OWN system: env not certified / outcome has no metric.
                Deep-link with the honest verb ("Certify in…", "Fix in…").
     • CREATE — the asset genuinely doesn't exist yet (zero candidates). Deep-link "Create in…".
   Resolve / Dismiss stay on every gap (Dismiss = "not needed for this journey" — the right call when, e.g., a
   production-as-QA environment is intentional and its prod-target flag will never clear). */
const GAP_TARGET: Record<string, { route: string; label: string }> = {
  workflow: { route: 'graphs', label: 'Demo Graphs' }, tour: { route: 'graphs', label: 'Demo Graphs' }, screen: { route: 'graphs', label: 'Demo Graphs' },
  knowledge: { route: 'knowledge', label: 'Knowledge' }, persona: { route: 'personas', label: 'Personas' },
  environment: { route: 'environments', label: 'Environments' },
  committee: { route: 'experience', label: 'Outcomes & Committee' }, outcome: { route: 'experience', label: 'Outcomes & Committee' },
};
const ATTACHABLE = new Set(['persona', 'workflow', 'tour', 'knowledge']);
const KIND_NOUN: Record<string, string> = { persona: 'specialist', workflow: 'workflow', tour: 'tour', knowledge: 'knowledge item' };
// Verb for a NON-attach gap: the asset exists but needs fixing in its own system, or it's genuinely missing.
const fixVerb = (kind: string) => (kind === 'environment' ? 'Certify in' : kind === 'outcome' ? 'Fix in' : 'Create in');

function GapPanel({ product, go }: { product: ProductRow; go?: Go }) {
  const data = useData();
  const gaps = (product.gaps ?? []).filter((g) => g.status === 'open');
  if (!gaps.length) return null;
  const blocks = gaps.filter((g) => g.severity === 'blocks').length;
  const personas = (data.personas ?? []).filter((p) => !p.archived);
  const tours = (data.tours ?? []).filter((t) => t.productId === product.id);
  const knowledge = (data.knowledge ?? []).filter((k) => k.productId === product.id);
  const workflows = product.workflows ?? [];
  const journeys = product.journeys ?? [];
  const candidatesFor = (kind: string): { id: string; label: string }[] =>
    kind === 'persona' ? personas.map((p) => ({ id: p.id, label: p.name }))
      : kind === 'workflow' ? workflows.map((w) => ({ id: w.id, label: w.name }))
        : kind === 'tour' ? tours.map((t) => ({ id: t.id, label: t.name }))
          : kind === 'knowledge' ? knowledge.map((k) => ({ id: k.id, label: k.title })) : [];

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-hd flex between items-center">
        <div className="flex items-center gap-2"><span className="cell-strong">Gap Records</span>
          <Pill kind={blocks ? 'danger' : 'warn'}>{gaps.length} open{blocks ? ` · ${blocks} blocking` : ''}</Pill></div>
        <span className="muted" style={{ fontSize: 12 }}>What the Assembler needed but couldn't match — never invented. Attach an existing asset, or fix it in its own system, then resolve.</span>
      </div>
      <div className="card-pad" style={{ padding: '4px 10px' }}>
        {gaps.map((g) => (
          <GapRow key={g.id} g={g} go={go}
            journey={journeys.find((j) => j.id === g.journeyId) ?? null}
            candidates={ATTACHABLE.has(g.kind) ? candidatesFor(g.kind) : []} />
        ))}
      </div>
    </div>
  );
}

/* One gap row. When the asset EXISTS, show an inline MULTI-SELECT to manage it on the journey — and DON'T
   auto-resolve, so you can keep adjusting and resolve when YOU'RE satisfied:
     • persona → checkboxes pre-checked with the journey's current specialists; Save REPLACES the set (add /
       remove / change any number). Same model as the journey's own Edit form.
     • workflow / tour / knowledge → check any number to APPEND as story steps (reorder / remove on the journey
       editor, where ordered flow is edited).
   When the asset is missing, or exists but needs work in its own system, deep-link with the honest verb. */
function GapRow({ g, journey, candidates, go }: { g: GapRecordRow; journey: JourneyRow | null; candidates: { id: string; label: string }[]; go?: Go }) {
  const router = useRouter();
  const t = GAP_TARGET[g.kind];
  const noun = KIND_NOUN[g.kind] ?? g.kind;
  const isPersona = g.kind === 'persona';
  const canAttach = ATTACHABLE.has(g.kind) && candidates.length > 0 && !!journey;
  const attachedPersonaIds = journey ? journey.specialistRules.map((r) => r.personaId || '').filter(Boolean) : [];

  // persona → seed from the journey's current specialists (a managed set you add to / remove from);
  // story asset → start empty (a list of new steps to append).
  const [picked, setPicked] = useState<string[]>(isPersona ? attachedPersonaIds : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const labelOf = (id: string) => candidates.find((c) => c.id === id)?.label ?? '';
  const toggle = (id: string) => { setSaved(''); setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };

  const act = async (action: 'gap.resolve' | 'gap.dismiss') => {
    setBusy(true); setErr('');
    try { await experienceMutate(action, { gapId: g.id }); router.refresh(); }
    catch (e: any) { setErr(String(e?.message ?? e)); setBusy(false); }
  };

  const save = async () => {
    if (!journey) return;
    setBusy(true); setErr(''); setSaved('');
    try {
      // Send the FULL journey: updateJourney sets business_outcome_id / environment_id directly (not COALESCE),
      // so a partial patch would null them. Rebuild from the row, then change the one dimension.
      const base = {
        name: journey.name, businessGoal: journey.businessGoal,
        businessOutcomeId: journey.businessOutcomeId || null, environmentId: journey.environmentId || null,
        storyFlow: journey.storyFlow.map((s) => ({ kind: s.kind, refId: s.kind === 'note' ? null : (s.refId || null), caption: s.caption || null })),
        stakeholderRefs: journey.stakeholderRefs,
        specialistRules: journey.specialistRules.map((r) => ({ personaId: r.personaId, personaName: r.personaName, note: r.note ?? null })),
        successCriteria: journey.successCriteria, status: journey.status,
      };
      let data: any; let msg: string;
      if (isPersona) {
        data = { ...base, specialistRules: picked.map((id) => ({ personaId: id, personaName: labelOf(id), note: 'managed from gap' })) };
        msg = `Saved — ${picked.length} specialist${picked.length === 1 ? '' : 's'} on this journey.`;
      } else {
        const have = new Set(base.storyFlow.filter((s) => s.kind === g.kind && s.refId).map((s) => s.refId));
        const toAdd = picked.filter((id) => !have.has(id));
        data = { ...base, storyFlow: [...base.storyFlow, ...toAdd.map((id) => ({ kind: g.kind, refId: id, caption: labelOf(id).slice(0, 80) }))] };
        msg = `Added ${toAdd.length} ${noun}${toAdd.length === 1 ? '' : 's'} to the journey.`;
      }
      await experienceMutate('journey.update', { journeyId: journey.id, data });
      router.refresh();
      if (!isPersona) setPicked([]);
      setSaved(msg); setBusy(false);
    } catch (e: any) { setErr(String(e?.message ?? e)); setBusy(false); }
  };

  return (
    <div className="exp-row">
      <div className="exp-row__main">
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          <Pill kind={g.severity === 'blocks' ? 'danger' : 'warn'}>{g.severity}</Pill>
          <Pill kind="neutral">{g.kind}</Pill>
          <span className="cell-strong">{g.title}</span>
        </div>
        {g.detail ? <div className="cell-sub">{g.detail}</div> : null}
        {canAttach ? (
          <>
            <div className="cell-sub muted" style={{ marginTop: 4 }}>
              {isPersona
                ? 'Select any number of specialists for this journey, then Save (add / remove / change anytime here or on the journey’s Edit form).'
                : 'Check any number to add as steps; reorder or remove on the journey’s Edit form.'}
            </div>
            <div className="flex" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {candidates.map((c) => (
                <label key={c.id} className="flex items-center gap-1" style={{ fontSize: 12.5, border: '1px solid var(--border-subtle,#d8dde6)', borderRadius: 6, padding: '3px 7px', cursor: busy ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={picked.includes(c.id)} disabled={busy} onChange={() => toggle(c.id)} /> {c.label}
                </label>
              ))}
            </div>
            {saved ? <div className="cell-sub" style={{ color: '#0a7d61', marginTop: 4 }}>{saved} <span className="muted">Resolve the gap when you’re done.</span></div> : null}
          </>
        ) : null}
        {err ? <div className="cell-sub" style={{ color: '#c0392b' }}>{err}</div> : null}
      </div>
      <div className="exp-row__side" style={{ flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
        {canAttach
          ? <button className="btn btn-primary btn-sm" disabled={busy || (!isPersona && picked.length === 0)} onClick={save}>{busy ? 'Saving…' : isPersona ? `Save specialists (${picked.length})` : `Add to journey (${picked.length})`}</button>
          : (t ? <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => go?.(t.route)}>{fixVerb(g.kind)} {t.label} →</button> : null)}
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act('gap.resolve')}>Resolve</button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act('gap.dismiss')}>Dismiss</button>
      </div>
    </div>
  );
}

function JourneyForm({ product, mode, row, onClose }: { product: ProductRow; mode: 'add' | 'edit'; row?: JourneyRow; onClose: () => void }) {
  const data = useData();
  const router = useRouter();
  const tours = (data.tours ?? []).filter((t) => t.productId === product.id);
  const knowledge = (data.knowledge ?? []).filter((k) => k.productId === product.id);
  const personas = (data.personas ?? []).filter((p) => !p.archived);
  const workflows = product.workflows ?? [];
  const outcomes = product.outcomes ?? [];
  const committee = product.committee ?? [];

  const [name, setName] = useState(row?.name ?? '');
  const [goal, setGoal] = useState(row?.businessGoal ?? '');
  const [outcomeId, setOutcomeId] = useState(row?.businessOutcomeId ?? '');
  const [envId, setEnvId] = useState(row?.environmentId ?? '');
  const [success, setSuccess] = useState(row?.successCriteria ?? '');
  const [status, setStatus] = useState(row?.status ?? 'draft');
  const [steps, setSteps] = useState<{ kind: string; refId: string; caption: string }[]>(row ? row.storyFlow.map((s) => ({ kind: s.kind, refId: s.refId ?? '', caption: s.caption })) : []);
  const [stake, setStake] = useState<string[]>(row?.stakeholderRefs ?? []);
  const [specs, setSpecs] = useState<string[]>(row ? row.specialistRules.map((r) => r.personaId || '').filter(Boolean) : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const assetOptions = (kind: string) => kind === 'workflow' ? workflows.map((w) => ({ id: w.id, label: w.name }))
    : kind === 'tour' ? tours.map((t) => ({ id: t.id, label: t.name }))
    : kind === 'knowledge' ? knowledge.map((k) => ({ id: k.id, label: k.title })) : [];
  const addStep = () => setSteps([...steps, { kind: 'workflow', refId: '', caption: '' }]);
  const setStep = (i: number, patch: Partial<{ kind: string; refId: string; caption: string }>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => { const n = [...steps]; const t = i + d; if (t < 0 || t >= n.length) return; [n[i], n[t]] = [n[t], n[i]]; setSteps(n); };
  const removeStep = (i: number) => setSteps(steps.filter((_, j) => j !== i));
  const toggle = (list: string[], id: string, set: (v: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const storyFlow = steps.map((s) => ({ kind: s.kind, refId: s.kind === 'note' ? null : (s.refId || null), caption: s.caption || null }));
      const specialistRules = specs.map((id) => ({ personaId: id, personaName: personas.find((p) => p.id === id)?.name ?? '' }));
      const d = { name: name.trim(), businessGoal: goal, businessOutcomeId: outcomeId || null, environmentId: envId || null, storyFlow, stakeholderRefs: stake, specialistRules, successCriteria: success, status };
      if (mode === 'add') await experienceMutate('journey.create', { productId: product.id, data: d });
      else await experienceMutate('journey.update', { journeyId: row!.id, data: d });
      onClose(); router.refresh();
    } catch (e: any) { setErr(String(e?.message ?? e)); setBusy(false); }
  };

  return (
    <FormShell title={mode === 'add' ? 'New journey' : `Edit · ${row?.name}`} subtitle="Compose this product's REAL workflows / tours / knowledge into an ordered story toward an outcome. Notes are narration beats." onClose={onClose} grid width={760}
      footer={<><button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save journey'}</button></>}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="CFO approval-delegation story" /></Field>
      <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}>{['draft', 'active', 'deprecated'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
      <Field full label="Business goal"><input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Show how delegation removes approval bottlenecks" /></Field>
      <Field label="Business outcome"><select value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)}><option value="">— none —</option>{outcomes.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select></Field>
      <Field label="Environment"><select value={envId} onChange={(e) => setEnvId(e.target.value)}><option value="">— none —</option>{product.envId ? <option value={product.envId}>{product.env}</option> : null}</select></Field>
      <Field full label="Story flow">
        <div className="flex" style={{ flexDirection: 'column', gap: 6 }}>
          {steps.length === 0 ? <div className="muted">No steps yet — add the first beat.</div> : steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <span className="muted tnum">{i + 1}.</span>
              <select value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value, refId: '' })}>{['workflow', 'tour', 'knowledge', 'note'].map((k) => <option key={k} value={k}>{k}</option>)}</select>
              {s.kind !== 'note'
                ? <select value={s.refId} onChange={(e) => setStep(i, { refId: e.target.value })}><option value="">— pick {s.kind} —</option>{assetOptions(s.kind).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                : null}
              <input value={s.caption} onChange={(e) => setStep(i, { caption: e.target.value })} placeholder={s.kind === 'note' ? 'narration…' : 'caption (optional)'} style={{ flex: 1, minWidth: 140 }} />
              <button className="btn btn-secondary btn-sm" onClick={() => move(i, -1)} title="Move up">↑</button>
              <button className="btn btn-secondary btn-sm" onClick={() => move(i, 1)} title="Move down">↓</button>
              <button className="btn btn-secondary btn-sm" onClick={() => removeStep(i)} title="Remove">×</button>
            </div>
          ))}
          <div><button className="btn btn-secondary btn-sm" onClick={addStep}><Icon name="plus" size={12} /> Add step</button></div>
        </div>
      </Field>
      <Field full label="Committee (who this journey is for)">
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {committee.length === 0 ? <span className="muted">No committee defined — add people under Outcomes & Committee.</span>
            : committee.map((m) => <label key={m.id} className="flex items-center gap-2"><input type="checkbox" checked={stake.includes(m.id)} onChange={() => toggle(stake, m.id, setStake)} /> {m.name}{m.role ? ` (${m.role})` : ''}</label>)}
        </div>
      </Field>
      <Field full label="Participating specialists">
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {personas.length === 0 ? <span className="muted">No specialists.</span>
            : personas.map((p) => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" checked={specs.includes(p.id)} onChange={() => toggle(specs, p.id, setSpecs)} /> {p.name}</label>)}
        </div>
      </Field>
      <Field full label="Success criteria"><input value={success} onChange={(e) => setSuccess(e.target.value)} placeholder="CFO agrees delegation solves the bottleneck" /></Field>
      {err && <div className="banner banner-warn" style={{ gridColumn: '1 / -1' }}>{err}</div>}
    </FormShell>
  );
}

/* ── Experience Map (V5 Phase 4 — the Unified Experience Model). Answers the constitution's 13 operator
   questions for a product, each FROM PERSISTED DATA (assembled here from the already-loaded ProductRow, so the
   web app stays decoupled from src/core; the same chain is computed in src/core/experience.ts for the engine +
   eval). A question with no data is an honest gap (○ "Not yet modeled"), never fabricated. This view IS the
   constitution's success test: an operator answers all 13 without opening source code. */
const CHAIN_LINKS: Record<string, string> = {
  room: 'experience', outcome: 'experience', journey: 'journeys', workflows: 'graphs', nodes: 'graphs',
  knowledge: 'knowledge', specialists: 'personas', environment: 'environments', evidence: 'graphs',
  changed: 'graphs', broken: 'graphs', whatBreaks: 'graphs', concerns: 'experience',
};
export function ExperienceMap({ go }: { go?: Go }) {
  const data = useData();
  const products = (data.products ?? []).filter((p) => !p.archived);
  const [pid, setPid] = useState(products[0]?.id ?? '');
  const product = products.find((p) => p.id === pid) ?? products[0];
  if (!product) {
    return (<div className="page scroll">
      <PageHead overline="Experience" title="Experience Map" desc="Every operator question answered for a product from persisted data — without opening source code." go={go} />
      <div className="banner banner-info">No products yet — onboard a product first.</div>
    </div>);
  }
  const committee = product.committee ?? [];
  const outcomes = product.outcomes ?? [];
  const journeys = product.journeys ?? [];
  const journeyMissing = journeys.reduce((s, j) => s + (j.missingCount ?? 0), 0);
  const approvedWf = (product.workflows ?? []).filter((w) => w.approved).length;
  const verified = (product.graphNodeStates ?? []).filter((n) => n.status === 'verified').length;
  const evidence = (product.graphNodeStates ?? []).filter((n) => n.evidence || n.sourceChunkId).length;
  const specialists = Array.from(new Set(journeys.flatMap((j) => (j.specialistRules ?? []).map((r) => r.personaName ?? '').filter(Boolean))));
  const er = product.envReadiness;
  const concerns = committee.some((m) => (m.decisionCriteria?.length || 0) + (m.objections?.length || 0) > 0);

  const Q = (key: string, question: string, ok: boolean, summary: string) => ({ key, question, ok, summary });
  const questions = [
    Q('room', 'Who is in the room?', committee.length > 0, committee.length ? `${committee.length}: ${committee.slice(0, 4).map((m) => m.name).join(', ')}` : 'No buying committee defined'),
    Q('outcome', 'What business outcome matters?', outcomes.length > 0, outcomes.length ? `${outcomes.length}: ${outcomes.slice(0, 3).map((o) => o.title).join(', ')}` : 'No business outcomes defined'),
    Q('journey', 'Which journey applies?', journeys.length > 0, journeys.length ? `${journeys.length} journey(s)${journeyMissing ? ` · ${journeyMissing} dangling ref(s)` : ''}` : 'No journeys authored'),
    Q('workflows', 'Which workflows support it?', approvedWf > 0, `${approvedWf} approved workflow(s)`),
    Q('nodes', 'Which nodes are used?', verified > 0, `${verified} verified node(s)`),
    Q('knowledge', 'Which knowledge supports it?', (product.chunks ?? 0) > 0, `${product.chunks ?? 0} chunk(s)${product.knowledgeGroundedTurns ? ` · ${product.knowledgeGroundedTurns} grounded turn(s)` : ''}`),
    Q('specialists', 'Which specialists participate?', specialists.length > 0, specialists.length ? `${specialists.length}: ${specialists.slice(0, 4).join(', ')}` : 'No specialists assigned to a journey'),
    Q('environment', 'Which environment is compatible?', !!product.connectionTarget, er ? `${er.passed}/${er.total} readiness gates${er.ready ? ' — ready' : ''}` : 'No environment configured'),
    Q('evidence', 'What evidence exists?', evidence > 0, `${evidence} node(s) carry evidence`),
    Q('changed', 'What changed?', (product.graphEventsCount ?? 0) > 0, `${product.graphEventsCount ?? 0} audited graph change(s)`),
    Q('broken', 'What is broken?', true, (product.graphBroken || journeyMissing || (er && !er.ready)) ? `${product.graphBroken ?? 0} broken node(s), ${journeyMissing} dangling ref(s)${er && !er.ready ? ', environment not ready' : ''}` : 'Nothing flagged broken'),
    Q('whatBreaks', 'What will break if modified?', verified > 0 || journeys.length > 0, `dependency graph present: ${verified} node(s), ${journeys.length} journey(s)`),
    Q('concerns', 'What stakeholder concerns / decision criteria exist?', concerns, concerns ? 'decision criteria / objections captured' : 'No criteria or objections captured'),
  ];
  const modeled = questions.filter((q) => q.ok).length;

  return (<div className="page scroll">
    <PageHead overline="Experience" title="Experience Map"
      desc="The unified model — every operator question answered for this product from persisted data, without opening source code. Gaps are shown honestly, never hidden."
      go={go}
      actions={<select value={pid} onChange={(e) => setPid(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>} />
    <div className="card"><div className="card-pad">
      <div className="flex between items-center" style={{ marginBottom: 12 }}>
        <span className="overline">Experience completeness · {product.name}</span>
        <Pill kind={modeled === questions.length ? 'success' : modeled >= 9 ? 'info' : 'warn'} dot>{modeled}/{questions.length} answered from data</Pill>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {questions.map((q, i) => (
          <div key={q.key} className="flex between items-center" style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border-subtle)' : 'none', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ marginTop: 1, color: q.ok ? '#0a7d61' : '#9a6b1a', fontWeight: 800 }}>{q.ok ? '✓' : '○'}</span>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>{q.question}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{q.ok ? q.summary : <span style={{ color: '#9a6b1a' }}>Not yet modeled — {q.summary}</span>}</div>
              </div>
            </div>
            {go && CHAIN_LINKS[q.key] && <button className="btn btn-secondary btn-sm" onClick={() => go(CHAIN_LINKS[q.key])}>Open</button>}
          </div>
        ))}
      </div>
    </div></div>
  </div>);
}
