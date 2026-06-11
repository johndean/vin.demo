'use client';
/* VIN Demo console — AI observability (migration 0027). AI Conversation History: every LLM call's PROMPT →
   REPLY, captured live by the engine, GROUPED BY CONVERSATION (demo session) and filterable by product /
   demo / date / function. This is exactly "how the AI is being led" — the system prompt it's given, the
   user/context, and the model's reply, per function. Read-only (the editable defaults live on AI Prompts). */
import { useState, useMemo, useEffect } from 'react';
import { useData } from './data-context';
import { PageHead, Pill, type Go } from './shell';
import type { AiCallRow } from './data';
import { aiConfigGet, aiConfigMutate, type AiPromptRow, type AiModelInfo } from './admin';

const FN_LABEL: Record<string, string> = {
  interpret: 'Interpret', pickNode: 'Navigate', explainWhy: 'Explain', agentStep: 'Drive', answerAs: 'Answer',
  narrate: 'Narrate', discover: 'Discover', harvestChunks: 'Harvest', verifyFaithful: 'Verify',
  deriveScreens: 'Derive · screens', deriveWorkflows: 'Derive · workflows', deriveScreenElements: 'Derive · elements', llm: 'LLM',
};
const fmt = (iso: string) => { try { return iso ? new Date(iso).toLocaleString() : ''; } catch { return iso; } };

