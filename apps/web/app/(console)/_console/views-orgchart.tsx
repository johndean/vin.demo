'use client';
/* VIN Demo console — ORG CHART editor (migration 0024). The REAL organization: people + reporting lines,
   imported from a BambooHR export. The export carries no job titles, so the operator ASSIGNS each person a
   role (job_title) here — that role is what feeds the buying committee. Truth discipline: names + reporting
   come from the real import; roles are operator-assigned, never fabricated. CRUD via the RBAC-proxied
   /experience endpoint (orgPerson.*). */
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from './data-context';
import { PageHead, Pill, Icon, type Go } from './shell';
import { FormShell, Field } from './Modal';
import { experienceMutate } from './admin';
import type { OrgPersonRow } from './data';

const ROLE_SUGGESTIONS = ['Owner / Managing Director', 'CEO', 'COO', 'Comptroller', 'Finance Manager', 'Operations Manager', 'Department Manager', 'Administration Manager', 'Purchasing Manager', 'Procurement Manager', 'Contract Administrator', 'Compliance Manager', 'Risk Manager', 'Safety Manager', 'HR Manager', 'Marketing Manager', 'Customer Service Manager', 'IT Manager', 'Site Manager', 'Regional Manager', 'Maintenance Manager'];

const initials = (n: string) => (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('') || '?';

function Avatar({ p }: { p: OrgPersonRow }) {
  const [bad, setBad] = useState(false);
  const base: React.CSSProperties = { width: 30, height: 30, borderRadius: 999, flexShrink: 0, objectFit: 'cover' };
  if (p.photoUrl && !bad) return <img src={p.photoUrl} alt="" loading="lazy" style={base} onError={() => setBad(true)} />;
  return <span style={{ ...base, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--app-active, #eef)', color: 'var(--color-navy-deep, #334)', fontSize: 11, fontWeight: 700 }}>{initials(p.name)}</span>;
}

export function OrgChart({ go }: { go?: Go }) {
  const data = useData();
  const people = data.orgPeople ?? [];
  const [q, setQ] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; row?: OrgPersonRow } | null>(null);

  const assigned = people.filter((p) => p.jobTitle.trim()).length;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => {
      if (unassignedOnly && p.jobTitle.trim()) return false;
      if (!needle) return true;
      return [p.name, p.jobTitle, p.department, p.supervisorName].some((s) => (s || '').toLowerCase().includes(needle));
    });
  }, [people, q, unassignedOnly]);

  return (
    <div className="page scroll">
      <PageHead overline="Organization" title="Org Chart" go={go}
        desc="Your real organization — imported people and reporting lines. Assign each person a role; the role (job title) is what feeds the buying committee. Names and reporting come from the real import; roles are yours to assign."
        actions={<button className="btn btn-primary btn-sm" onClick={() => setForm({ mode: 'add' })}><Icon name="plus" size={15} /> Add person</button>} />

      <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role, department, manager…"
          style={{ flex: '0 1 320px', padding: '7px 10px', border: '1px solid var(--border-subtle, #d8dde6)', borderRadius: 8, fontSize: 13 }} />
        <label className="flex items-center gap-1" style={{ fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} /> Needs a role
        </label>
        <span className="muted" style={{ fontSize: 12.5, marginLeft: 'auto' }}>{people.length} people · {assigned} roles assigned · {people.length - assigned} unassigned</span>
      </div>

      {people.length === 0
        ? <div className="card card-pad muted">No org chart imported yet. Import the BambooHR export (<code>seed:orgchart</code>), then assign roles here.</div>
        : <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, alignItems: 'start' }}>
            <div className="card">
              <div className="card-pad" style={{ padding: '4px 10px', maxHeight: '72vh', overflow: 'auto' }}>
                {filtered.length === 0 ? <div className="muted" style={{ padding: 14 }}>No people match “{q}”.</div>
                  : filtered.map((p) => (
                    <div key={p.id} className="exp-row" data-active={form?.row?.id === p.id ? 'true' : 'false'}>
                      <div className="exp-row__main flex" style={{ gap: 10, alignItems: 'flex-start' }}>
                        <Avatar p={p} />
                        <div style={{ minWidth: 0 }}>
                          <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                            <span className="cell-strong">{p.name}</span>
                            {p.jobTitle.trim() ? <Pill kind="info">{p.jobTitle}</Pill> : <span className="muted" style={{ fontSize: 11 }}>— no role —</span>}
                            {p.reports > 0 ? <span className="muted" style={{ fontSize: 11 }}>{p.reports} report{p.reports > 1 ? 's' : ''}</span> : null}
                          </div>
                          <div className="cell-sub">{[p.department, p.supervisorName ? `reports to ${p.supervisorName}` : ''].filter(Boolean).join(' · ') || '—'}</div>
                        </div>
                      </div>
                      <div className="exp-row__side">
                        <button className="btn btn-secondary btn-sm" onClick={() => setForm({ mode: 'edit', row: p })}>{p.jobTitle.trim() ? 'Edit' : 'Assign role'}</button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <div className="exp-insp">
              {form ? <OrgPersonForm mode={form.mode} row={form.row} people={people} onClose={() => setForm(null)} />
                : <div className="card card-pad exp-insp__empty muted">Select a person to assign their <strong>role</strong>, or <strong>Add person</strong>. The role you set is the job title that feeds the buying committee — names and reporting lines come from your real import.</div>}
            </div>
          </div>}
    </div>
  );
}

function OrgPersonForm({ mode, row, people, onClose }: { mode: 'add' | 'edit'; row?: OrgPersonRow; people: OrgPersonRow[]; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: row?.name ?? '', jobTitle: row?.jobTitle ?? '', department: row?.department ?? '',
    supervisorSourceId: row?.supervisorSourceId ?? '', location: row?.location ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const supervisors = people.filter((p) => p.sourcePersonId && p.id !== row?.id);
  const save = async () => {
    if (!f.name.trim()) { setErr('Name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const data = { name: f.name.trim(), jobTitle: f.jobTitle, department: f.department, supervisorSourceId: f.supervisorSourceId, location: f.location };
      if (mode === 'add') await experienceMutate('orgPerson.create', { data });
      else await experienceMutate('orgPerson.update', { orgPersonId: row!.id, data });
      onClose(); router.refresh();
    } catch (e: any) { setErr(String(e?.message ?? e)); setBusy(false); }
  };
  const archive = async () => {
    if (!row || !confirm(`Archive ${row.name} from the org chart? (soft — kept in history)`)) return;
    setBusy(true); setErr('');
    try { await experienceMutate('orgPerson.archive', { orgPersonId: row.id }); onClose(); router.refresh(); }
    catch (e: any) { setErr(String(e?.message ?? e)); setBusy(false); }
  };
  return (
    <FormShell title={mode === 'add' ? 'Add person' : `Edit · ${row?.name}`} subtitle="A real person in the organization. Role = their job title (feeds the buying committee)." onClose={onClose}
      footer={<>
        {mode === 'edit' && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={archive} style={{ marginRight: 'auto' }}>Archive</button>}
        <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Jane Doe" /></Field>
      <Field label="Role (job title)">
        <input list="org-role-suggestions" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} placeholder="e.g. Operations Manager" />
        <datalist id="org-role-suggestions">{ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist>
      </Field>
      <Field label="Department"><input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="e.g. Finance" /></Field>
      <Field label="Reports to">
        <select value={f.supervisorSourceId} onChange={(e) => setF({ ...f, supervisorSourceId: e.target.value })}>
          <option value="">— none —</option>
          {supervisors.map((s) => <option key={s.id} value={s.sourcePersonId}>{s.name}{s.jobTitle ? ` (${s.jobTitle})` : ''}</option>)}
        </select>
      </Field>
      <Field label="Location"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="optional" /></Field>
      {err && <div className="banner banner-warn">{err}</div>}
    </FormShell>
  );
}
