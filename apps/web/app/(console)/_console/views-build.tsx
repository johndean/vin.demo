'use client';
/* VIN Demo console — Library views: Knowledge, Demo Graphs, Environments, Personas
   (ported from web/views-build.jsx). */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from './data-context';
import { PageHead, Icon, Pill, ConfBar, VALIDATION, type Go } from './shell';
import { FormShell, Field } from './Modal';
import { adminMutate, knowledgeMutate, graphMutate } from './admin';
import { PresentPanel } from './PresentPanel';

/* ============================ KNOWLEDGE ============================ */
const LIFECYCLE: Record<string, { kind: string; label: string }> = {
  draft: { kind: 'neutral', label: 'Draft' },
  pending_review: { kind: 'warn', label: 'Pending review' },
  validated: { kind: 'success', label: 'Validated' },
  deprecated: { kind: 'danger', label: 'Deprecated' },
  archived: { kind: 'neutral', label: 'Archived' },
};
function relShort(iso: string): string {
  const d = Date.parse(iso); if (Number.isNaN(d)) return '';
  const days = Math.floor((Date.now() - d) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

export function Knowledge({ go, embedded, productName }: { go?: Go; embedded?: boolean; productName?: string }) {
  const VD = useData();
  const { knowledge, kbTypes } = VD;
  const [filter, setFilter] = useState('all');
  const [prod, setProd] = useState('all'); // product filter (global Library view only)
  const [sel, setSel] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  // Scope to a product: the embedded per-product tab is hard-scoped to its product; the global Library view
  // gets a product dropdown. Status filter + counts then apply WITHIN that product scope.
  const byProduct = embedded ? knowledge.filter((k) => k.product === productName)
    : (prod === 'all' ? knowledge : knowledge.filter((k) => k.product === prod));
  const filtered = filter === 'all' ? byProduct : byProduct.filter((k) => k.status === filter);
  const selected = filtered.find((k) => k.id === sel?.id) ?? filtered[0];
  const productNames = (VD.products ?? []).filter((p: any) => !p.archived).map((p: any) => p.name);
  return (
    <div className={embedded ? '' : 'page scroll'}>
      {!embedded && (
        <PageHead overline="Library" title="Knowledge"
          desc="Every chunk carries trust metadata — confidence, source + owner, who validated it and when, product version, and lifecycle state. Unvalidated, stale, or low-confidence knowledge degrades gracefully in live demos instead of being asserted."
          actions={<button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setAdding(true); }}><Icon name="plus" size={15} /> Add chunk</button>} />
      )}
      {adding && <AddChunkForm onClose={() => setAdding(false)} defaultProductId={embedded ? (VD.products.find((p: any) => p.name === productName)?.id) : selected?.productId} />}
      {editing && <EditChunkForm k={editing} onClose={() => setEditing(null)} />}
      {!adding && !editing && (
        <>
          {!embedded && (
            <div className="banner banner-info" style={{ marginBottom: 18 }}><Icon name="info" size={18} style={{ color: 'var(--color-blue)' }} />
              <div><strong>Trust metadata is a hard schema requirement.</strong> An answer below the confidence threshold, not yet validated, or tied to a stale product version degrades to &quot;let me show you the source / I&apos;m not certain.&quot; New chunks enter as <em>drafts</em> and aren&apos;t retrievable until validated.</div></div>
          )}
          {/* V5 Phase 3 — REAL knowledge-usage telemetry: audit turns that cited knowledge (from audit_turns.knowledge_used). */}
          {!embedded && (() => {
            const grounded = (VD.products ?? []).filter((p: any) => prod === 'all' || p.name === prod).reduce((s: number, p: any) => s + (p.knowledgeGroundedTurns ?? 0), 0);
            return <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>Knowledge-grounded demo turns{prod !== 'all' ? ` · ${prod}` : ''}: <b>{grounded}</b> <span style={{ opacity: .7 }}>— audit turns that cited knowledge; telemetry-gated, grows as demos run</span></div>;
          })()}
          <div className="flex between items-center" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
            <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              {!embedded && (
                <select value={prod} onChange={(e) => { setProd(e.target.value); setSel(null); }} aria-label="Filter by product"
                  style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line, #d4dae3)', fontWeight: 600, background: 'var(--surface, #fff)', color: 'var(--text-primary, #1a2b45)' }}>
                  <option value="all">All products</option>
                  {productNames.map((n: string) => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
              {([['all', 'All', byProduct.length], ['validated', 'Validated', byProduct.filter((k) => k.status === 'validated').length], ['needs-review', 'Needs review', byProduct.filter((k) => k.status === 'needs-review').length], ['stale', 'Stale', byProduct.filter((k) => k.status === 'stale').length]] as [string, string, number][]).map(([id, lbl, n]) => (
                <button key={id} className={`btn btn-sm ${filter === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(id)}>{lbl} <span style={{ opacity: .7 }}>{n}</span></button>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{embedded ? `${productName} · ${byProduct.length} chunks` : `${filtered.length} of ${knowledge.length} chunks${prod !== 'all' ? ` · ${prod}` : ' · all products'}`}</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Chunk</th>{!embedded && <th>Product</th>}<th>Type</th><th>Conf.</th><th>Status</th></tr></thead>
                <tbody>
                  {filtered.map((k) => (
                    <tr key={k.id} onClick={() => setSel(k)} style={selected?.id === k.id ? { background: 'var(--app-active)' } : {}}>
                      <td><div className="cell-strong">{k.title}</div><div className="cell-sub mono">{k.source}</div></td>
                      {!embedded && <td><Pill kind="neutral">{k.product}</Pill></td>}
                      <td><Pill kind={kbTypes[k.type].cls.replace('pill-', '')}>{kbTypes[k.type].label}</Pill></td>
                      <td style={{ minWidth: 110 }}><div className="flex items-center gap-2"><ConfBar v={k.conf} max={70} /><span className="tnum" style={{ fontSize: 12, fontWeight: 700 }}>{Math.round(k.conf * 100)}</span></div></td>
                      <td><Pill kind={VALIDATION[k.status].kind} dot>{VALIDATION[k.status].label}</Pill></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={embedded ? 4 : 5} className="muted" style={{ padding: 20, textAlign: 'center' }}>No chunks in this view.</td></tr>}
                </tbody>
              </table>
            </div>
            {selected && <ChunkPanel k={selected} kbTypes={kbTypes} onEdit={() => { setAdding(false); setEditing(selected); }} />}
          </div>
        </>
      )}
    </div>
  );
}

function ChunkPanel({ k, kbTypes, onEdit }: { k: any; kbTypes: any; onEdit: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const conf = Math.round(k.conf * 100);
  const degrades = k.conf < 0.7 || k.status === 'stale' || (!!k.lifecycleState && k.lifecycleState !== 'validated');
  const lc = LIFECYCLE[k.lifecycleState] ?? { kind: 'neutral', label: k.lifecycleState ?? '—' };
  const act = async (action: 'validate' | 'archive', tag: string) => {
    setBusy(tag); setErr('');
    try { await knowledgeMutate(action, { chunkId: k.id }); router.refresh(); }
    catch (e: any) { setErr(e?.message || `${action} failed`); setBusy(''); }
  };
  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div className="card-hd"><div><div className="overline">Chunk · trust metadata</div><h3 style={{ marginTop: 4, fontSize: 14, lineHeight: 1.3 }}>{k.title}</h3></div></div>
      <div className="card-pad">
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, fontStyle: 'italic', borderLeft: '2px solid var(--border-subtle)', paddingLeft: 12, margin: '0 0 18px' }}>
          &quot;{k.content}&quot;
        </p>
        <div className="trust">
          <div className="trust__row"><span className="trust__k">Product</span><span className="trust__v" style={{ fontWeight: 700 }}>{k.product ?? '—'}</span></div>
          <div className="trust__row"><span className="trust__k">Confidence</span><ConfBar v={k.conf} /><span className="trust__v tnum">{conf}%</span></div>
          <div className="trust__row"><span className="trust__k">Source</span><span className="trust__v mono" style={{ fontSize: 12 }}>{k.source}</span></div>
          {k.sourceOwner && <div className="trust__row"><span className="trust__k">Source owner</span><span className="trust__v">{k.sourceOwner}</span></div>}
          <div className="trust__row"><span className="trust__k">Validated by</span><span className="trust__v">{k.validatedBy ? `${k.validatedBy}${k.validatedAt ? ` · ${k.validatedAt}` : ''}` : '— not yet validated'}</span></div>
          <div className="trust__row"><span className="trust__k">Last verified</span><span className="trust__v">{k.verified}</span></div>
          <div className="trust__row"><span className="trust__k">Product version</span><span className="trust__v">v{k.ver}</span></div>
          <div className="trust__row"><span className="trust__k">Category</span><span><Pill kind={kbTypes[k.type].cls.replace('pill-', '')}>{kbTypes[k.type].label}</Pill></span></div>
          <div className="trust__row"><span className="trust__k">Lifecycle</span><span><Pill kind={lc.kind} dot>{lc.label}</Pill></span></div>
        </div>
        <hr className="divider" style={{ margin: '16px 0' }} />
        <div className="overline" style={{ marginBottom: 8 }}>Live-demo behavior</div>
        {degrades ? (
          <div className="banner banner-warn" style={{ fontSize: 12.5 }}><Icon name="alert" size={16} style={{ color: 'var(--color-amber)' }} /><div>Below threshold / unvalidated / stale → the consultant <strong>degrades</strong>: &quot;I&apos;m not certain — here&apos;s the source,&quot; and won&apos;t assert this in a demo.</div></div>
        ) : (
          <div className="banner" style={{ fontSize: 12.5, background: '#e2f1ec', borderLeft: '4px solid var(--color-green)', color: 'var(--color-navy)' }}><Icon name="check" size={16} style={{ color: 'var(--color-green)' }} /><div>Validated and current → the consultant cites this with source, owner, validator + version when answering.</div></div>
        )}
        {k.history?.length > 0 && (
          <>
            <hr className="divider" style={{ margin: '16px 0' }} />
            <div className="overline" style={{ marginBottom: 8 }}>History</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {k.history.map((h: any, i: number) => (
                <div key={i} className="flex items-center gap-2" style={{ fontSize: 12 }}>
                  <Pill kind="neutral">{h.action}</Pill>
                  <span className="muted">{h.actor}{h.at ? ` · ${relShort(h.at)}` : ''}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="flex gap-2" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary btn-sm" onClick={onEdit} disabled={!!busy}><Icon name="edit" size={14} /> Edit</button>
          <button className="btn btn-secondary btn-sm" onClick={() => act('validate', 'v')} disabled={!!busy}>{busy === 'v' ? 'Validating…' : 'Re-verify'}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => act('archive', 'a')} disabled={!!busy}>{busy === 'a' ? 'Archiving…' : 'Archive'}</button>
        </div>
        {err && <div className="banner banner-warn" style={{ fontSize: 12, marginTop: 10 }}>{err}</div>}
      </div>
    </div>
  );
}

function AddChunkForm({ onClose, defaultProductId }: { onClose: () => void; defaultProductId?: string }) {
  const VD = useData();
  const router = useRouter();
  const products = (VD.products ?? []).filter((p: any) => !p.archived);
  const [productId, setProductId] = useState(defaultProductId || products[0]?.id || '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState('doc');
  const [category, setCategory] = useState('docs');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!content.trim() || !title.trim() || !productId) { setErr('Product, source title, and content are required.'); return; }
    setBusy(true); setErr('');
    try { await knowledgeMutate('add', { productId, content: content.trim(), sourceTitle: title.trim(), sourceType: type, category }); onClose(); router.refresh(); }
    catch (e: any) { setErr(e?.message || 'Add failed'); setBusy(false); }
  };
  return (
    <FormShell title="Add knowledge chunk" subtitle="Pasted text is embedded (Voyage) and enters as a draft — not retrievable until validated." onClose={onClose} grid
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Embedding…' : 'Add chunk'}</button></>}>
      <Field label="Product"><select value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Source title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Purchasing Policy v3" /></Field>
      <Field label="Source type"><select value={type} onChange={(e) => setType(e.target.value)}>{['doc', 'faq', 'sop', 'release_note', 'competitor_positioning', 'manual'].map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
      <Field label="Category"><select value={category} onChange={(e) => setCategory(e.target.value)}>{['docs', 'faq', 'sop', 'release_note', 'competitor_positioning'].map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
      <Field full label="Content"><textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste the knowledge text…" /></Field>
      {err && <div className="modal__err fld--full">{err}</div>}
    </FormShell>
  );
}

function EditChunkForm({ k, onClose }: { k: any; onClose: () => void }) {
  const router = useRouter();
  const [content, setContent] = useState(k.content ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!content.trim()) { setErr('Content is required.'); return; }
    setBusy(true); setErr('');
    try { await knowledgeMutate('edit', { chunkId: k.id, content: content.trim() }); onClose(); router.refresh(); }
    catch (e: any) { setErr(e?.message || 'Edit failed'); setBusy(false); }
  };
  return (
    <FormShell title="Edit chunk" subtitle="Editing re-embeds the chunk and returns it to pending review — re-verify to make it live again." onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Re-embedding…' : 'Save + re-embed'}</button></>}>
      <Field full label="Content"><textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
      {err && <div className="modal__err fld--full">{err}</div>}
    </FormShell>
  );
}

/* ============================ DEMO GRAPHS ============================ */
export function DemoGraphs({ go }: { go: Go }) {
  const VD = useData();
  return (
    <div className="page scroll">
      <PageHead overline="Library" title="Demo Graphs"
        desc="Each product's verified screen / workflow map — the navigation truth the consultant plans over. Open a product's Demo Graph to discover screens from its knowledge, run validation (drift), and publish." />
      <div className="grid cols-3">
        {VD.products.map((p) => (
          <div key={p.id} className="card card-pad" style={{ cursor: 'pointer' }} onClick={() => go('products', p.id)}>
            <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
              <span style={{ width: 34, height: 34, borderRadius: 8, background: p.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{p.mk}</span>
              <div><div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{p.name}</div><div className="muted" style={{ fontSize: 12 }}>{p.graphNodes} screens · {p.graphFlows} workflows</div></div>
            </div>
            <NodeChips labels={p.graphNodeLabels} color={p.color} />
            {(p.graphStatus || p.graphBroken > 0) && (
              <div className="flex gap-2 items-center" style={{ marginTop: 10, flexWrap: 'wrap', fontSize: 11 }}>
                {p.graphStatus && <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{p.graphStatus}{p.graphVersion != null ? ` · v${p.graphVersion}` : ''}</span>}
                {p.graphCoverage != null && <span className="muted">graph {Math.round(p.graphCoverage * 100)}%</span>}
                {p.graphBroken > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}>{p.graphBroken} broken</span>}
              </div>
            )}
            <div className="flex between" style={{ marginTop: 12, fontSize: 12 }}><span className="muted">Knowledge validated</span><span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.coverage}%</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Real node preview — the actual seeded demo_graph_nodes (intent labels), not a fixed decorative SVG. */
function NodeChips({ labels, color }: { labels: string[]; color: string }) {
  if (!labels?.length) return <div className="empty" style={{ padding: '14px 0', fontSize: 12 }}>No graph nodes seeded yet.</div>;
  const shown = labels.slice(0, 8);
  return (
    <div style={{ background: 'var(--app-surface-2)', borderRadius: 8, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 76, alignContent: 'flex-start' }}>
      {shown.map((l) => (
        <span key={l} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 6, height: 6, borderRadius: 99, background: color }} />{l}
        </span>
      ))}
      {labels.length > shown.length && <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>+{labels.length - shown.length} more</span>}
    </div>
  );
}

/* Per-node verification status → colour. The graph picture IS the truth: green = recon-verified on the
   real site, red = broken (drift), amber = pending review, grey = draft (autogen, not yet verified). */
const NODE_STATUS: Record<string, { color: string; label: string }> = {
  verified: { color: '#16a34a', label: 'Verified' },
  broken: { color: '#dc2626', label: 'Broken' },
  pending_review: { color: '#d97706', label: 'Pending' },
  draft: { color: '#94a3b8', label: 'Draft' },
};
const nodeColor = (s?: string) => NODE_STATUS[s ?? 'draft']?.color ?? '#94a3b8';

/* Real, working graph actions (Phase E) — RBAC-proxied to the engine (which holds the LLM + Playwright).
   "Discover from knowledge" runs the knowledge→graph autogen (a DRAFT graph, grounded + faithfulness-gated,
   nothing auto-published); "Run validation" recon-checks the active graph against the real site (drift).
   Both are evidence-based — never invented. */
function GraphActions({ p }: { p: any }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const draft = p.draftGraph as { id: string; name: string; nodes: number; pending: number } | null;
  const call = async (key: string, action: 'autogen' | 'verify' | 'publish' | 'archive' | 'tour.link' | 'rollback', payload: Record<string, unknown>, done: (r: any) => string) => {
    setBusy(key); setMsg(null);
    try { const r: any = await graphMutate(action, payload); setMsg(done(r)); router.refresh(); }
    catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); }
    finally { setBusy(null); }
  };
  // Impact analysis (Phase 4) — publishing a draft deactivates the current active graph; show the blast-radius first.
  const publishDraft = () => { if (draft && !window.confirm(`Publish “${draft.name}”?\n\nThis deactivates the current active graph (${p.graphFlows ?? 0} workflow(s), ${p.graphNodes ?? 0} node(s)) and activates the draft (${draft.nodes} screen(s)). Verified nodes + approved workflows carry forward. Reversible via Roll back.`)) return; if (draft) void call('publish', 'publish', { graphId: draft.id }, () => `Published “${draft.name}” — now active (verified nodes + approved workflows carried forward).`); };
  return (
    <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
      <button className="btn btn-secondary" disabled={!!busy} onClick={() => call('autogen', 'autogen', { product: p.name }, (r) => `Discovered ${r.screensKept ?? 0} screen(s) · ${r.workflowsKept ?? 0} workflow(s) → draft "${p.name} — autogen". Review + publish.`)}>{busy === 'autogen' ? 'Discovering…' : 'Discover from knowledge'}</button>
      <button className="btn btn-secondary" disabled={!!busy} onClick={() => call('verify', 'verify', { product: p.name }, (r) => `Validation: ${r.verified ?? 0} verified · ${r.broken ?? 0} broken${r.drift ? ` (${r.drift} drift)` : ''} · coverage ${Math.round((r.coverageScore ?? 0) * 100)}%.`)}>{busy === 'verify' ? 'Validating…' : 'Run validation'}</button>
      <button className="btn btn-secondary" disabled={!!busy} onClick={() => call('tourlink', 'tour.link', { productId: p.id }, (r) => `Linked ${r.stepsLinked ?? 0} tour step(s) across ${r.tours ?? 0} tour(s) to graph nodes (exact consumption).`)}>{busy === 'tourlink' ? 'Linking…' : 'Link tours to graph'}</button>
      {draft && <button className="btn btn-primary" disabled={!!busy} onClick={publishDraft}>{busy === 'publish' ? 'Publishing…' : `Publish draft (${draft.nodes} screens · ${draft.pending} pending)`}</button>}
      {draft && <button className="btn btn-secondary" disabled={!!busy} onClick={() => { if (!window.confirm(`Discard (archive) draft “${draft.name}”? Reversible — drafts are soft-archived, not deleted.`)) return; void call('archive', 'archive', { graphId: draft.id }, () => `Archived draft "${draft.name}".`); }}>{busy === 'archive' ? 'Archiving…' : 'Discard draft'}</button>}
      {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
    </div>
  );
}

/* Draft sitemap preview (this session): when a Discover draft exists, list its pages BEFORE publishing —
   so the full generated sitemap is viewable, not hidden behind a count. */
function DraftPreview({ p }: { p: any }) {
  const [open, setOpen] = useState(false);
  const nodes: any[] = Array.isArray(p.draftNodesDetail) ? p.draftNodesDetail : [];
  if (!nodes.length) return null;
  return (
    <div className="card card-pad" style={{ marginBottom: 12, borderLeft: '3px solid #94a3b8' }}>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Preview'} draft sitemap ({nodes.length} page{nodes.length === 1 ? '' : 's'})</button>
      {open && <div style={{ display: 'grid', gap: 3, marginTop: 8, fontSize: 12 }}>{nodes.map((n) => {
        const elc = Array.isArray(n.elements) ? n.elements.length : 0;
        return (
          <div key={n.id} className="flex gap-2 items-center">
            <i style={{ width: 8, height: 8, borderRadius: 99, background: nodeColor(n.status), display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{n.screenName || n.label}</span>
            <span className="muted">{n.route || ''}</span>
            <span className="muted" style={{ marginLeft: 'auto', flexShrink: 0 }}>{elc} element{elc === 1 ? '' : 's'}</span>
          </div>);
      })}</div>}
    </div>
  );
}

/* Renders the product's REAL active demo-graph nodes, COLOURED by verification status (the navigation
   truth), with computed graph pills, real graph actions, the WORKFLOW BUILDER, and a graph picture whose
   EDGES are the real workflow journeys (selecting a workflow highlights its path; otherwise approved
   journeys are drawn faintly). */
export function DemoGraphInner({ p }: { p: any }) {
  const [selWf, setSelWf] = useState<string | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  const states: { label: string; status: string }[] = Array.isArray(p.graphNodeStates) && p.graphNodeStates.length
    ? p.graphNodeStates
    : (Array.isArray(p.graphNodeLabels) ? p.graphNodeLabels : []).map((l: string) => ({ label: l, status: 'verified' }));
  if (!states.length) {
    return <div className="card card-pad">
      <GraphActions p={p} />
      <DraftPreview p={p} />
      <div className="empty" style={{ marginBottom: 16 }}>No active demo-graph nodes for {p.name} yet. Use “Discover from knowledge” to derive a draft graph from the validated knowledge base, then validate + publish it.</div>
      <WorkflowSection p={p} states={[]} selWf={selWf} setSelWf={setSelWf} />
    </div>;
  }
  const perRow = 3, cw = 240, ch = 96, padX = 30, padY = 30;
  const rows = Math.ceil(states.length / perRow);
  const w = padX * 2 + perRow * cw, h = padY * 2 + rows * ch;
  const pos = states.map((s, i) => ({ ...s, x: padX + (i % perRow) * cw + cw / 2, y: padY + Math.floor(i / perRow) * ch + 30 }));
  const posByLabel = new Map(pos.map((pp) => [pp.label.toLowerCase(), pp]));
  const workflows: any[] = Array.isArray(p.workflows) ? p.workflows : [];
  const selected = workflows.find((x) => x.id === selWf) || null;
  const selLabels = new Set<string>(selected ? selected.sequence.map((s: string) => s.toLowerCase()) : []);
  const studioNode = selNode ? (Array.isArray(p.graphNodeStates) ? p.graphNodeStates : []).find((n: any) => n.id === selNode) || null : null;
  // Consecutive position pairs for a sequence (skips labels not on this graph — a journey can outlive a node).
  const seqEdges = (seq: string[]): [any, any][] => seq.map((lbl, i) => (i === 0 ? null : [posByLabel.get(String(seq[i - 1]).toLowerCase()), posByLabel.get(String(lbl).toLowerCase())]))
    .filter((pr): pr is [any, any] => !!pr && !!pr[0] && !!pr[1]);
  const pill = (text: string, color?: string) => <span style={{ fontSize: 11, fontWeight: 700, color: color ?? 'var(--text-primary)', background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '3px 8px' }}>{text}</span>;
  return (
    <>
      <GraphActions p={p} />
      <DraftPreview p={p} />
      <div className="flex gap-2 items-center" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {p.graphStatus && pill(`status: ${p.graphStatus}`)}
        {p.graphVersion != null && pill(`v${p.graphVersion}`)}
        {p.graphCoverage != null && pill(`coverage ${Math.round(p.graphCoverage * 100)}%`)}
        {p.graphBroken > 0 && pill(`${p.graphBroken} broken`, '#dc2626')}
        <span className="muted" style={{ fontSize: 12 }}>{states.length} real screens · {p.graphFlows} workflow{p.graphFlows === 1 ? '' : 's'} — the verified map the consultant navigates over.</span>
      </div>
      {selected && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Showing journey <strong style={{ color: 'var(--text-primary)' }}>{selected.name}</strong> — click it again to clear.</div>}
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block', background: 'var(--app-surface-2)', minWidth: 520 }}>
          <defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={p.color} /></marker></defs>
          {/* At rest: faint edges for every APPROVED journey. Selected: that journey's path, bold + arrowed. */}
          {!selected && workflows.filter((wf) => wf.approved).flatMap((wf) => seqEdges(wf.sequence).map(([a, b], i) => <line key={`a-${wf.id}-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-subtle)" strokeWidth="2" />))}
          {selected && seqEdges(selected.sequence).map(([a, b], i) => <line key={`s-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={p.color} strokeWidth="3" markerEnd="url(#wf-arrow)" />)}
          {pos.map((n, i) => {
            const dim = !!selected && !selLabels.has(n.label.toLowerCase());
            return (
              <g key={i} style={{ opacity: dim ? 0.3 : 1, cursor: (n as any).id ? 'pointer' : 'default' }} onClick={() => { const id = (n as any).id; if (id) setSelNode((s) => (s === id ? null : id)); }}>
                <title>{n.label}{(n as any).type ? ` · ${(n as any).type}` : ''} — {n.status} — click to inspect</title>
                <rect x={n.x - 104} y={n.y - 18} width="208" height="36" rx="8" fill="var(--surface-card)" stroke={nodeColor(n.status)} strokeWidth="2" />
                <circle cx={n.x - 90} cy={n.y} r="4" fill={nodeColor(n.status)} />
                <text x={n.x - 78} y={n.y + 4} fontSize="12" fontWeight="700" fill="var(--text-primary)" fontFamily="var(--font-family)">{n.label.length > 24 ? n.label.slice(0, 22) + '…' : n.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex gap-3 items-center" style={{ marginTop: 10, flexWrap: 'wrap', fontSize: 11 }}>
        {Object.values(NODE_STATUS).map((s) => <span key={s.label} className="flex items-center gap-1"><i style={{ width: 8, height: 8, borderRadius: 99, background: s.color, display: 'inline-block' }} /> <span className="muted">{s.label}</span></span>)}
      </div>
      <div className="banner banner-info section-gap"><Icon name="info" size={18} style={{ color: 'var(--color-blue)' }} /><div>Node colour is the navigation truth: green = recon-verified on the real site, red = broken (drift → needs review), amber/grey = pending/draft. The consultant only navigates VERIFIED nodes; if a live selector breaks, recovery re-grounds against this graph rather than failing the demo. <strong>Click any node to inspect it (Node Studio).</strong></div></div>
      {/* F1 — Navigation-control disclosure (honest until every engine resolves through the graph). */}
      <div className="banner section-gap" style={{ borderLeft: '3px solid var(--color-blue)' }}><Icon name="info" size={18} style={{ color: 'var(--color-blue)' }} /><div><strong>Navigation control:</strong> this graph is the authority for conversational <strong>Ask</strong>, <strong>Voice</strong>, and <strong>Reel</strong> (<span style={{ color: '#16a34a', fontWeight: 700 }}>Graph-Controlled</span>). The desktop step-driver currently navigates by live-DOM perception (<span style={{ color: '#d97706', fontWeight: 700 }}>DOM-Controlled</span>) — recording its outcomes against these nodes and bridging it onto the graph is the next phase. No false authority claims.</div></div>
      {studioNode && <NodeStudio node={studioNode} onClose={() => setSelNode(null)} />}
      {/* Intent mapping — PURPOSE-FIRST: what the product is FOR (outcomes + the capabilities/workflows that
          demonstrate them) is the primary "what the consultant resolves to". The EMPIRICAL free-roam log
          (navigation_attempts) is a SECONDARY "observed navigation" layer — usage + reliability, not the map. */}
      {(() => {
        const wfs: any[] = Array.isArray(p.workflows) ? p.workflows : [];
        const outs: any[] = Array.isArray(p.outcomes) ? p.outcomes : [];
        const jrs: any[] = Array.isArray(p.journeys) ? p.journeys : [];
        const im: any[] = Array.isArray(p.intentMap) ? p.intentMap : [];
        const wfsSorted = [...wfs].sort((a, b) => (a.approved === b.approved ? 0 : a.approved ? -1 : 1));
        const live = wfs.filter((w) => w.approved).length;
        return (
          <div className="card card-pad section-gap">
            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>What the consultant resolves to</div>
            <div className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>The product&apos;s purpose — its business outcomes and the capabilities (workflows) that demonstrate them. The observed-navigation log below is what real sessions have exercised, and how reliably.</div>

            {outs.length > 0 && <>
              <div className="overline" style={{ margin: '6px 0 4px' }}>Business outcomes ({outs.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {outs.slice(0, 10).map((o, i) => <span key={i} style={{ fontSize: 12, padding: '2px 9px', borderRadius: 999, background: 'var(--accent-soft, rgba(8,97,206,.08))', color: 'var(--accent,#0861ce)', whiteSpace: 'nowrap' }}>{o.title}</span>)}
                {outs.length > 10 && <span className="muted" style={{ fontSize: 12 }}>+{outs.length - 10} more</span>}
              </div>
            </>}

            {jrs.length > 0 && <>
              <div className="overline" style={{ margin: '8px 0 4px' }}>Guided journeys ({jrs.length})</div>
              <div style={{ display: 'grid', gap: 3, marginBottom: 6 }}>{jrs.slice(0, 6).map((j, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{j.name}</span>
                  <span className="muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.outcomeTitle || j.businessGoal}</span>
                  <span className="muted" style={{ flexShrink: 0 }}>{Array.isArray(j.storyFlow) ? j.storyFlow.length : 0} steps · {j.status}{j.missingCount > 0 ? ` · ${j.missingCount} gap(s)` : ''}</span>
                </div>))}</div>
            </>}

            <div className="overline" style={{ margin: '8px 0 4px' }}>Capabilities — {live} live · {wfs.length - live} draft</div>
            {wfs.length
              ? <div style={{ display: 'grid', gap: 4 }}>{wfsSorted.slice(0, 40).map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5 }}>
                    <span style={{ width: 14, flexShrink: 0, color: w.approved ? '#16a34a' : 'var(--muted,#8499b3)', fontWeight: 800 }} title={w.approved ? 'live (approved)' : 'draft (pending approval)'}>{w.approved ? '✓' : '·'}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>{w.name}</span>
                    {w.stakeholderType && w.stakeholderType.toLowerCase() !== 'none' && <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>({w.stakeholderType})</span>}
                    <span className="muted" style={{ flex: 1, minWidth: 0, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(w.sequence || []).join(' → ')}</span>
                  </div>))}</div>
              : <div className="empty">No capabilities yet — author workflows in the Workflow Builder, or run Autogen to derive them from knowledge.</div>}

            <div className="overline" style={{ margin: '12px 0 4px' }}>Observed navigation (learned from real sessions)</div>
            {im.length
              ? <div style={{ display: 'grid', gap: 4 }}>{im.slice(0, 12).map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{e.intent}”</span>
                    <span className="muted">→</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>{e.node}</span>
                    <span className="muted" style={{ width: 96, textAlign: 'right', flexShrink: 0 }}>{e.confidence != null ? `${e.confidence}% success` : '—'}</span>
                    <span className="muted" style={{ width: 40, textAlign: 'right', flexShrink: 0 }}>{e.attempts}×</span>
                  </div>))}</div>
              : <div className="muted" style={{ fontSize: 12 }}>No sessions recorded yet — this fills as demos run (it&apos;s usage telemetry, not the capability map above).</div>}
          </div>
        );
      })()}
      <GraphGovernance p={p} />
      <WorkflowSection p={p} states={states} selWf={selWf} setSelWf={setSelWf} />
    </>
  );
}

/* ── Node Studio (V3.2 Experience Registry) ── The per-node inspector + manual-override surface. EVERYTHING
   shown is REAL stored data: self-explanation (purpose/outcome), provenance (the faithfulness-gated evidence
   + source), navigation (route/selectors/permissions/labels), verification (status/source/date), authorship,
   the WORKFLOWS that consume it, and the node's graph_events change history. Unproven edges (tours / journeys
   / intent) show "Not yet modeled" — never fabricated. Edit/archive write through the audited /graph route. */
function NodeStudio({ node, onClose }: { node: any; onClose: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    screenName: node.screenName || '', screenType: node.type || '', route: node.route || '',
    businessPurpose: node.businessPurpose || '', businessOutcome: node.businessOutcome || '',
    verificationStatus: node.status || 'draft', locators: JSON.stringify(node.locators ?? [], null, 0),
  });
  const consumers: any[] = Array.isArray(node.consumers) ? node.consumers : [];
  const history: any[] = Array.isArray(node.history) ? node.history : [];
  const attempts: any[] = Array.isArray(node.navAttempts) ? node.navAttempts : [];
  const meta = NODE_STATUS[node.status ?? 'draft'] ?? NODE_STATUS.draft;
  const inp: React.CSSProperties = { width: '100%', padding: '6px 9px', border: '1px solid var(--border-subtle)', borderRadius: 7, fontSize: 12.5, background: 'var(--surface-card)', color: 'var(--text-primary)' };
  const NM = <span className="muted" style={{ fontStyle: 'italic' }}>Not yet modeled</span>;
  const row = (k: string, v: React.ReactNode) => <div style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}><span className="muted" style={{ width: 120, flexShrink: 0 }}>{k}</span><span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{v}</span></div>;
  const sect = (t: string) => <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', margin: '10px 0 4px' }}>{t}</div>;
  const date = (s: string | null) => (s ? new Date(s).toLocaleDateString() : null);

  const save = async () => {
    setBusy('save'); setErr(null);
    let locatorStrategies: any;
    if (f.locators.trim()) { try { locatorStrategies = JSON.parse(f.locators); if (!Array.isArray(locatorStrategies)) throw new Error('must be a JSON array'); } catch (e: any) { setErr(`Selectors JSON: ${e?.message ?? e}`); setBusy(null); return; } }
    try {
      await graphMutate('node.update', { nodeId: node.id, data: {
        screenName: f.screenName || null, screenType: f.screenType || null, screenRoute: f.route || null,
        businessPurpose: f.businessPurpose || null, businessOutcome: f.businessOutcome || null,
        verificationStatus: f.verificationStatus, ...(locatorStrategies !== undefined ? { locatorStrategies } : {}),
      } });
      setEditing(false); router.refresh();
    } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(null); }
  };
  const archive = async () => {
    if (!window.confirm(`Archive node “${node.label}”?\n\n${consumers.length} workflow(s) reference it — they will degrade honestly until re-pointed. Soft-archive (reversible).`)) return;
    setBusy('archive'); setErr(null);
    try { await graphMutate('node.archive', { nodeId: node.id }); onClose(); router.refresh(); }
    catch (e: any) { setErr(e?.message ?? String(e)); setBusy(null); }
  };

  return (
    <div className="card card-pad section-gap">
      <div className="flex between items-center" style={{ marginBottom: 6 }}>
        <div className="flex items-center gap-2">
          <i style={{ width: 10, height: 10, borderRadius: 99, background: meta.color, display: 'inline-block' }} />
          <strong style={{ color: 'var(--text-primary)' }}>{node.screenName || node.label}</strong>
          <span className="muted" style={{ fontSize: 12 }}>{node.label}{node.type ? ` · ${node.type}` : ''}</span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 6 }}>{err}</div>}
      {!editing ? (
        <>
          {sect('Why this screen')}
          {row('Purpose', node.businessPurpose || (consumers.length ? <span className="muted">derived from consuming workflows</span> : NM))}
          {row('Outcome', node.businessOutcome || NM)}
          {row('Evidence', node.evidence ? <span>“{node.evidence}”{node.sourceTitle ? <span className="muted"> — {node.sourceTitle}</span> : null}</span> : <span className="muted">not recorded (pre-provenance node)</span>)}
          {sect('Navigation')}
          {row('Route', node.route || NM)}
          {row('Selectors', node.locators?.length ? `${node.locators.length} strateg${node.locators.length === 1 ? 'y' : 'ies'}: ${node.locators.map((l: any) => l?.how || l?.by || (l && Object.keys(l)[0]) || '?').join(', ')}` : NM)}
          {row('Permissions', node.permissions?.length ? node.permissions.join(', ') : NM)}
          {row('Per-role labels', Object.keys(node.personaLabels || {}).length ? Object.entries(node.personaLabels).map(([k, v]) => `${k}: ${v}`).join(' · ') : NM)}
          {sect('Page surface')}
          {(() => {
            const els: any[] = Array.isArray(node.elements) ? node.elements : [];
            if (!els.length) return row('Elements', NM);
            const groups: [string, string][] = [['button', 'Buttons'], ['action', 'Actions'], ['field', 'Fields'], ['tab', 'Tabs'], ['error', 'Errors'], ['faq', 'FAQs'], ['workflow_interaction', 'Workflow'], ['section', 'Sections'], ['note', 'Notes']];
            const STc: Record<string, string> = { partial: '#d97706', dead_ui: '#dc2626', unwired: '#dc2626', unknown: '#94a3b8' };
            return <div style={{ display: 'grid', gap: 6 }}>
              {row('Elements', `${els.length} total — the page's real UX surface (buttons, actions, forms, fields)`) }
              {groups.map(([t, label]) => { const items = els.filter((e) => e.type === t); if (!items.length) return null; return (
                <div key={t} style={{ fontSize: 12 }}>
                  <span className="muted" style={{ fontWeight: 700 }}>{label} ({items.length}):</span>{' '}
                  {items.map((e: any, i: number) => <span key={i} title={typeof e.detail?.description === 'string' ? e.detail.description : (typeof e.detail?.answer === 'string' ? e.detail.answer : undefined)} style={{ display: 'inline-block', margin: '2px 4px 2px 0', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '2px 7px', color: (e.status && e.status !== 'live' && STc[e.status]) ? STc[e.status] : 'var(--text-primary)' }}>{e.label}{e.status && e.status !== 'live' ? ` · ${e.status}` : ''}</span>)}
                </div>); })}
            </div>;
          })()}
          {sect('Verification')}
          {row('Status', <span style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</span>)}
          {row('Source', node.verificationSource || NM)}
          {row('Last verified', node.lastVerified ? new Date(node.lastVerified).toLocaleString() : NM)}
          {row('Page version', node.pageVersion || NM)}
          {sect('Consumed by')}
          {consumers.length
            ? <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 2 }}>{consumers.map((c) => <span key={c.id} title={[c.stakeholderType, c.personaType].filter(Boolean).join(' · ')} style={{ fontSize: 11, border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '3px 8px' }}>{c.name}{c.approved ? '' : ' · suggestion'}</span>)}</div>
            : <div className="muted" style={{ fontSize: 12 }}>No workflows reference this node — safe to archive.</div>}
          {row('Tours', node.tourConsumers?.length ? node.tourConsumers.map((t: any) => t.name).join(' · ') + ' (matched by selector/route)' : NM)}
          {row('Journeys', NM)}
          {row('Intent resolution', node.resolvingIntents?.length ? `${node.resolvingIntents.length} intent${node.resolvingIntents.length === 1 ? '' : 's'} resolve here: ${node.resolvingIntents.slice(0, 3).map((s: string) => `“${s}”`).join(', ')}${node.resolvingIntents.length > 3 ? '…' : ''}` : NM)}
          {sect('Provenance')}
          {row('Created', node.createdBy ? `${node.createdBy}${date(node.createdAt) ? ` · ${date(node.createdAt)}` : ''}` : NM)}
          {row('Updated', node.updatedBy ? `${node.updatedBy}${date(node.updatedAt) ? ` · ${date(node.updatedAt)}` : ''}` : NM)}
          {history.length ? <div style={{ marginTop: 4 }}>{history.map((h, i) => <div key={i} className="muted" style={{ fontSize: 11.5 }}>{h.action}{h.actor ? ` · ${h.actor}` : ''}{date(h.at) ? ` · ${date(h.at)}` : ''}</div>)}</div> : null}
          {sect('Navigation diagnostics')}
          {(node.usage?.attempts ?? 0) > 0 && (
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{node.usage.successRate != null ? `${node.usage.successRate}% success` : 'no observed outcomes yet'}</strong>
              <span className="muted"> · {node.usage.attempts} attempt{node.usage.attempts === 1 ? '' : 's'}{node.usage.observed ? ` (${node.usage.observed} observed${node.usage.observed - node.usage.succeeded > 0 ? `, ${node.usage.observed - node.usage.succeeded} failed` : ''})` : ''}{node.usage.lastAt ? ` · last ${new Date(node.usage.lastAt).toLocaleDateString()}` : ''}</span>
            </div>
          )}
          {attempts.length
            ? <div style={{ display: 'grid', gap: 2 }}>{attempts.map((a, i) => (
                <div key={i} style={{ fontSize: 11.5, display: 'flex', gap: 8 }}>
                  <span style={{ width: 52, flexShrink: 0, fontWeight: 700, color: a.ok === true ? '#16a34a' : a.ok === false ? '#dc2626' : '#94a3b8' }}>{a.ok === true ? 'ok' : a.ok === false ? 'failed' : 'emitted'}</span>
                  <span className="muted" style={{ width: 76, flexShrink: 0 }}>{a.source}</span>
                  <span className="muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.healedVia ? `self-heal: ${a.healedVia}` : (a.selector || a.url || '')}</span>
                  {date(a.at) ? <span className="muted" style={{ flexShrink: 0 }}>{date(a.at)}</span> : null}
                </div>))}</div>
            : <div className="muted" style={{ fontSize: 12 }}>No navigation attempts recorded yet — run a demo on this product (Ask / Reel / desktop drive) and attempts accrue here. Per-node success rates compute in the next phase.</div>}
          <div className="flex gap-2" style={{ marginTop: 12 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit node</button>
            <button className="btn btn-secondary btn-sm" disabled={busy === 'archive'} onClick={archive} style={{ color: '#dc2626' }}>{busy === 'archive' ? 'Archiving…' : 'Archive node'}</button>
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="banner banner-info" style={{ fontSize: 11.5 }}><Icon name="info" size={16} style={{ color: 'var(--color-blue)' }} /><div>Manual override is audited (graph_events). Setting status by hand marks the node <em>manually</em> verified — prefer “Run validation” to recon-check against the real site.</div></div>
          <label style={{ fontSize: 11, fontWeight: 700 }} className="muted">Screen name<input style={inp} value={f.screenName} onChange={(e) => setF({ ...f, screenName: e.target.value })} /></label>
          <div className="flex gap-2">
            <label style={{ fontSize: 11, fontWeight: 700, flex: 1 }} className="muted">Type<input style={inp} value={f.screenType} onChange={(e) => setF({ ...f, screenType: e.target.value })} placeholder="list · form · detail…" /></label>
            <label style={{ fontSize: 11, fontWeight: 700, flex: 1 }} className="muted">Route<input style={inp} value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })} placeholder="/approvals" /></label>
          </div>
          <label style={{ fontSize: 11, fontWeight: 700 }} className="muted">Business purpose<input style={inp} value={f.businessPurpose} onChange={(e) => setF({ ...f, businessPurpose: e.target.value })} placeholder="what this screen is for" /></label>
          <label style={{ fontSize: 11, fontWeight: 700 }} className="muted">Business outcome<input style={inp} value={f.businessOutcome} onChange={(e) => setF({ ...f, businessOutcome: e.target.value })} placeholder="the outcome it drives" /></label>
          <label style={{ fontSize: 11, fontWeight: 700 }} className="muted">Verification status
            <select style={inp} value={f.verificationStatus} onChange={(e) => setF({ ...f, verificationStatus: e.target.value })}>
              <option value="draft">draft</option><option value="pending_review">pending_review</option><option value="verified">verified</option><option value="broken">broken</option>
            </select></label>
          <label style={{ fontSize: 11, fontWeight: 700 }} className="muted">Selectors (locator_strategies, JSON array)<textarea style={{ ...inp, minHeight: 56, fontFamily: 'var(--font-mono, monospace)' }} value={f.locators} onChange={(e) => setF({ ...f, locators: e.target.value })} /></label>
          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button className="btn btn-primary btn-sm" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Navigation-Authority Readiness + Versions (V3.2 Phase 4) ── The governance dashboard: the constitution's
   promotion gates computed from REAL signals (the graph becomes the single nav authority only when all pass —
   the desktop driver stays DOM-controlled until then), plus the version history with audited rollback that
   shows its blast-radius first. */
function GraphGovernance({ p }: { p: any }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const ar = p.authorityReadiness as { gates: { name: string; ok: boolean; detail: string }[]; passed: number; total: number; ready: boolean } | null;
  const versions: any[] = Array.isArray(p.graphVersions) ? p.graphVersions : [];
  const active = versions.find((v) => v.status === 'active');
  const rollback = async (v: any) => {
    if (!window.confirm(`Roll back to v${v.version} (${v.nodes} node(s), ${v.workflows} workflow(s))?\n\nThis deactivates the current active graph${active ? ` (v${active.version})` : ''} and re-activates v${v.version} exactly as it was. Audited + reversible.`)) return;
    setBusy(v.id); setMsg(null);
    try { await graphMutate('rollback', { graphId: v.id }); setMsg(`Rolled back to v${v.version}.`); router.refresh(); }
    catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); } finally { setBusy(null); }
  };
  return (
    <div className="card card-pad section-gap">
      <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Navigation-authority readiness</div>
      <div className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>The gates that govern promoting this graph to the single navigation authority. Computed from real signals — the desktop driver stays DOM-controlled until all pass.</div>
      {ar ? <>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: ar.ready ? '#16a34a' : 'var(--text-primary)' }}>{ar.ready ? '✓ Ready' : `${ar.passed} of ${ar.total} gates met`}</div>
        <div style={{ display: 'grid', gap: 3 }}>{ar.gates.map((g, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'baseline' }}>
            <span style={{ width: 16, flexShrink: 0, color: g.ok ? '#16a34a' : '#dc2626', fontWeight: 800 }}>{g.ok ? '✓' : '✗'}</span>
            <span style={{ width: 188, flexShrink: 0, color: 'var(--text-primary)' }}>{g.name}</span>
            <span className="muted" style={{ flex: 1 }}>{g.detail}</span>
          </div>))}</div>
        {Array.isArray(p.graphDangling) && p.graphDangling.length > 0 && (
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.2)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#dc2626' }}>Dangling workflow references ({p.graphDangling.length})</div>
            <div className="muted" style={{ fontSize: 11.5, margin: '2px 0 6px' }}>These workflow steps point at a screen label with no matching node — correct the label (or add the node) in the Workflow Builder. (Orphan/unscripted screens are fine and not listed here — they’re reachable by intent.)</div>
            <div style={{ display: 'grid', gap: 2 }}>{p.graphDangling.slice(0, 25).map((d: any, i: number) => (
              <div key={i} style={{ fontSize: 12, fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>“{d.workflow}” → “{d.ref}” <span className="muted">· no matching node</span></div>
            ))}{p.graphDangling.length > 25 && <div className="muted" style={{ fontSize: 11.5 }}>…and {p.graphDangling.length - 25} more</div>}</div>
          </div>
        )}
      </> : <div className="empty">No active graph — nothing to assess.</div>}
      {versions.length > 0 && <>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '14px 0 4px' }}>Versions</div>
        <div style={{ display: 'grid', gap: 4 }}>{versions.map((v) => (
          <div key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', width: 34, flexShrink: 0 }}>v{v.version}</span>
            <span style={{ width: 88, flexShrink: 0, color: v.status === 'active' ? '#16a34a' : 'var(--text-secondary)', fontWeight: v.status === 'active' ? 700 : 400 }}>{v.status}</span>
            <span className="muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name} · {v.nodes} node(s) · {v.workflows} wf{v.coverage != null ? ` · ${Math.round(v.coverage * 100)}% cov` : ''}</span>
            {v.status !== 'active' && <button className="btn btn-secondary btn-sm" disabled={busy === v.id} onClick={() => rollback(v)}>{busy === v.id ? 'Rolling back…' : 'Roll back'}</button>}
          </div>))}</div>
      </>}
      {msg && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

/* ── Workflow Builder (0015) ── The human-authored layer over the machine-verified nodes. A workflow is a
   demo journey: an ordered path across the graph's screens, optionally tuned to an audience. APPROVED
   ("Live") journeys are what the consultant actually walks; unapproved ones are suggestions (autogen output
   or drafts) awaiting review. List → approve/edit/archive; "New workflow" authors one from scratch. */
function WorkflowSection({ p, states, selWf, setSelWf }: { p: any; states: any[]; selWf: string | null; setSelWf: (id: string | null) => void }) {
  const router = useRouter();
  const [form, setForm] = useState<any | null | undefined>(undefined); // undefined = closed, null = new, obj = edit
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [presenting, setPresenting] = useState<{ id: string; title: string } | null>(null);
  const workflows: any[] = Array.isArray(p.workflows) ? p.workflows : [];
  const canAuthor = !!p.activeGraphId && states.length > 0;

  const act = async (key: string, fn: () => Promise<any>, done: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg(done); router.refresh(); }
    catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); }
    finally { setBusy(null); }
  };

  if (form !== undefined) return <div className="section-gap"><WorkflowForm p={p} states={states} wf={form} onClose={() => setForm(undefined)} /></div>;

  return (
    <div className="section-gap">
      {presenting && <PresentPanel workflowId={presenting.id} title={`${p.name} — ${presenting.title}`} onClose={() => setPresenting(null)} />}
      <div className="flex between items-center" style={{ marginBottom: 10 }}>
        <div><div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Workflows</div><div className="muted" style={{ fontSize: 12 }}>The demo journeys the consultant walks for each audience. <strong>Live</strong> journeys are used in demos (click <strong>Present</strong> to run one); <strong>suggestions</strong> await your review.</div></div>
        {canAuthor ? <button className="btn btn-primary btn-sm" onClick={() => setForm(null)}><Icon name="plus" size={13} /> New workflow</button>
          : <span className="muted" style={{ fontSize: 12 }}>Publish a graph with screens to author workflows.</span>}
      </div>
      {msg && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{msg}</div>}
      {!workflows.length && <div className="empty">No workflows yet.{canAuthor ? ' Create one from scratch, or use “Discover from knowledge” to generate suggestions you can approve.' : ''}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {workflows.map((wf) => {
          const active = selWf === wf.id;
          return (
            <div key={wf.id} className="card card-pad" style={{ cursor: 'pointer', borderColor: active ? p.color : undefined, borderWidth: active ? 2 : 1 }} onClick={() => setSelWf(active ? null : wf.id)}>
              <div className="flex between items-center" style={{ marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{wf.name}</span>
                  {wf.approved ? <Pill kind="success" dot>Live</Pill> : <Pill kind="warn">Suggestion</Pill>}
                  <span style={{ fontSize: 11, color: nodeColor(wf.status), fontWeight: 700 }}>{wf.status}</span>
                </div>
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {wf.approved && <button className="btn btn-primary btn-sm" disabled={!!busy} title="Run this workflow as a guided live demo" onClick={() => setPresenting({ id: wf.id, title: wf.name })}><Icon name="play" size={12} /> Present</button>}
                  <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => act(`ap-${wf.id}`, () => graphMutate('workflow.approve', { workflowId: wf.id, approved: !wf.approved }), wf.approved ? 'Moved to suggestions.' : 'Now live — the consultant may walk it.')}>{busy === `ap-${wf.id}` ? '…' : wf.approved ? 'Unpublish' : 'Use in demos'}</button>
                  <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => setForm(wf)}><Icon name="edit" size={12} /> Edit</button>
                  <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => { if (confirm(`Archive workflow “${wf.name}”? (soft — recoverable)`)) act(`ar-${wf.id}`, () => graphMutate('workflow.archive', { workflowId: wf.id }), 'Archived.'); }}>Archive</button>
                </div>
              </div>
              {(wf.stakeholderType || wf.personaType) && <div className="flex gap-2" style={{ marginBottom: 6, flexWrap: 'wrap' }}>{wf.stakeholderType && <span className="tag">{wf.stakeholderType}</span>}{wf.personaType && <span className="tag">{wf.personaType}</span>}</div>}
              {wf.purpose && <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{wf.purpose}</div>}
              <div className="flex items-center gap-1" style={{ flexWrap: 'wrap', fontSize: 12 }}>
                {wf.sequence.length ? wf.sequence.map((s: string, i: number) => <span key={i} className="flex items-center gap-1"><span style={{ background: 'var(--app-surface-2)', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>{s}</span>{i < wf.sequence.length - 1 && <Icon name="chevR" size={12} style={{ color: 'var(--color-steel)' }} />}</span>) : <span className="muted">no screens — edit to lay out the journey</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Author / edit a workflow: name + audience + ordered screen sequence (pick from the graph's real screens,
   reorder, remove) + the editorial "use in demos" gate. Reuses graphMutate('workflow.create'|'update'). */
function WorkflowForm({ p, states, wf, onClose }: { p: any; states: any[]; wf: any | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(wf?.name ?? '');
  const [purpose, setPurpose] = useState(wf?.purpose ?? '');
  const [stake, setStake] = useState(wf?.stakeholderType ?? '');
  const [persona, setPersona] = useState(wf?.personaType ?? '');
  const [success, setSuccess] = useState(wf?.successCriteria ?? '');
  const [approved, setApproved] = useState(wf ? !!wf.approved : true);
  const [seq, setSeq] = useState<string[]>(Array.isArray(wf?.sequence) ? [...wf.sequence] : []);
  const [captions, setCaptions] = useState<Record<string, string>>(wf?.stepScript && typeof wf.stepScript === 'object' ? { ...wf.stepScript } : {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const editing = !!wf;
  const labels: string[] = states.map((s: any) => s.label);
  const statusByLabel = new Map(states.map((s: any) => [String(s.label).toLowerCase(), s.status]));

  const add = (l: string) => setSeq((q) => [...q, l]);
  const removeAt = (i: number) => setSeq((q) => q.filter((_, j) => j !== i));
  const move = (i: number, d: number) => setSeq((q) => { const j = i + d; if (j < 0 || j >= q.length) return q; const c = [...q]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (!seq.length) { setErr('Add at least one screen to the journey.'); return; }
    setBusy(true); setErr('');
    try {
      const data = { name: name.trim(), businessPurpose: purpose || null, stakeholderType: stake || null, personaType: persona || null, successCriteria: success || null, nodeSequence: seq, stepScript: Object.fromEntries(seq.map((l) => [l, (captions[l] ?? '').trim()]).filter(([, v]) => v)) };
      if (editing) await graphMutate('workflow.update', { workflowId: wf.id, data });
      else await graphMutate('workflow.create', { graphId: p.activeGraphId, data, approved });
      router.refresh(); onClose();
    } catch (e: any) { setErr(e?.message || 'Save failed'); setBusy(false); }
  };

  return (
    <FormShell title={editing ? `Edit workflow · ${wf.name}` : 'New workflow'} subtitle="A journey is an ordered path across this graph's real screens, optionally tuned to an audience. The consultant walks it when an approved journey matches the stakeholder." onClose={onClose} grid
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save workflow' : 'Create workflow'}</button></>}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CFO approval-delegation walkthrough" /></Field>
      <Field label="Business purpose"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What this journey proves" /></Field>
      <Field label="Stakeholder audience"><input value={stake} onChange={(e) => setStake(e.target.value)} placeholder="e.g. CFO, Procurement (optional)" /></Field>
      <Field label="Persona type"><input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="e.g. finance, executive (optional)" /></Field>
      <Field label="Success criteria" full><input value={success} onChange={(e) => setSuccess(e.target.value)} placeholder="How you know the journey landed (optional)" /></Field>
      <Field label="Journey — ordered screens" full>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {seq.length ? seq.map((l, i) => {
            const st = statusByLabel.get(l.toLowerCase());
            return (
              <div key={`${l}-${i}`} style={{ background: 'var(--app-surface-2)', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="flex between items-center">
                  <span className="flex items-center gap-2" style={{ fontSize: 13 }}><span style={{ width: 18, textAlign: 'right', color: 'var(--color-steel)' }}>{i + 1}.</span><i style={{ width: 7, height: 7, borderRadius: 99, background: nodeColor(st as string), display: 'inline-block' }} />{l}{st && st !== 'verified' && <span className="muted" style={{ fontSize: 11 }}>({st})</span>}</span>
                  <span className="flex gap-1">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === seq.length - 1}>↓</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeAt(i)}>✕</button>
                  </span>
                </div>
                <input value={captions[l] ?? ''} onChange={(e) => setCaptions((c) => ({ ...c, [l]: e.target.value }))} placeholder="what to show / say on this screen — the demo caption (optional)" style={{ fontSize: 12 }} />
              </div>
            );
          }) : <div className="muted" style={{ fontSize: 12 }}>No screens yet — add from the list below.</div>}
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="overline" style={{ marginBottom: 6 }}>Add a screen</div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {labels.map((l) => <button type="button" key={l} className="btn btn-secondary btn-sm" onClick={() => add(l)}><Icon name="plus" size={11} /> {l}</button>)}
          </div>
        </div>
      </Field>
      {!editing && <Field label="Use in demos" full><label className="flex items-center gap-2" style={{ fontSize: 13 }}><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> Approve now — the consultant may walk this journey. Leave unchecked to keep it as a suggestion.</label></Field>}
      {err && <div className="fld--full" style={{ color: 'var(--color-red)', fontSize: 12 }}>{err}</div>}
    </FormShell>
  );
}

/* ============================ ENVIRONMENTS ============================ */
export function Environments({ go }: { go: Go }) {
  const VD = useData();
  const [editing, setEditing] = useState<any | null | undefined>(undefined); // undefined=closed, null=new, obj=edit
  const [deleting, setDeleting] = useState<any | null>(null);
  const [room, setRoom] = useState<string | null>(null); // productId whose scripted demo room is being edited
  const busy = editing !== undefined || deleting || room;
  return (
    <div className="page scroll">
      <PageHead overline="Library" title="Environments"
        desc="The interaction layer points at an environment with seeded data and a reset mechanism. Demo (non-production) is the default; pointing at a production tenant is an explicit, visible choice."
        actions={!busy ? <button className="btn btn-primary" onClick={() => setEditing(null)}><Icon name="plus" size={14} /> New environment</button> : undefined} />
      {editing !== undefined ? <EnvForm env={editing} products={VD.products} onClose={() => setEditing(undefined)} />
        : deleting ? <ArchiveEnv env={deleting} onClose={() => setDeleting(null)} />
        : room ? <RoomEditor productId={room} onClose={() => setRoom(null)} />
        : <div className="grid cols-2">
            {VD.products.map((p) => <EnvCard key={p.id} p={p} onEdit={() => setEditing(p)} onArchive={() => setDeleting(p)} onEditRoom={() => setRoom(p.id)} />)}
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
  // V5 Phase 3 — execution-context fields (drive the readiness gate).
  const [cert, setCert] = useState(env?.certificationStatus ?? 'uncertified');
  const [verif, setVerif] = useState(env?.verificationState ?? '');
  const [seedVer, setSeedVer] = useState(env?.seedVersion ?? '');
  const [dataVer, setDataVer] = useState(env?.dataVersion ?? '');
  const [readiness, setReadiness] = useState(env?.readinessState ?? '');
  const [issues, setIssues] = useState(((env?.knownIssues ?? []) as any[]).map((k) => k.title).join('\n'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const editing = !!env?.envId;
  const save = async () => {
    if (!name.trim()) { setErr('Environment name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const knownIssues = issues.split('\n').map((t) => t.trim()).filter(Boolean).map((title) => ({ title }));
      const fields = { name: name.trim(), connection_target: url.trim(), reset_mechanism: reset.trim(), refresh_cadence: cadence.trim(), seed_dataset: { summary: seed.trim() }, is_production: isProd, default_mode: mode, certification_status: cert, verification_state: verif || null, seed_version: seedVer.trim() || null, data_version: dataVer.trim() || null, readiness_state: readiness.trim() || null, known_issues: knownIssues };
      if (editing) await adminMutate('environment', 'update', { id: env.envId, data: fields });
      else await adminMutate('environment', 'create', { data: { ...fields, product_id: productId } });
      onClose(); router.refresh();
    } catch (e: any) { setErr(e?.message || 'Save failed'); setBusy(false); }
  };
  return (
    <FormShell title={editing ? `Edit environment · ${env.env}` : 'New environment'} subtitle={editing ? env.name : undefined} onClose={onClose} grid
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save environment'}</button></>}>
      {!editing && <Field full label="Product"><select value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((p: any) => <option key={p.id} value={p.id}>{p.domain}</option>)}</select></Field>}
      <Field label="Environment name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="demo-04" /></Field>
      <Field label="Connection target (URL)"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://po.vin" /></Field>
      <Field full label="Seed dataset (description)"><input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="240 requests · 18 approvers · 6 vendors" /></Field>
      <Field label="Reset mechanism"><input value={reset} onChange={(e) => setReset(e.target.value)} placeholder="snapshot / script / manual" /></Field>
      <Field label="Refresh cadence"><input value={cadence} onChange={(e) => setCadence(e.target.value)} placeholder="Nightly + pre-session" /></Field>
      <Field label="Default mode"><select value={mode} onChange={(e) => setMode(e.target.value)}>{ENV_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
      <Field label="Production tenant?"><select value={isProd ? 'yes' : 'no'} onChange={(e) => setIsProd(e.target.value === 'yes')}><option value="no">No — demo/QA</option><option value="yes">Yes — production</option></select></Field>
      {isProd && <div className="modal__err fld--full" style={{ color: 'var(--color-amber, #9a6b1a)' }}>Production tenant — real data. The agent stays read-only unless explicitly raised.</div>}
      {/* V5 Phase 3 — execution context: certification + verification + versions + known issues drive the readiness gate. */}
      <Field label="Certification"><select value={cert} onChange={(e) => setCert(e.target.value)}>{['uncertified', 'in_review', 'certified'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
      <Field label="Verification state"><select value={verif} onChange={(e) => setVerif(e.target.value)}><option value="">— unverified —</option>{['verified', 'stale'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
      <Field label="Seed version"><input value={seedVer} onChange={(e) => setSeedVer(e.target.value)} placeholder="2026-06 seed" /></Field>
      <Field label="Data version"><input value={dataVer} onChange={(e) => setDataVer(e.target.value)} placeholder="v3 dataset" /></Field>
      <Field label="Readiness state"><input value={readiness} onChange={(e) => setReadiness(e.target.value)} placeholder="ready / staging / degraded" /></Field>
      <Field full label="Known issues (one per line)"><textarea rows={2} value={issues} onChange={(e) => setIssues(e.target.value)} placeholder="Receipt upload flaky on Safari" /></Field>
      {err && <div className="modal__err fld--full">{err}</div>}
    </FormShell>
  );
}

function ArchiveEnv({ env, onClose }: { env: any; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { await adminMutate('environment', 'archive', { id: env.envId }); onClose(); router.refresh(); }
    catch (e: any) { setErr(e?.message || 'Archive failed'); setBusy(false); }
  };
  return (
    <FormShell title="Archive environment" width={420} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'Archiving…' : 'Archive'}</button></>}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-primary)' }}>Archive the <b>{env.env}</b> environment for <b>{env.name}</b>? The product keeps its session history; the environment stops being routed to until restored.</p>
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
  const router = useRouter();
  const [mode, setMode] = useState<string>(p.defaultMode ?? 'read-only');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const change = async (m: string) => {
    setMode(m); setSaving('saving');
    try {
      const res = await fetch('/api/console/product-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: p.id, mode: m }) });
      setSaving(res.ok ? 'saved' : 'error');
      if (res.ok) router.refresh(); // re-read so the Safety per-site table reflects the saved mode too
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

function EnvCard({ p, onEdit, onArchive, onEditRoom }: { p: any; onEdit?: () => void; onArchive?: () => void; onEditRoom?: () => void }) {
  const configured = p.envStatus === 'Configured';
  return (
    <div className="card">
      <div className="card-hd">
        <div className="flex items-center gap-3"><span style={{ width: 30, height: 30, borderRadius: 7, background: p.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12 }}>{p.mk}</span><div><div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 14 }} className="mono">{p.env}</div><div className="muted" style={{ fontSize: 11.5 }}>{p.name}</div></div></div>
        {configured ? <Pill kind="success" dot>Configured</Pill> : <Pill kind="warn" dot>No endpoint</Pill>}
      </div>
      <div className="card-pad">
        <dl className="kv">
          <dt>Routing</dt><dd>{p.isProduction ? <Pill kind="warn" dot>Production tenant</Pill> : <Pill kind="info">Demo only</Pill>}</dd>
          <dt>URL</dt><dd className="mono" style={{ fontSize: 12 }}>{p.connectionTarget || '—'}</dd>
          <dt>Default mode</dt><dd><ModeSelect p={p} /></dd>
          <dt>Seed dataset</dt><dd>{p.seedDataset || '—'}</dd>
          <dt>Reset mechanism</dt><dd>{p.resetMechanism || '—'}</dd>
          <dt>Created</dt><dd>{p.lastReset}</dd>
          <dt>Refresh cadence</dt><dd>{p.refreshCadence || '—'}</dd>
        </dl>
        {/* V5 Phase 3 — execution-context readiness gate (computed from real fields) + known issues. */}
        {p.envReadiness && (
          <div style={{ marginTop: 12 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Readiness</span>
              {p.envReadiness.ready ? <Pill kind="success" dot>Ready · {p.envReadiness.passed}/{p.envReadiness.total}</Pill> : <Pill kind="warn">{p.envReadiness.passed}/{p.envReadiness.total} gates</Pill>}
              <Pill kind={p.certificationStatus === 'certified' ? 'success' : 'neutral'}>{p.certificationStatus}</Pill>
            </div>
            <div className="flex" style={{ flexWrap: 'wrap', gap: 4 }}>
              {p.envReadiness.gates.map((g: any) => <span key={g.name} title={g.detail} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, background: g.ok ? 'rgba(0,125,97,.12)' : 'rgba(192,57,43,.10)', color: g.ok ? '#0a7d61' : '#c0392b' }}>{g.ok ? '✓' : '✗'} {g.name}</span>)}
            </div>
            {p.knownIssues && p.knownIssues.length > 0 && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Known issues: {p.knownIssues.map((k: any) => k.title).join(' · ')}</div>
            )}
          </div>
        )}
        {p.room && (
          <div style={{ marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Scripted demo room {onEditRoom && <span style={{ textTransform: 'none', letterSpacing: 0 }}>· addressed by name in the reel; live demos address only the operator</span>}</div>
            {p.room.length
              ? <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>{p.room.map((m: any) => <Pill key={m.id} kind="info">{m.name}{m.role ? ` · ${m.role}` : ''}</Pill>)}</div>
              : <div className="muted" style={{ fontSize: 12 }}>None defined — the reel falls back to defaults (Dana · Morgan).</div>}
          </div>
        )}
        {(onEdit || onArchive || onEditRoom) && (
          <div className="flex gap-2" style={{ marginTop: 16, flexWrap: 'wrap' }}>
            {onEdit && <button className="btn btn-secondary btn-sm" onClick={onEdit}><Icon name="edit" size={13} /> Edit</button>}
            {onEditRoom && <button className="btn btn-secondary btn-sm" onClick={onEditRoom}><Icon name="edit" size={13} /> Edit room</button>}
            {p.connectionTarget && <a className="btn btn-ghost btn-sm" href={p.connectionTarget} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Open env</a>}
            {p.envId && onArchive && <button className="btn btn-ghost btn-sm" onClick={onArchive}><Icon name="archive" size={13} /> Archive</button>}
          </div>
        )}
      </div>
    </div>
  );
}
export function EnvironmentInner({ p }: { p: any }) { return <div style={{ maxWidth: 560 }}><EnvCard p={p} /></div>; }

const ROOM_INFLUENCE = ['low', 'medium', 'high'];
const ROOM_RISK = ['low', 'medium', 'high'];
const ROOM_AUTHORITY = ['decision_maker', 'approver', 'champion', 'influencer', 'evaluator'];
/* Per-product SCRIPTED demo-room editor. Defines the named people the reel/convo address (a Finance
   Controller for expense.vin, a CE Director for ce.vin, …) — so the scripted demo is tailored, not generic
   Dana/Morgan-for-everything. LIVE interactive/voice sessions seed NO room (the operator is the only real
   person), so the AI never addresses someone who isn't there. CRUD via the generic 'product_stakeholder'
   admin entity; reads the live roster from useData() so the list updates in place after each change. */
function RoomEditor({ productId, onClose }: { productId: string; onClose: () => void }) {
  const VD = useData();
  const router = useRouter();
  const p: any = VD.products.find((x: any) => x.id === productId);
  const room: any[] = p?.room ?? [];
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [interests, setInterests] = useState('');
  const [influence, setInfluence] = useState('medium');
  const [risk, setRisk] = useState('low');
  const [authority, setAuthority] = useState('influencer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const add = async () => {
    if (!name.trim()) { setErr('Name is required.'); return; }
    setBusy(true); setErr('');
    try {
      await adminMutate('product_stakeholder', 'create', { data: {
        product_id: productId, name: name.trim(), role: role.trim(),
        interests: commaToArr(interests), influence, risk_level: risk, decision_authority: authority, sort_order: room.length,
      } });
      setName(''); setRole(''); setInterests(''); router.refresh();
    } catch (e: any) { setErr(e?.message || 'Add failed'); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true); setErr('');
    try { await adminMutate('product_stakeholder', 'archive', { id }); router.refresh(); }
    catch (e: any) { setErr(e?.message || 'Remove failed'); } finally { setBusy(false); }
  };
  return (
    <FormShell title={`Scripted demo room · ${p?.domain ?? ''}`} grid onClose={onClose}
      subtitle="The named people the reel & scripted demos address. Live interactive/voice demos seed no room — the AI speaks only to the operator who is actually there."
      footer={<button className="btn btn-primary" onClick={onClose} disabled={busy}>Done</button>}>
      <div className="fld--full">
        {room.length === 0
          ? <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No people yet — until you add some, the reel falls back to the built-in defaults (Dana · Procurement Manager, Morgan · CFO).</div>
          : room.map((m) => (
            <div key={m.id} className="flex items-center justify-between" style={{ padding: '8px 10px', border: '1px solid var(--line, #d4dae3)', borderRadius: 8, marginBottom: 6 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{m.name}{m.role && <span className="muted" style={{ fontWeight: 400 }}> · {m.role}</span>}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{[m.decisionAuthority ? String(m.decisionAuthority).replace(/_/g, ' ') : '', m.influence ? `${m.influence} influence` : '', m.riskLevel ? `${m.riskLevel} risk` : '', m.interests?.length ? `cares about ${m.interests.join(', ')}` : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(m.id)} disabled={busy}><Icon name="archive" size={13} /> Remove</button>
            </div>
          ))}
      </div>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" /></Field>
      <Field label="Role"><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Finance Controller" /></Field>
      <Field full label="Cares about (comma-separated)"><input value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="spend control, audit trail" /></Field>
      <Field label="Influence"><select value={influence} onChange={(e) => setInfluence(e.target.value)}>{ROOM_INFLUENCE.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
      <Field label="Risk level"><select value={risk} onChange={(e) => setRisk(e.target.value)}>{ROOM_RISK.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
      <Field full label="Decision authority"><select value={authority} onChange={(e) => setAuthority(e.target.value)}>{ROOM_AUTHORITY.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></Field>
      <div className="fld--full"><button className="btn btn-secondary btn-sm" onClick={add} disabled={busy}>{busy ? 'Adding…' : '+ Add person'}</button></div>
      {err && <div className="modal__err fld--full">{err}</div>}
    </FormShell>
  );
}

/* ============================ PERSONAS ============================ */
const PERSONA_STATUS = ['draft', 'review', 'approved', 'retired'];
const PARTICIPATION_MODES = ['passive', 'reactive', 'collaborative', 'proactive'];
const linesToArr = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const commaToArr = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
// Objection playbook ⇄ text: one line per objection as `objection :: response1 | response2`.
const objToText = (o: any[]) => (o ?? []).map((x) => `${x.objection} :: ${(x.response ?? []).join(' | ')}`).join('\n');
const textToObj = (s: string) => linesToArr(s).map((l) => { const [obj, resp] = l.split('::'); return { objection: (obj ?? '').trim(), response: (resp ?? '').split('|').map((r) => r.trim()).filter(Boolean) }; }).filter((x) => x.objection);
// Hand-off conditions ⇄ text: one line per condition as `topic -> Persona Name`.
const hoToText = (h: any[]) => (h ?? []).map((x) => `${x.topic} -> ${x.toPersona}`).join('\n');
const textToHo = (s: string) => linesToArr(s).map((l) => { const [t, p] = l.split('->'); return { topic: (t ?? '').trim(), toPersona: (p ?? '').trim() }; }).filter((x) => x.topic && x.toPersona);
// Governance rules ⇄ text: one line per rule as `category :: restriction :: action(escalate|block|warn)`.
const CITATION_POLICIES = ['always', 'when_uncertain', 'never'];
const RULE_ACTIONS = ['escalate', 'block', 'warn'];
const govToText = (g: any[]) => (g ?? []).map((x) => `${x.category} :: ${x.restriction} :: ${x.action}`).join('\n');
const textToGov = (s: string) => linesToArr(s).map((l) => { const [c, r, a] = l.split('::').map((x) => (x ?? '').trim()); return { category: c, restriction: r ?? '', action: RULE_ACTIONS.includes(a) ? a : 'escalate' }; }).filter((x) => x.category);
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
  const [allowed, setAllowed] = useState((persona?.allowedActions ?? []).join(', '));
  const [prohibited, setProhibited] = useState((persona?.prohibitedActions ?? []).join(', '));
  const [escalation, setEscalation] = useState((persona?.escalationRules ?? []).join('\n'));
  const [confidence, setConfidence] = useState<number>(persona?.confidenceThreshold ?? 0.7);
  const [voiceId, setVoiceId] = useState(persona?.voiceProfileId ?? '');
  const [sites, setSites] = useState<string[]>(persona?.productIds ?? []);
  // ── Human-level layers (cognition · interaction · relationships) ──
  const [mentalModels, setMentalModels] = useState((persona?.mentalModels ?? []).join(', '));
  const [traits, setTraits] = useState((persona?.traits ?? []).join(', '));
  const [strategy, setStrategy] = useState((persona?.conversationStrategy ?? []).join('\n'));
  const cs = persona?.communicationStyle ?? {};
  const [tone, setTone] = useState(cs.tone ?? '');
  const [verbosity, setVerbosity] = useState(cs.verbosity ?? 'balanced');
  const [techDepth, setTechDepth] = useState(cs.technicalDepth ?? 'medium');
  const [questionFreq, setQuestionFreq] = useState(cs.questionFrequency ?? 'medium');
  const [storytelling, setStorytelling] = useState<boolean>(cs.storytelling ?? false);
  const [challenge, setChallenge] = useState<boolean>(cs.challengeAssumptions ?? false);
  const [teaching, setTeaching] = useState(cs.teachingStyle ?? 'direct');
  const [framework, setFramework] = useState((persona?.decisionFramework ?? []).join(', '));
  const [objections, setObjections] = useState(objToText(persona?.objectionPlaybook ?? []));
  const [knowledge, setKnowledge] = useState((persona?.knowledgePriority ?? []).join('\n'));
  const [participation, setParticipation] = useState(persona?.participationMode ?? 'reactive');
  const [handoffs, setHandoffs] = useState(hoToText(persona?.handoffConditions ?? []));
  // ── Governance ──
  const [owner, setOwner] = useState(persona?.owner ?? '');
  const [approver, setApprover] = useState(persona?.approver ?? '');
  const [citationPolicy, setCitationPolicy] = useState(persona?.citationPolicy ?? 'when_uncertain');
  const [govRules, setGovRules] = useState(govToText(persona?.governanceRules ?? []));
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
        allowedActions: commaToArr(allowed),
        prohibitedActions: commaToArr(prohibited), escalationRules: linesToArr(escalation),
        confidenceThreshold: Number(confidence) || 0.7, voiceProfileId: voiceId.trim() || null,
        productIds: sites,
        // Human-level layers — saved into the same jsonb the engine reads as the specialist "brain".
        mentalModels: commaToArr(mentalModels),
        traits: commaToArr(traits),
        conversationStrategy: linesToArr(strategy),
        communicationStyle: { tone: tone.trim(), verbosity, technicalDepth: techDepth, questionFrequency: questionFreq, storytelling, challengeAssumptions: challenge, teachingStyle: teaching.trim() || 'direct' },
        decisionFramework: commaToArr(framework),
        objectionPlaybook: textToObj(objections),
        knowledgePriority: linesToArr(knowledge),
        participationMode: participation,
        handoffConditions: textToHo(handoffs),
        confidencePolicy: persona?.confidencePolicy ?? null,
        // Governance (behavior + knowledge) lives in jsonb; identity (owner/approver) are real columns below.
        citationPolicy,
        governanceRules: textToGov(govRules),
      };
      const data = { name: name.trim(), status, owner: owner.trim(), approver: approver.trim(), definition };
      if (persona?.id) await adminMutate('persona', 'update', { id: persona.id, data });
      else await adminMutate('persona', 'create', { data });
      onClose(); router.refresh();
    } catch (e: any) { setErr(e?.message || 'Save failed'); setBusy(false); }
  };
  return (
    <FormShell title={persona ? `Edit ${persona.name}` : 'New specialist persona'} onClose={onClose} grid
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save persona'}</button></>}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Integration Engineer" /></Field>
      <Field label="Role"><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Integration Engineer" /></Field>
      <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}>{PERSONA_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
      <Field label="Color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ padding: 3, height: 38, width: '100%' }} /></Field>
      <Field full label="System prompt — the runtime overlay the AI adopts when handed off to"><textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} style={{ minHeight: 130 }} placeholder="You are the Integration Engineer. Focus on APIs, SSO, SCIM… Do not promise roadmap or custom development. When uncertain, cite documentation." /></Field>
      <Field full label="Scope (what this specialist covers)"><textarea value={scope} onChange={(e) => setScope(e.target.value)} placeholder="APIs, SSO, SCIM, ERP, webhooks, data flows" /></Field>
      <Field full label="Hard guardrails (one per line — never violated)"><textarea value={guardrails} onChange={(e) => setGuardrails(e.target.value)} placeholder={'Do not promise future integrations\nDo not promise custom development\nWhen uncertain, cite documentation'} /></Field>
      <Field full label="Escalation rules (one per line)"><textarea value={escalation} onChange={(e) => setEscalation(e.target.value)} placeholder={'Roadmap questions → lead consultant\nContractual terms → procurement'} /></Field>
      <Field label="Expertise domains (comma)"><input value={expertise} onChange={(e) => setExpertise(e.target.value)} placeholder="APIs, Identity, Data exchange" /></Field>
      <Field label="Allowed actions (comma)"><input value={allowed} onChange={(e) => setAllowed(e.target.value)} placeholder="navigate, explain" /></Field>
      <Field label="Prohibited actions (comma)"><input value={prohibited} onChange={(e) => setProhibited(e.target.value)} placeholder="submit, pay, delete" /></Field>
      <Field label="Confidence threshold (0–1)"><input type="number" min={0} max={1} step={0.05} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} /></Field>
      <Field label="Voice profile id (optional)"><input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} placeholder="consultant-f / executive-m …" /></Field>

      <div className="fld--full overline" style={{ marginTop: 6, color: 'var(--color-steel)', borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>Specialist behavior — cognition · communication · decisions</div>
      <Field label="Mental models (comma — how it thinks)"><input value={mentalModels} onChange={(e) => setMentalModels(e.target.value)} placeholder="systems_thinking, dependency_analysis, standards_first" /></Field>
      <Field label="Traits (comma — who it is)"><input value={traits} onChange={(e) => setTraits(e.target.value)} placeholder="analytical, precise, pragmatic" /></Field>
      <Field label="Participation mode"><select value={participation} onChange={(e) => setParticipation(e.target.value)}>{PARTICIPATION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
      <Field label="Decision framework (comma, ordered)"><input value={framework} onChange={(e) => setFramework(e.target.value)} placeholder="standards_fit, reliability, maintainability, security" /></Field>
      <Field full label="Conversation strategy (one ordered step per line)"><textarea value={strategy} onChange={(e) => setStrategy(e.target.value)} placeholder={'clarify systems involved\nidentify integration pattern\nexplain options\ndiscuss tradeoffs\nrecommend approach'} /></Field>
      <Field label="Tone"><input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="analytical / strategic / consultative" /></Field>
      <Field label="Verbosity"><select value={verbosity} onChange={(e) => setVerbosity(e.target.value)}>{['concise', 'balanced', 'detailed'].map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
      <Field label="Technical depth"><select value={techDepth} onChange={(e) => setTechDepth(e.target.value)}>{['low', 'medium', 'high'].map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
      <Field label="Question frequency"><select value={questionFreq} onChange={(e) => setQuestionFreq(e.target.value)}>{['low', 'medium', 'high'].map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
      <Field label="Storytelling"><select value={storytelling ? 'yes' : 'no'} onChange={(e) => setStorytelling(e.target.value === 'yes')}><option value="no">off</option><option value="yes">on</option></select></Field>
      <Field label="Challenge assumptions"><select value={challenge ? 'yes' : 'no'} onChange={(e) => setChallenge(e.target.value === 'yes')}><option value="no">no</option><option value="yes">yes</option></select></Field>
      <Field label="Teaching style"><input value={teaching} onChange={(e) => setTeaching(e.target.value)} placeholder="direct / socratic / example-led" /></Field>
      <Field full label="Knowledge priority (one source class per line, ordered — re-ranks retrieval)"><textarea value={knowledge} onChange={(e) => setKnowledge(e.target.value)} placeholder={'Product Documentation\nAPI Specifications\nIntegration Guides\nRelease Notes\nMarketing Content'} /></Field>
      <Field full label="Objection playbook (one per line — `objection :: response1 | response2`)"><textarea value={objections} onChange={(e) => setObjections(e.target.value)} style={{ minHeight: 90 }} placeholder={'Too expensive :: roi | payback_period | cost_avoidance\nWill it integrate? :: clarify systems | map to API/SSO | note limits'} /></Field>
      <Field full label="Hand-off conditions (one per line — `topic -> Persona Name`)"><textarea value={handoffs} onChange={(e) => setHandoffs(e.target.value)} placeholder={'security -> Security Specialist\npricing -> Accounting Specialist\ncompliance -> Audit & Compliance Specialist'} /></Field>

      <div className="fld--full overline" style={{ marginTop: 6, color: 'var(--color-steel)', borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>Governance — identity · knowledge · behavior</div>
      <Field label="Owner (identity governance)"><input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. RevOps" /></Field>
      <Field label="Approver"><input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="e.g. Security Lead" /></Field>
      <Field label="Version / approved"><input value={persona ? `v${persona.version ?? 1}${persona.approvalDate ? ` · ${persona.approvalDate}` : ''}` : 'v1 · on approval'} readOnly disabled style={{ opacity: .7 }} /></Field>
      <Field label="Citation policy (knowledge governance)"><select value={citationPolicy} onChange={(e) => setCitationPolicy(e.target.value)}>{CITATION_POLICIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
      <Field full label="Structured guardrails (machine-enforced — `category :: restriction :: action`; action = escalate | block | warn)"><textarea value={govRules} onChange={(e) => setGovRules(e.target.value)} style={{ minHeight: 90 }} placeholder={'pricing :: no_binding_quotes :: escalate\nsecurity_guarantee :: no_security_guarantees :: block\nroadmap :: no_roadmap_promises :: escalate'} /></Field>

      <Field full label="Assigned sites (none = available on every product)">
        <div className="persona-sites">
          {VD.products.map((p) => (
            <label key={p.id} className={`persona-site ${sites.includes(p.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={sites.includes(p.id)} onChange={() => toggleSite(p.id)} />
              <span className="persona-site__mk" style={{ background: p.color }}>{p.mk}</span>{p.domain}
            </label>
          ))}
        </div>
      </Field>
      {status !== 'approved' && <div className="modal__err fld--full" style={{ color: 'var(--color-amber, #9a6b1a)' }}>Only <b>approved</b> personas can be handed off to in a live demo.</div>}
      {err && <div className="modal__err fld--full">{err}</div>}
    </FormShell>
  );
}

function ArchivePersona({ persona, onClose }: { persona: any; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { await adminMutate('persona', 'archive', { id: persona.id }); onClose(); router.refresh(); }
    catch (e: any) { setErr(e?.message || 'Archive failed'); setBusy(false); }
  };
  return (
    <FormShell title="Archive persona" onClose={onClose} width={400}
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'Archiving…' : 'Archive'}</button></>}>
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>Archive <b>{persona.name}</b>? It stops being available for hand-off but its history is kept and it can be restored from the Archived filter.</p>
      {err && <div className="modal__err">{err}</div>}
    </FormShell>
  );
}

const ARCHIVE_FILTERS: ['active' | 'archived' | 'all', string][] = [['active', 'Active'], ['archived', 'Archived'], ['all', 'All']];
/* Tri-state Active / Archived / All pills shared by every archivable list. */
export function ArchiveFilter({ value, onChange, counts }: { value: string; onChange: (v: 'active' | 'archived' | 'all') => void; counts: { active: number; archived: number; all: number } }) {
  return (
    <div className="flex gap-2" style={{ marginBottom: 14 }}>
      {ARCHIVE_FILTERS.map(([id, lbl]) => (
        <button key={id} className={`btn btn-sm ${value === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => onChange(id)}>{lbl} <span style={{ opacity: .7 }}>{counts[id]}</span></button>
      ))}
    </div>
  );
}

export function Personas({ go }: { go: Go }) {
  const VD = useData();
  const [editing, setEditing] = useState<any | null | undefined>(undefined); // undefined = closed, null = new, object = edit
  const [archiving, setArchiving] = useState<any | null>(null);
  const [view, setView] = useState<'active' | 'archived' | 'all'>('active');
  const router = useRouter();
  const counts = { active: VD.personas.filter((p) => !p.archived).length, archived: VD.personas.filter((p) => p.archived).length, all: VD.personas.length };
  const shown = VD.personas.filter((p) => view === 'all' ? true : view === 'archived' ? p.archived : !p.archived);
  const unarchive = async (id: string) => { await adminMutate('persona', 'unarchive', { id }); router.refresh(); };
  const open = editing !== undefined || archiving;
  return (
    <div className="page scroll">
      <PageHead overline="Library" title="Personas"
        desc="Delegated specialists the consultant can hand off to mid-demo for deep questions. Each has a defined scope and brand / legal limits — they cite docs and never over-commit."
        actions={!open ? <button className="btn btn-primary" onClick={() => setEditing(null)}><Icon name="plus" size={14} /> New persona</button> : undefined} />
      {editing !== undefined ? <PersonaForm persona={editing} onClose={() => setEditing(undefined)} />
        : archiving ? <ArchivePersona persona={archiving} onClose={() => setArchiving(null)} />
        : <>
        <ArchiveFilter value={view} onChange={setView} counts={counts} />
        <div className="grid cols-3">
        {shown.map((p) => (
          <div key={p.id} className="card card-pad" style={p.archived ? { opacity: .68 } : undefined}>
            <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
              <span className="avatar-sm" style={{ width: 40, height: 40, fontSize: 14, background: p.color }}>{p.name.split(' ').map((w) => w[0]).join('')}</span>
              <div><div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{p.name}{p.lead ? ' · default' : ''}</div>{p.archived ? <Pill kind="steel" dot>Archived</Pill> : <Pill kind={p.status === 'approved' ? 'success' : p.status === 'retired' ? 'steel' : 'warn'} dot>{p.status}</Pill>}</div>
            </div>
            <div className="overline" style={{ marginBottom: 5 }}>Scope</div>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 14px', lineHeight: 1.5 }}>{p.scope}</p>
            <div className="overline" style={{ marginBottom: 5 }}>Limits</div>
            <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5, color: 'var(--color-amber)', display: 'flex', gap: 7 }}><Icon name="lock" size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {p.limits}</p>
            {/* V5 Phase 3 — REAL specialist-network metrics rolled up from event tables (telemetry-gated). */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 14, fontSize: 12 }}>
              <div className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Network activity</div>
              {(p.metrics && (p.metrics.turns || p.metrics.handoffsIn || p.metrics.handoffsOut || p.metrics.escalations)) ? (
                <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <Pill kind="info">{p.metrics.turns} turns</Pill>
                  <Pill kind="steel">↧{p.metrics.handoffsIn} ↥{p.metrics.handoffsOut} hand-offs</Pill>
                  {p.metrics.escalations > 0 && <Pill kind="warn">{p.metrics.escalations} escalations</Pill>}
                </div>
              ) : <span className="muted">Not yet observed</span>}
              {p.metrics && p.metrics.journeys > 0 && <div className="muted" style={{ marginTop: 6 }}>Participates in {p.metrics.journeys} journey{p.metrics.journeys === 1 ? '' : 's'}</div>}
            </div>
            <div className="card-actions">
              {p.archived ? (
                <button className="btn btn-secondary btn-sm" onClick={() => unarchive(p.id)}><Icon name="refresh" size={12} /> Unarchive</button>
              ) : (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(p)}><Icon name="edit" size={12} /> Edit</button>
                  {!p.lead && <button className="btn btn-ghost btn-sm" onClick={() => setArchiving(p)}><Icon name="archive" size={12} /> Archive</button>}
                </>
              )}
            </div>
          </div>
        ))}
        {!shown.length && <div className="empty">No {view === 'archived' ? 'archived' : view === 'active' ? 'active' : ''} personas.</div>}
      </div></>}
    </div>
  );
}