export function AiHistory({ go }: { go?: Go }) {
  const data = useData();
  const calls = data.aiCalls ?? [];
  const [product, setProduct] = useState('');
  const [demo, setDemo] = useState('');
  const [fn, setFn] = useState('');
  const [day, setDay] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const products = Array.from(new Set(calls.map((c) => c.product).filter(Boolean))).sort();
  const demos = Array.from(new Set(calls.map((c) => c.demo).filter(Boolean))).sort();
  const fns = Array.from(new Set(calls.map((c) => c.fn))).sort();
  const days = Array.from(new Set(calls.map((c) => (c.at || '').slice(0, 10)).filter(Boolean))).sort().reverse();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return calls.filter((c) =>
      (!product || c.product === product) && (!demo || c.demo === demo) && (!fn || c.fn === fn) &&
      (!day || (c.at || '').slice(0, 10) === day) &&
      (!needle || `${c.systemPrompt} ${c.userPrompt} ${c.reply} ${c.fn}`.toLowerCase().includes(needle)));
  }, [calls, product, demo, fn, day, q]);

  // Group by CONVERSATION (demo session). Calls within a conversation run oldest→newest; conversations sort
  // by most-recent activity. Calls with no session land in one "Ad-hoc / no session" group.
  const groups = useMemo(() => {
    const m = new Map<string, AiCallRow[]>();
    for (const c of filtered) { const k = c.sessionId || '(none)'; const a = m.get(k); if (a) a.push(c); else m.set(k, [c]); }
    const arr = Array.from(m.entries()).map(([sid, cs]) => {
      const sorted = [...cs].sort((a, b) => (a.at || '').localeCompare(b.at || ''));
      const last = sorted[sorted.length - 1];
      return { sid, calls: sorted, product: last.product, demo: last.demo, mode: last.mode, start: sorted[0].at, end: last.at, count: sorted.length };
    });
    arr.sort((a, b) => (b.end || '').localeCompare(a.end || ''));
    return arr;
  }, [filtered]);

  const reset = () => { setProduct(''); setDemo(''); setFn(''); setDay(''); setQ(''); };
  const sel: React.CSSProperties = { padding: '6px 9px', border: '1px solid var(--border-subtle,#d8dde6)', borderRadius: 8, fontSize: 13 };

  return (
    <div className="page scroll">
      <PageHead overline="Operations" title="AI Conversation History" go={go}
        desc="Every prompt the AI is given and the reply it returns — grouped by conversation (demo session). This is exactly how the AI is being led: the system prompt sent, the user/context, and the model's answer, per function." />

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={product} onChange={(e) => setProduct(e.target.value)} style={sel}><option value="">All products</option>{products.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <select value={demo} onChange={(e) => setDemo(e.target.value)} style={sel}><option value="">All demos</option>{demos.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <select value={fn} onChange={(e) => setFn(e.target.value)} style={sel}><option value="">All functions</option>{fns.map((f) => <option key={f} value={f}>{FN_LABEL[f] ?? f}</option>)}</select>
          <select value={day} onChange={(e) => setDay(e.target.value)} style={sel}><option value="">All dates</option>{days.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompt / reply…" style={{ ...sel, flex: '0 1 240px' }} />
          <button className="btn btn-secondary btn-sm" onClick={reset}>View all</button>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>{groups.length} conversation{groups.length === 1 ? '' : 's'} · {filtered.length} call{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {calls.length === 0
        ? <div className="card card-pad muted">No AI calls captured yet. Run a live demo (a journey walk, Ask, or Talk) and every prompt → reply will appear here.</div>
        : groups.length === 0
          ? <div className="card card-pad muted">No calls match these filters. <button className="btn btn-secondary btn-sm" onClick={reset}>View all</button></div>
          : groups.map((g) => (
              <div key={g.sid} className="card" style={{ marginBottom: 12 }}>
                <div className="card-hd flex between items-center">
                  <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <span className="cell-strong">{g.product || 'Ad-hoc'}</span>
                    {g.demo ? <Pill kind="info">{g.demo}</Pill> : null}
                    {g.mode ? <Pill kind={g.mode === 'execution' ? 'warn' : 'neutral'}>{g.mode}</Pill> : null}
                    <span className="muted" style={{ fontSize: 12 }}>{fmt(g.start)}</span>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>{g.count} call{g.count === 1 ? '' : 's'}</span>
                </div>
                <div className="card-pad" style={{ padding: '4px 10px' }}>
                  {g.calls.map((c) => (
                    <div key={c.id} className="exp-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div className="flex items-center gap-2" style={{ flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}>
                        <Pill kind="neutral">{FN_LABEL[c.fn] ?? c.fn}</Pill>
                        <span className="muted tnum" style={{ fontSize: 11 }}>{fmt(c.at)}</span>
                        <span className="muted" style={{ fontSize: 11 }}>{c.inTokens + c.outTokens} tok</span>
                        <span className="cell-sub" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(c.reply || c.userPrompt || '').replace(/\s+/g, ' ').slice(0, 140)}</span>
                        <span className="muted" style={{ fontSize: 11 }}>{open[c.id] ? '▾' : '▸'}</span>
                      </div>
                      {open[c.id] && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, margin: '8px 0 4px' }}>
                          <PromptBlock label="System prompt — how the AI is led" text={c.systemPrompt} />
                          <PromptBlock label="User / context — the prompt" text={c.userPrompt} />
                          <PromptBlock label="Reply" text={c.reply} accent />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
    </div>
  );
}

function PromptBlock({ label, text, accent }: { label: string; text: string; accent?: boolean }) {
  return (
    <div>
      <div className="overline" style={{ marginBottom: 4 }}>{label}</div>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.5, background: accent ? 'rgba(0,151,169,.06)' : 'var(--app-subtle,#f6f8fb)', border: '1px solid var(--border-subtle,#e2e7ee)', borderRadius: 8, padding: '10px 12px', margin: 0, maxHeight: 360, overflow: 'auto' }}>{text || '—'}</pre>
    </div>
  );
}

/* AI Control (migrations 0027 + 0028) — surface + EDIT how the AI is led: the model the demo brain runs on,
   and every default system prompt the platform uses (per function), with live override + reset. Saving applies
   on the engine's NEXT turn (no redeploy). Defaults are proven byte-identical to the shipped prompts by
   src/core/eval-prompts.ts, so "Reset to default" always restores the exact tuned behavior. */
export function AiControl({ go }: { go?: Go }) {
  const [model, setModel] = useState<AiModelInfo | null>(null);
  const [prompts, setPrompts] = useState<AiPromptRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string>(''); // key currently saving ('model' for the model card)
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('all'); // all | overridden | default
  const [grp, setGrp] = useState('all');         // prompt group filter
  const [sel, setSel] = useState('');            // selected prompt key (master/detail)
  const [shownDefault, setShownDefault] = useState<Record<string, boolean>>({});

  // Merge per-key so a mutation NEVER clobbers other cards' unsaved drafts. seedAll = initial load (set every
  // draft); resetKey = the key just saved/reset (re-sync only it); otherwise (e.g. model switch) preserve all
  // existing drafts and only seed keys we haven't seen.
  const apply = (d: { prompts: AiPromptRow[]; model: AiModelInfo }, o?: { seedAll?: boolean; resetKey?: string }) => {
    setModel(d.model); setPrompts(d.prompts);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const p of d.prompts) if (o?.seedAll || o?.resetKey === p.key || !(p.key in next)) next[p.key] = p.effective;
      return next;
    });
  };
  useEffect(() => {
    let live = true;
    aiConfigGet().then((d) => { if (live) { apply(d, { seedAll: true }); setLoading(false); } }).catch((e) => { if (live) { setErr(String(e?.message ?? e)); setLoading(false); } });
    return () => { live = false; };
  }, []);

  const pickModel = async (id: string) => {
    setBusy('model'); setErr(null);
    try { apply(await aiConfigMutate('model.set', { model: id }), {}); } catch (e: any) { setErr(String(e?.message ?? e)); } finally { setBusy(''); }
  };
  const resetModel = async () => {
    setBusy('model'); setErr(null);
    try { apply(await aiConfigMutate('model.reset', {}), {}); } catch (e: any) { setErr(String(e?.message ?? e)); } finally { setBusy(''); }
  };
  const savePrompt = async (key: string) => {
    setBusy(key); setErr(null);
    try { apply(await aiConfigMutate('prompt.save', { key, text: drafts[key] ?? '' }), { resetKey: key }); } catch (e: any) { setErr(String(e?.message ?? e)); } finally { setBusy(''); }
  };
  const resetPrompt = async (key: string) => {
    setBusy(key); setErr(null);
    try { apply(await aiConfigMutate('prompt.reset', { key }), { resetKey: key }); } catch (e: any) { setErr(String(e?.message ?? e)); } finally { setBusy(''); }
  };

  const isDirty = (p: AiPromptRow) => (drafts[p.key] ?? p.effective).trim() !== p.effective.trim();
  const dirtyCount = prompts.filter(isDirty).length;
  const needle = q.trim().toLowerCase();
  const groupNames = useMemo(() => [...new Set(prompts.map((p) => p.group))], [prompts]);
  // A dirty prompt stays visible even under a search that wouldn't otherwise match — so an in-progress edit is
  // never stranded out of view. The live draft is also part of the search text.
  const matchQ = (p: AiPromptRow) => !needle || isDirty(p) || `${p.title} ${p.help} ${p.group} ${p.fn} ${p.effective} ${drafts[p.key] ?? ''}`.toLowerCase().includes(needle);
  const matchStatus = (p: AiPromptRow) => statusF === 'all' || (statusF === 'overridden' ? p.overridden : !p.overridden);
  const matchGrp = (p: AiPromptRow) => grp === 'all' || p.group === grp;
  // A prompt with unsaved edits is ALWAYS visible — no status pill, group select, or search can strand an
  // in-progress edit out of view (a freshly-edited prompt is not yet `overridden`, so the status pill would
  // otherwise drop it).
  const filtered = prompts.filter((p) => isDirty(p) || (matchQ(p) && matchStatus(p) && matchGrp(p)));
  const selected = filtered.find((p) => p.key === sel) ?? filtered[0];

  return (
    <div className="page scroll">
      <PageHead overline="Operations" title="AI Control" go={go}
        desc="How the AI is led: the model the demo brain runs on, and every default system prompt the platform uses. Edits apply live on the next turn — Reset always restores the exact shipped default." />

      {err && <div className="card card-pad" style={{ marginBottom: 12, color: 'var(--danger,#a8332f)', fontSize: 13 }}>{err}</div>}
      {loading ? <div className="card card-pad muted">Loading AI configuration from the engine…</div> : (
        <>
          {/* ── Model (the control banner — which brain every demo runs on) ── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-hd flex between items-center">
              <span className="cell-strong">Demo model</span>
              <span className="flex items-center gap-2">
                <span className="muted" style={{ fontSize: 12 }}>The model every demo runs on{model?.source === 'override' ? ' · switched from default' : ' · using default'}</span>
                {model?.source === 'override' && <button className="btn btn-secondary btn-sm" disabled={busy === 'model'} onClick={() => void resetModel()}>Use default</button>}
              </span>
            </div>
            <div className="card-pad" style={{ display: 'grid', gap: 8 }}>
              {(model?.options ?? []).map((o) => {
                const active = model?.current === o.id;
                const isDefault = model?.defaultId === o.id;
                return (
                  <button key={o.id} disabled={!o.available || busy === 'model'} onClick={() => { if (!active) void pickModel(o.id); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '11px 13px', borderRadius: 9, cursor: active || !o.available ? 'default' : 'pointer',
                      border: `1px solid ${active ? 'var(--accent,#0861ce)' : 'var(--border-subtle,#e2e7ee)'}`, background: active ? 'var(--accent-soft,rgba(8,97,206,.08))' : '#fff', opacity: o.available ? 1 : .55 }}>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `2px solid ${active ? 'var(--accent,#0861ce)' : '#c3ccd8'}`, background: active ? 'var(--accent,#0861ce)' : '#fff', boxShadow: active ? 'inset 0 0 0 2px #fff' : 'none' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cell-strong" style={{ fontSize: 13.5 }}>{o.label} {active && <Pill kind="info">Active</Pill>} {isDefault && <Pill kind="neutral">Default</Pill>} {!o.available && <Pill kind="neutral">Coming soon</Pill>}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{o.note}</div>
                    </div>
                    <code style={{ fontSize: 11, color: 'var(--muted,#8499b3)' }}>{o.id}</code>
                  </button>
                );
              })}
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Claude and Gemini both run the identical tuned prompts. Gemini models require GEMINI_API_KEY set on the engine.</div>
            </div>
          </div>

          {/* ── Filter row (Knowledge idiom): group select · status pills · search · count ── */}
          <div className="flex between items-center" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
            <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={grp} onChange={(e) => setGrp(e.target.value)} aria-label="Filter by group"
                style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line, #d4dae3)', fontWeight: 600, background: 'var(--surface, #fff)', color: 'var(--text-primary, #1a2b45)' }}>
                <option value="all">All groups</option>
                {groupNames.map((gname) => <option key={gname} value={gname}>{gname}</option>)}
              </select>
              {([['all', 'All', prompts.length], ['overridden', 'Overridden', prompts.filter((p) => p.overridden).length], ['default', 'Unmodified', prompts.filter((p) => !p.overridden).length]] as [string, string, number][]).map(([id, lbl, n]) => (
                <button key={id} className={`btn btn-sm ${statusF === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusF(id)}>{lbl} <span style={{ opacity: .7 }}>{n}</span></button>
              ))}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts…"
                style={{ padding: '6px 10px', border: '1px solid var(--line, #d4dae3)', borderRadius: 6, fontSize: 12.5, flex: '0 1 220px' }} />
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {prompts.length} prompts · {prompts.filter((p) => p.overridden).length} overridden{dirtyCount ? ` · ${dirtyCount} unsaved` : ''}</span>
          </div>

          {/* ── Two-pane: prompt list (left) · editor inspector (right) ── */}
          <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Prompt</th><th>Group</th><th>Function</th><th>Status</th></tr></thead>
                <tbody>
                  {filtered.map((p) => {
                    const dirty = isDirty(p);
                    return (
                      <tr key={p.key} onClick={() => setSel(p.key)} style={selected?.key === p.key ? { background: 'var(--app-active)' } : {}}>
                        <td><div className="cell-strong">{p.title}</div><div className="cell-sub mono">{p.key}</div></td>
                        <td><Pill kind="neutral">{p.group}</Pill></td>
                        <td className="muted" style={{ fontSize: 12 }}>{p.fn}</td>
                        <td>{p.overridden ? <Pill kind="warn">Overridden</Pill> : <Pill kind="neutral" dot>Default</Pill>}{dirty ? <Pill kind="info">unsaved</Pill> : null}</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 20, textAlign: 'center' }}>No prompts in this view.</td></tr>}
                </tbody>
              </table>
            </div>
            {selected && (() => {
              const p = selected;
              const draft = drafts[p.key] ?? p.effective;
              const dirty = draft.trim() !== p.effective.trim();
              const saving = busy === p.key;
              return (
                <div className="card" style={{ position: 'sticky', top: 0 }}>
                  <div className="card-hd"><div>
                    <div className="overline">Prompt · {p.fn}</div>
                    <h3 style={{ marginTop: 4, fontSize: 14, lineHeight: 1.3 }}>{p.title} {p.overridden && <Pill kind="warn">Overridden</Pill>}</h3>
                    <code style={{ fontSize: 11, color: 'var(--muted,#8499b3)' }}>{p.key}</code>
                  </div></div>
                  <div className="card-pad" style={{ display: 'grid', gap: 8 }}>
                    <div className="muted" style={{ fontSize: 12 }}>{p.help}</div>
                    <textarea value={draft} onChange={(e) => setDrafts((d) => ({ ...d, [p.key]: e.target.value }))}
                      rows={Math.min(20, Math.max(5, Math.ceil(draft.length / 64)))}
                      style={{ width: '100%', fontFamily: 'var(--mono,ui-monospace,monospace)', fontSize: 12, lineHeight: 1.5, padding: '10px 12px', borderRadius: 8, border: `1px solid ${dirty ? 'var(--accent,#0861ce)' : 'var(--border-subtle,#e2e7ee)'}`, resize: 'vertical', background: 'var(--app-subtle,#f9fafc)' }} />
                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                      <button className="btn btn-primary btn-sm" disabled={!dirty || saving || !draft.trim()} onClick={() => savePrompt(p.key)}>{saving ? 'Saving…' : 'Save override'}</button>
                      {p.overridden && <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => resetPrompt(p.key)}>Reset to default</button>}
                      {dirty && <button className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setDrafts((d) => ({ ...d, [p.key]: p.effective }))}>Discard changes</button>}
                      {p.overridden && <button className="btn btn-ghost btn-sm" onClick={() => setShownDefault((s) => ({ ...s, [p.key]: !s[p.key] }))}>{shownDefault[p.key] ? 'Hide default' : 'View shipped default'}</button>}
                    </div>
                    {p.overridden && shownDefault[p.key] && <PromptBlock label="Shipped default (Reset restores this)" text={p.default} />}
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
