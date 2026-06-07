/* VIN Demo — Control Room runtime (ported 1:1 from desktop/runtime.jsx).
   Plays the demo-loop beats. Stage = the demoed product; one collapsible right panel
   with Conversation (default) / Brief / Reasoning; an AI-consultant control bar. */
import { useState, useEffect, useRef, createElement } from 'react';
import { Icon, MODE_META, VALIDATION } from './shell';
import { VD } from './data';
import { LOOP, PLAN, QUOTES, SEED, BEATS, type Beat, type Msg } from './beats';
import { DemoApp } from './demo-app';
import { useReal, useDemoProduct, type RealProduct, type RealPersona } from './real-data';
import { VoiceClient } from './voice-client';

/** What the operator can define per session, sent to the engine as query params. */
type TargetParams = { productId?: string; role?: string; mode?: string; url?: string; scenario?: string; clientNav?: string };
/** The committed demo target (selection + config) the control room drives against. */
interface DemoTarget { productId: string; host: string; mk: string; color: string; role: string; mode: string; url: string; scenario: string }
const TARGET_ROLES = ['admin', 'manager', 'owner', 'accounting', 'employee'];
const TARGET_MODES: { id: string; label: string }[] = [
  { id: 'read-only', label: 'Read-only' }, { id: 'safe', label: 'Safe' }, { id: 'approval', label: 'Approval' }, { id: 'execution', label: 'Execution · live writes' },
];

const CURSOR = (
  <svg viewBox="0 0 24 24" style={{ width: 24, height: 24 }}><path d="M5 3l15 9-7 1.5L9 21z" fill="#0861CE" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" /></svg>
);

function ConfGauge({ conf }: { conf: number }) {
  const r = 28, c = 2 * Math.PI * r;
  const col = conf >= 0.85 ? '#1f8a5b' : conf >= 0.7 ? '#B75D04' : '#C54644';
  const label = conf >= 0.85 ? 'High — will assert & cite' : conf >= 0.7 ? 'Guarded — cite, soften' : 'Low — decline / show source';
  return (
    <div className="gauge">
      <div className="gauge__ring">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--cr-line)" strokeWidth="6" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${conf * c} ${c}`} style={{ transition: 'stroke-dasharray .5s var(--easing-out), stroke .3s' }} />
        </svg>
        <div className="gauge__num">{Math.round(conf * 100)}</div>
      </div>
      <div className="gauge__txt"><b>Confidence gate</b>{label}</div>
    </div>
  );
}

function CostMeter({ cost, live }: { cost: number; live?: { total: number; byType: { type: string; usd: number }[] } }) {
  const real = useReal();
  let rows: { k: string; v: number; color: string; pct: number }[];
  let total: number;
  let label: string;
  if (live && live.byType.length) {
    const t = live.byType.reduce((a, b) => a + (b.usd || 0), 0) || 1;
    rows = live.byType.map((b) => ({ k: COST_LABEL[b.type] ?? b.type, v: b.usd, color: COST_COLOR[b.type] ?? '#4D6995', pct: Math.round((b.usd / t) * 100) }));
    total = live.total; label = 'this live demo · tagged to session';
  } else if (real?.costBreakdown?.length) {
    rows = real.costBreakdown; total = real.costBreakdown.reduce((a, c) => a + c.v, 0); label = 'all demos · tagged to sessions';
  } else {
    rows = VD.costBreakdown.map((r) => ({ ...r, v: cost * r.pct / 100 })); total = cost; label = 'this demo · tagged to session';
  }
  return (
    <div className="cost-meter">
      <div className="cost-total"><span className="cost-total__val">${total.toFixed(2)}</span><span className="cost-total__label">{label}</span></div>
      <div className="cost-rows">
        {rows.map((r) => (
          <div className="cost-row" key={r.k}>
            <span className="cost-row__k"><i className="swatch" style={{ background: r.color }} />{r.k}</span>
            <span className="cost-row__bar"><i style={{ width: `${r.pct}%`, background: r.color }} /></span>
            <span className="cost-row__v">${r.v.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Citation({ id, chunk }: { id: string | null; chunk?: any }) {
  const real = useReal();
  if (!id && !chunk) return <div className="brain-now" style={{ color: 'var(--cr-fg3)', fontSize: 12 }}>No knowledge retrieved yet for the current step.</div>;
  // Live cite (real streamed chunk) wins; else a REAL chunk from the SSOT; else scripted.
  const realChunk = chunk ?? real?.knowledge?.find((x) => /delegat|approval/i.test(`${x.title} ${x.content} ${x.source}`)) ?? real?.knowledge?.[0];
  if (realChunk) {
    const t = real?.kbTypes?.[realChunk.type] ?? { label: realChunk.type, cls: 'pill-info' };
    const cls = realChunk.conf >= 0.85 ? 'conf-hi' : realChunk.conf >= 0.7 ? 'conf-mid' : 'conf-lo';
    const warn = realChunk.conf < 0.7 || realChunk.status !== 'validated';
    return (
      <div className="cite">
        <div className="cite__hd">
          <span className="doc"><Icon name="file" size={12} /></span>
          <div style={{ flex: 1 }}><div className="cite__title">{realChunk.title}</div><div className="cite__type">{t.label} · {realChunk.source}</div></div>
        </div>
        <div className="cite__body">
          <div className="cite__quote">&quot;{realChunk.content}&quot;</div>
          <div className="cite__meta">
            <div className="cmeta"><span className="cmeta__k">Confidence</span><span className="cr-conf-bar"><i className={cls} style={{ width: `${realChunk.conf * 100}%` }} /></span><span className={`cmeta__v ${warn ? 'warn' : 'ok'}`}>{Math.round(realChunk.conf * 100)}%</span></div>
            <div className="cmeta"><span className="cmeta__k">Last verified</span><span className="cmeta__v">{realChunk.verified}</span></div>
            <div className="cmeta"><span className="cmeta__k">Product version</span><span className="cmeta__v">v{realChunk.ver}</span></div>
            <div className="cmeta"><span className="cmeta__k">Validation</span><span className={`cmeta__v ${realChunk.status === 'validated' ? 'ok' : 'warn'}`}>{realChunk.status === 'validated' ? 'Validated' : realChunk.status}</span></div>
          </div>
        </div>
      </div>
    );
  }
  const k = VD.knowledge.find((x) => x.id === id)!;
  const t = VD.kbTypes[k.type];
  const cls = k.conf >= 0.85 ? 'conf-hi' : k.conf >= 0.7 ? 'conf-mid' : 'conf-lo';
  const val = VALIDATION[k.status];
  const warn = k.conf < 0.7 || k.status === 'stale' || k.status === 'needs-review';
  return (
    <div className="cite">
      <div className="cite__hd">
        <span className="doc"><Icon name="file" size={12} /></span>
        <div style={{ flex: 1 }}><div className="cite__title">{k.title}</div><div className="cite__type">{t.label} · {k.source}</div></div>
      </div>
      <div className="cite__body">
        <div className="cite__quote">&quot;{QUOTES[id ?? ''] || 'Retrieved passage.'}&quot;</div>
        <div className="cite__meta">
          <div className="cmeta"><span className="cmeta__k">Confidence</span><span className="cr-conf-bar"><i className={cls} style={{ width: `${k.conf * 100}%` }} /></span><span className={`cmeta__v ${warn ? 'warn' : 'ok'}`}>{Math.round(k.conf * 100)}%</span></div>
          <div className="cmeta"><span className="cmeta__k">Last verified</span><span className="cmeta__v">{k.verified}</span></div>
          <div className="cmeta"><span className="cmeta__k">Product version</span><span className="cmeta__v">v{k.ver}</span></div>
          <div className="cmeta"><span className="cmeta__k">Validation</span><span className={`cmeta__v ${k.status === 'validated' ? 'ok' : 'warn'}`}>{val.label}</span></div>
        </div>
      </div>
    </div>
  );
}

function LeftRail({ beat }: { beat: Beat }) {
  const po = useDemoProduct();
  return (
    <div className="cr-col cr-left">
      <div className="cr-sec">
        <div className="cr-sec__title">Session</div>
        <dl className="cr-kv">
          <dt>Department</dt><dd>Procurement</dd>
          <dt>Product</dt><dd>{po ? `${po.name} · ${po.version}` : 'po.vin'}</dd>
          <dt>Scenario</dt><dd>Approval delegation</dd>
          <dt>Environment</dt><dd>{po?.env || 'demo env'}</dd>
          <dt>Knowledge</dt><dd>{po ? `${po.chunks} chunks · ${po.coverage}% coverage` : '—'}</dd>
          <dt>Objective</dt><dd style={{ fontWeight: 500, color: 'var(--cr-fg2)' }}>Audit-clean coverage when approvers are out</dd>
        </dl>
      </div>
      <div className="cr-sec">
        <div className="cr-sec__title">Demo plan <span className="badge">{Math.max(0, beat.planIdx + (beat.loopDone ? 1 : 0))}/{PLAN.length}</span></div>
        <ul className="plan">
          {PLAN.map((p, i) => {
            const done = beat.loopDone || i < beat.planIdx;
            const active = !beat.loopDone && i === beat.planIdx;
            return (
              <li key={i} className={done ? 'done' : active ? 'active' : ''}>
                <span className="plan__dot">{done && <Icon name="check" size={9} />}</span>
                <span className="plan__txt">{p.t}<span className="plan__phase">{p.p}</span></span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="cr-sec" style={{ borderBottom: 'none', flex: 1 }}>
        <div className="cr-sec__title">Stakeholders <span className="badge">collection · {VD.stakeholders.length}</span></div>
        <div className="stk">
          {VD.stakeholders.map((s) => (
            <div key={s.id} className={`stk__card ${beat.activeStk === s.id ? 'active' : ''}`}>
              <div className="stk__top">
                <span className="stk__av" style={{ background: s.color }}>{s.initials}</span>
                <div><div className="stk__name">{s.name}</div><div className="stk__role">{s.role}</div></div>
                {beat.activeStk === s.id && <span className="stk__active-tag">Active</span>}
              </div>
              <div className="stk__interest">{s.interest}</div>
              <div className="stk__open"><Icon name="dot" size={10} className="solid" style={{ width: 9, height: 9 }} /> {s.asked} raised · <span className="n">{s.open}</span> open</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RightRail({ beat, mode, liveCite, liveCost }: { beat: Beat; mode: string; liveCite?: any; liveCost?: { total: number; byType: { type: string; usd: number }[] } }) {
  return (
    <div className="cr-col cr-right">
      <div className="cr-sec">
        <div className="cr-sec__title">Execution mode</div>
        <div className="flex between items-center" style={{ gap: 10 }}>
          <span className={`cr-mode ${MODE_META[mode].cls}`} title="Read-only is the AI agent's limit — it never fires a mutating action. You're logged in yourself and have full control of your live session; take over and click anything, anytime."><Icon name={MODE_META[mode].icon} size={12} /> {MODE_META[mode].label}</span>
          <button className="kill"><Icon name="stop" size={12} className="solid" /> Kill</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--cr-fg3)', marginTop: 9, lineHeight: 1.45 }}>Default-deny. Mutating actions require an explicit mode + action grant. Hard kill is always available.</div>
      </div>
      <div className="cr-sec">
        <div className="cr-sec__title">Confidence</div>
        <ConfGauge conf={beat.conf} />
      </div>
      <div className="cr-sec">
        <div className="cr-sec__title">Reasoning · now</div>
        <div className="brain-now">
          <div className="brain-now__phase">{beat.phase}</div>
          <div className="brain-now__txt">{beat.brain}</div>
          <div className="brain-now__sub">{beat.sub}</div>
        </div>
      </div>
      <div className="cr-sec">
        <div className="cr-sec__title">Knowledge cited</div>
        <Citation id={beat.cite} chunk={liveCite} />
      </div>
      <div className="cr-sec" style={{ borderBottom: 'none' }}>
        <div className="cr-sec__title">Cost · live</div>
        <CostMeter cost={beat.cost} live={liveCost} />
      </div>
    </div>
  );
}

function RightPanel({ beat, mode, open, setOpen, tab, setTab, messages, typing, onAsk, canAsk, onMic, micActive, liveCite, liveCost }: { beat: Beat; mode: string; open: boolean; setOpen: (b: boolean) => void; tab: string; setTab: (t: string) => void; messages: Msg[]; typing: boolean; onAsk?: (text: string) => void; canAsk?: boolean; onMic?: () => void; micActive?: boolean; liveCite?: any; liveCost?: { total: number; byType: { type: string; usd: number }[] } }) {
  const TABS = [
    { id: 'convo', label: 'Conversation', icon: 'sessions' },
    { id: 'brief', label: 'Brief', icon: 'customers' },
    { id: 'reasoning', label: 'Reasoning', icon: 'spark' },
  ];
  if (!open) {
    return (
      <div className="cr-panel collapsed">
        <button className="cr-panel__collapse" onClick={() => setOpen(true)} title="Expand panel"><Icon name="chevR" size={15} style={{ transform: 'scaleX(-1)' }} /></button>
        <div className="cr-railbtns">
          {TABS.map((t) => <button key={t.id} className={`cr-railbtn ${tab === t.id ? 'active' : ''}`} onClick={() => { setTab(t.id); setOpen(true); }} title={t.label}><Icon name={t.icon} size={15} /></button>)}
        </div>
      </div>
    );
  }
  return (
    <div className="cr-panel">
      <div className="cr-panel__tabs">
        {TABS.map((t) => <button key={t.id} className={`cr-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}><Icon name={t.icon} size={14} /> {t.label}</button>)}
        <button className="cr-panel__collapse" onClick={() => setOpen(false)} title="Collapse panel"><Icon name="chevR" size={15} /></button>
      </div>
      <div className="cr-panel__body">
        {tab === 'convo' && <Convo messages={messages} typing={typing} onAsk={onAsk} canAsk={canAsk} onMic={onMic} micActive={micActive} />}
        {tab === 'brief' && <LeftRail beat={beat} />}
        {tab === 'reasoning' && <RightRail beat={beat} mode={mode} liveCite={liveCite} liveCost={liveCost} />}
      </div>
    </div>
  );
}

/* Perception: distill the live page into the interactive elements the agent can act on. Stamps a
   stable data-vin-ref on each so the agent can point at one to click/type. Product-agnostic. */
const PAGE_SNAPSHOT_JS = `(function(){
  function vis(el){ try{ var r=el.getBoundingClientRect(); return el.offsetParent!==null && r.width>1 && r.height>1; }catch(e){ return false; } }
  var sel='a[href],button,[role="button"],[role="menuitem"],[role="tab"],[role="link"],[role="option"],[role="combobox"],input:not([type="hidden"]),select,textarea,summary,[onclick]';
  var nodes=[].slice.call(document.querySelectorAll(sel)), out=[], ref=0;
  for(var i=0;i<nodes.length && ref<140;i++){ var el=nodes[i]; if(!vis(el)) continue;
    var tag=el.tagName.toLowerCase();
    var kind = tag==='a'?'link': tag==='input'?((el.getAttribute('type')||'text').toLowerCase()): tag==='select'?'select': tag==='textarea'?'textarea':'button';
    var text=(el.innerText||el.value||el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('title')||'').trim().replace(/\\s+/g,' ').slice(0,120);
    if(!text && tag!=='input' && tag!=='select' && tag!=='textarea') continue;
    el.setAttribute('data-vin-ref', String(ref));
    var item={ ref: ref, text: text, role: el.getAttribute('role')||undefined, kind: kind };
    if(el.required || el.getAttribute('aria-required')==='true') item.required=true;
    if(tag==='select'){
      item.options=[].slice.call(el.options||[]).map(function(o){return (o.text||'').trim();}).filter(Boolean).slice(0,25);
      item.filled = el.selectedIndex>0 && !!el.value;            // option 0 is usually the empty placeholder
    } else if(tag==='input'){
      var t=(el.getAttribute('type')||'text').toLowerCase();
      item.filled = (t==='checkbox'||t==='radio') ? !!el.checked : !!el.value;
    } else if(tag==='textarea'){ item.filled = !!el.value; }
    out.push(item); ref++; }
  var heads=[].slice.call(document.querySelectorAll('h1,h2,h3')).filter(vis).map(function(h){return (h.innerText||'').trim().replace(/\\s+/g,' ').slice(0,100);}).filter(Boolean).slice(0,12);
  return { url: location.href, title: document.title, headings: heads, elements: out };
})()`;
const clickRefJs = (ref: number) => `(function(){ var el=document.querySelector('[data-vin-ref="'+${ref}+'"]'); if(!el) return false;
  el.scrollIntoView({behavior:'smooth',block:'center'}); var o=el.style.outline, off=el.style.outlineOffset; el.style.outline='3px solid #0861CE'; el.style.outlineOffset='2px';
  setTimeout(function(){ try{ el.click(); }catch(e){} }, 400); setTimeout(function(){ el.style.outline=o; el.style.outlineOffset=off; }, 2400); return true; })()`;
const selectRefJs = (ref: number, val: string) => `(function(){ var el=document.querySelector('[data-vin-ref="'+${ref}+'"]'); if(!el) return false;
  el.scrollIntoView({behavior:'smooth',block:'center'}); var want=${JSON.stringify(val)}.toString().toLowerCase().trim();
  if(el.tagName==='SELECT'){ var opts=[].slice.call(el.options), pick=-1;
    for(var i=0;i<opts.length;i++){ var t=(opts[i].text||'').toLowerCase().trim(), v=(opts[i].value||'').toLowerCase().trim(); if(t===want||v===want){ pick=i; break; } }
    if(pick<0) for(var j=0;j<opts.length;j++){ if((opts[j].text||'').toLowerCase().indexOf(want)>=0 && want){ pick=j; break; } }
    if(pick<0) for(var k=1;k<opts.length;k++){ if(opts[k].value && !opts[k].disabled){ pick=k; break; } } // fallback: first real option
    if(pick<0) return false;
    el.selectedIndex=pick; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
    var o=el.style.outline; el.style.outline='3px solid #0861CE'; setTimeout(function(){el.style.outline=o;},2400); return true; }
  try{ el.click(); }catch(e){} return true; })()`; // custom dropdown trigger → open it; the option is clicked next step
const typeRefJs = (ref: number, val: string) => `(function(){ var el=document.querySelector('[data-vin-ref="'+${ref}+'"]'); if(!el) return false;
  el.scrollIntoView({behavior:'smooth',block:'center'}); try{ el.focus(); var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; var s=Object.getOwnPropertyDescriptor(proto,'value').set; s.call(el, ${JSON.stringify(val)}); }catch(e){ try{ el.value=${JSON.stringify(val)}; }catch(x){} }
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  var o=el.style.outline; el.style.outline='3px solid #0861CE'; setTimeout(function(){ el.style.outline=o; }, 2400); return true; })()`;

/* SpecialistSelect — hand the demo off to a specialist persona (the AI adopts its prompt + guardrails)
   or back to the Lead Consultant. Always shows the ACTIVE specialist; lives in the live bar. */
function SpecialistSelect({ personas, activeId, onSelect }: { personas: RealPersona[]; activeId: string | null; onSelect: (p: RealPersona | null) => void }) {
  const [open, setOpen] = useState(false);
  const active = personas.find((p) => p.id === activeId) ?? null;
  const lead = personas.find((p) => p.lead);
  const specialists = personas.filter((p) => !p.lead);
  const inits = (n: string) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="spec">
      <button className={`spec__btn ${activeId ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} title="Hand off to a specialist — the AI adopts their prompt + hard guardrails" style={activeId && active ? { borderColor: active.color, color: active.color } : undefined}>
        <Icon name="spark" size={12} className="solid" style={{ stroke: 'none', fill: activeId && active ? active.color : 'var(--cr-accent)' }} />
        {activeId && active ? active.name : (lead?.name ?? 'Lead Consultant')}
        <Icon name="chevR" size={11} style={{ transform: 'rotate(90deg)', stroke: 'var(--cr-fg3)' }} />
      </button>
      {open && (
        <>
          <div className="target__backdrop" onClick={() => setOpen(false)} />
          <div className="spec__menu" role="listbox">
            <div className="target__h">Hand off to a specialist</div>
            <button className={`spec__opt ${!activeId ? 'on' : ''}`} onClick={() => { onSelect(null); setOpen(false); }}>
              <span className="spec__mk" style={{ background: lead?.color ?? '#002855' }}>LC</span>
              <span className="spec__opt-main"><b>{lead?.name ?? 'Lead Consultant'}</b><span>generalist · default</span></span>
              {!activeId && <Icon name="check" size={13} style={{ stroke: 'var(--cr-accent)' }} />}
            </button>
            {specialists.length === 0 && <div className="target__empty">No approved specialists for this site.</div>}
            {specialists.map((p) => (
              <button key={p.id} className={`spec__opt ${activeId === p.id ? 'on' : ''}`} onClick={() => { onSelect(p); setOpen(false); }}>
                <span className="spec__mk" style={{ background: p.color }}>{inits(p.name)}</span>
                <span className="spec__opt-main"><b>{p.name}</b><span>{p.role}</span></span>
                {activeId === p.id && <Icon name="check" size={13} style={{ stroke: 'var(--cr-accent)' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* LiveBrowser — a REAL embedded Chromium pane (Electron <webview>). The operator logs into the
   product live (no stored credentials) and can take over at any moment — it's a real browser. The AI
   consultant co-drives it: an engine `nav` event (navTo) navigates the same pane, so the agent walks
   the real UI and the human grabs the wheel whenever they want. Persistent partition → the login
   survives reloads/turns. Replaces the screenshot stage on the desktop. */
function LiveBrowser({ initialUrl, navAction, driving, picker, role, mode, specialist, controlsRef }: { initialUrl: string; navAction?: { label?: string; selectors?: string[]; url?: string; seq: number } | null; driving?: boolean; picker?: (liveUrl: string) => React.ReactNode; role?: string; mode?: string; specialist?: React.ReactNode; controlsRef?: React.MutableRefObject<any> }) {
  const ref = useRef<any>(null);
  const [bar, setBar] = useState(initialUrl);
  const [nav, setNav] = useState({ back: false, fwd: false, loading: false });
  const lastSeq = useRef(0);
  const lastBase = useRef(initialUrl);
  const firstUrl = useRef(initialUrl); // the webview's src is set ONCE; later navigation uses loadURL (avoids src+loadURL double-nav → ERR_ABORTED)

  useEffect(() => {
    const wv = ref.current; if (!wv) return;
    const upd = () => { try { setBar(wv.getURL()); setNav({ back: wv.canGoBack(), fwd: wv.canGoForward(), loading: false }); } catch { /* */ } };
    const start = () => setNav((n) => ({ ...n, loading: true }));
    wv.addEventListener('did-navigate', upd);
    wv.addEventListener('did-navigate-in-page', upd);
    wv.addEventListener('did-start-loading', start);
    wv.addEventListener('did-stop-loading', upd);
    wv.addEventListener('dom-ready', upd);
    return () => { for (const e of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'dom-ready']) wv.removeEventListener(e, upd); };
  }, []);
  // Expose perceive/act controls so the drive loop can read the page and click/type in this pane.
  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      snapshot: () => ref.current?.executeJavaScript(PAGE_SNAPSHOT_JS, true),
      clickRef: (r: number) => ref.current?.executeJavaScript(clickRefJs(r), true),
      typeInto: (r: number, v: string) => ref.current?.executeJavaScript(typeRefJs(r, v), true),
      selectOption: (r: number, v: string) => ref.current?.executeJavaScript(selectRefJs(r, v), true),
    };
    return () => { if (controlsRef) controlsRef.current = null; };
  }, [controlsRef]);
  // Operator switched product → load the new site (it carries its own persisted login).
  useEffect(() => { const wv = ref.current; if (wv && initialUrl && initialUrl !== lastBase.current) { lastBase.current = initialUrl; try { wv.loadURL(initialUrl); } catch { /* */ } } }, [initialUrl]);
  // AI co-drive → the agent issued a nav instruction; perform it in the operator's live session:
  // find the labeled element (or a CSS selector), highlight it, and click it. Falls back to loadURL.
  useEffect(() => {
    const wv = ref.current;
    if (!wv || !navAction || navAction.seq === lastSeq.current) return;
    lastSeq.current = navAction.seq;
    const { label, selectors = [], url } = navAction;
    if (label || selectors.length) {
      const code = `(function(){
        var label=${JSON.stringify(label ?? '')}, sels=${JSON.stringify(selectors)};
        function act(el){ if(!el) return false; el.scrollIntoView({behavior:'smooth',block:'center'});
          var o=el.style.outline, off=el.style.outlineOffset; el.style.outline='3px solid #0861CE'; el.style.outlineOffset='2px';
          setTimeout(function(){ try{ el.click(); }catch(e){} }, 420);
          setTimeout(function(){ el.style.outline=o; el.style.outlineOffset=off; }, 2400); return true; }
        for(var i=0;i<sels.length;i++){ try{ var e=document.querySelector(sels[i]); if(e&&e.offsetParent!==null) return act(e); }catch(x){} }
        if(label){ var lc=label.toLowerCase(),
          els=[].slice.call(document.querySelectorAll('a,button,[role="button"],[role="menuitem"],nav a,aside a,li a,li')), best=null;
          for(var j=0;j<els.length;j++){ var el=els[j], t=(el.textContent||'').trim(); if(t&&t.toLowerCase().indexOf(lc)>=0&&el.offsetParent!==null){ if(!best||t.length<(best.textContent||'').trim().length) best=el; } }
          if(best) return act(best.closest('a,button,[role="button"],[role="menuitem"]')||best); }
        return false; })();`;
      try { wv.executeJavaScript(code, true).catch(() => {}); } catch { /* */ }
    } else if (url && /^https?:/.test(url)) {
      try { wv.loadURL(url); } catch { /* */ }
    }
  }, [navAction?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (fn: string) => { try { ref.current?.[fn]?.(); } catch { /* */ } };
  return (
    <div className="live-browser">
      <div className="live-bar">
        <button className="live-nav" onClick={() => act('goBack')} disabled={!nav.back} title="Back">‹</button>
        <button className="live-nav" onClick={() => act('goForward')} disabled={!nav.fwd} title="Forward">›</button>
        <button className="live-nav" onClick={() => act('reload')} title="Reload" style={nav.loading ? { animation: 'spin 1s linear infinite' } : undefined}>⟳</button>
        {picker ? picker(bar) : <span className="live-bar__url" title={bar}><Icon name="lock" size={11} /> {bar}</span>}
        {specialist}
        {role && <span className="live-role" title="The persona the AI drives as — keep it consistent with who you're logged in as">as {role}</span>}
        <span className={`live-bar__tag ${driving ? 'driving' : ''} ${mode === 'execution' ? 'exec' : ''}`} title={mode === 'execution' ? 'EXECUTION — the agent makes real changes (clicks, types, saves) on this live target' : (driving ? 'The AI consultant is navigating — click anywhere to take over' : 'You are in control — it is your live, logged-in session')}>{mode === 'execution' ? (driving ? 'AI WRITING · execution' : 'EXECUTION · live') : (driving ? 'AI DRIVING' : 'LIVE · you take over')}</span>
      </div>
      {createElement('webview', { ref, src: firstUrl.current, partition: 'persist:vinlive', allowpopups: 'true', className: 'live-webview' })}
    </div>
  );
}

/* The demo-target picker — replaces the static address bar in engine modes. The operator picks any
   real product (or types an ad-hoc URL), and configures role / execution-mode / opening question.
   Applying commits a DemoTarget upstream, which restarts the live session against it. Pixel-native:
   styled with the existing --cr-* tokens (see .target* in control-room.css). */
function TargetPicker({ products, target, liveUrl, onApply }: { products: RealProduct[]; target: DemoTarget | null; liveUrl?: string; onApply: (t: DemoTarget) => void }) {
  const [open, setOpen] = useState(false);
  const [pid, setPid] = useState(target?.productId ?? '');
  const [role, setRole] = useState(target?.role ?? 'admin');
  const [mode, setMode] = useState(target?.mode ?? 'read-only');
  const [url, setUrl] = useState(target?.url ?? '');
  const [scenario, setScenario] = useState(target?.scenario ?? '');
  // Re-seed the draft from the committed target each time the menu opens.
  useEffect(() => { if (open && target) { setPid(target.productId); setRole(target.role); setMode(target.mode); setUrl(target.url); setScenario(target.scenario); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = products.find((p) => p.id === pid);
  const display = liveUrl || (url ? url.replace(/^https?:\/\//, '') : target?.host) || 'pick a demo target';
  const commit = () => {
    const p = products.find((x) => x.id === pid);
    onApply({
      productId: url && !p ? '' : pid,
      host: url ? url.replace(/^https?:\/\//, '') : p?.domain ?? '',
      mk: p?.mk ?? '∗', color: p?.color ?? '#4D6995',
      role, mode, url: url.trim(), scenario: scenario.trim(),
    });
    setOpen(false);
  };

  return (
    <div className="target">
      <button className="target__btn" onClick={() => setOpen((o) => !o)} title="Choose the demo target — product, role, mode, opening question">
        <Icon name="lock" size={12} />
        <span className="target__host">{display}</span>
        <Icon name="chevR" size={12} style={{ transform: 'rotate(90deg)', stroke: 'var(--cr-fg3)' }} />
      </button>
      {open && (
        <>
          <div className="target__backdrop" onClick={() => setOpen(false)} />
          <div className="target__menu" role="listbox">
            <div className="target__h">Demo target · pick a site, then configure</div>
            <div className="target__list">
              {products.length === 0 && <div className="target__empty">Loading products…</div>}
              {products.map((p) => (
                <button key={p.id} className={`target__opt ${pid === p.id && !url ? 'on' : ''}`} onClick={() => { setPid(p.id); setUrl(''); setMode(p.defaultMode ?? 'read-only'); }}>
                  <span className="target__mk" style={{ background: p.color }}>{p.mk}</span>
                  <span className="target__opt-main"><b>{p.domain}</b><span>{p.env} · {p.status}</span></span>
                  {pid === p.id && !url && <Icon name="check" size={13} style={{ stroke: 'var(--cr-accent)' }} />}
                </button>
              ))}
            </div>
            <div className="target__custom">
              <Icon name="external" size={13} />
              <input placeholder="Override URL or paste any site…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
            </div>
            <div className="target__cfg">
              <span className="target__cfg-l">Drive as</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>{TARGET_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
              <span className="target__cfg-l">Mode</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>{TARGET_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            </div>
            {mode === 'execution' && <div className="target__warn">⚠ Execution makes REAL changes — the agent will click, type, and SAVE on the live target. Use only on your own demo/QA environment.</div>}
            {(mode === 'safe' || mode === 'approval') && <div className="target__warn">⚠ {mode} permits actions beyond navigate/explain — use only against an authorized environment.</div>}
            {url && !sel && <div className="target__warn">Ad-hoc URL — not a trained product (no curated knowledge or demo graph).</div>}
            <input className="target__scenario" placeholder="Opening question (optional)…" value={scenario} onChange={(e) => setScenario(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
            <button className="target__apply" onClick={commit}>Apply &amp; restart session</button>
          </div>
        </>
      )}
    </div>
  );
}

function Stage({ beat, onResolve, screenshot, blocked, url, picker, browser }: { beat: Beat; onResolve: () => void; screenshot?: string | null; blocked?: string[]; url?: string; picker?: React.ReactNode; browser?: React.ReactNode }) {
  const live = !!screenshot;
  const scriptedUrl = `https://${beat.screen === 'audit' ? 'demo.vin/audit' : beat.screen === 'delegation' || beat.screen === 'settings' || beat.screen === 'newdelegation' ? 'demo.vin/approvals/' + beat.screen : 'demo.vin/' + (beat.screen === 'dashboard' ? '' : beat.screen)}`;
  // Embedded live browser owns the whole stage (it carries its own single control bar + the picker).
  if (browser) return <div className="stage-wrap">{browser}</div>;
  return (
    <div className="stage-wrap">
      <div className="stage-bar">
        <div className="stage-dots"><i /><i /><i /></div>
        {picker ?? <div className="stage-bar__url"><Icon name="lock" size={12} /> {url || scriptedUrl}</div>}
        <span className="stage-bar__env">{live ? 'LIVE · demo tenant' : 'Demo tenant · demo-04'}</span>
      </div>
      <div className="stage">
        {browser /* the real embedded browser replaces the screenshot/mock on the desktop */ ?? <>
        {live
          ? <img src={screenshot!} alt="Live product (driven by the AI consultant, read-only)" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
          : <DemoApp screen={beat.screen} />}
        {!live && beat.hl && <div className="ai-highlight" style={{ left: `${beat.hl.x}%`, top: `${beat.hl.y}%`, width: `${beat.hl.w}%`, height: `${beat.hl.h}%` }} />}
        {!live && beat.cursor && <div className="ai-cursor" style={{ left: `${beat.cursor.x}%`, top: `${beat.cursor.y}%` }}>{CURSOR}</div>}
        {!live && beat.callout && (
          <div className="ai-callout below" style={{ left: `${beat.callout.x}%`, top: `${beat.callout.y}%` }}>
            <div className="ai-callout__label">{beat.callout.label}</div>{beat.callout.text}
          </div>
        )}
        {!live && beat.event === 'heal' && (
          <div className="heal-toast" onClick={onResolve} style={{ cursor: 'pointer' }}>
            <span className="heal-toast__spin"><Icon name="refresh" size={18} /></span>
            <div className="heal-toast__txt"><b>Self-healing navigation.</b> <span className="mono">[data-pa=delegation-tab]</span> not found — re-grounding by role + label instead of failing the demo.</div>
          </div>
        )}
        {!live && beat.event === 'block' && (
          <div className="block-toast">
            <div className="block-toast__icon"><Icon name="lock" size={22} /></div>
            <h4>Action blocked — read-only</h4>
            <p>Submitting <code>REQ-4821</code> is a <b style={{ color: '#f0807d' }}>mutating</b> action. The current mode permits navigate / highlight / explain only. No real workflow is fired in a demo.</p>
            <div className="block-toast__btns">
              <button className="btn btn-secondary btn-sm" onClick={onResolve} style={{ background: 'rgba(255,255,255,.1)', color: '#fff', borderColor: 'rgba(255,255,255,.25)' }}>Stay read-only</button>
              <button className="btn btn-sm" onClick={onResolve} style={{ background: '#B75D04', color: '#fff' }}>Request approval mode</button>
            </div>
          </div>
        )}
        {live && blocked && blocked.length > 0 && (
          <div style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 50, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 13px', borderRadius: 10, background: '#0a1622', border: '1px solid var(--cr-rec)', color: '#fff', fontSize: 12, maxWidth: '74%', boxShadow: '0 12px 28px rgba(0,0,0,.45)' }}>
            <Icon name="lock" size={14} style={{ stroke: '#f0807d' }} />
            <span><b style={{ color: '#f0807d' }}>{blocked.length} mutating action{blocked.length > 1 ? 's' : ''} blocked</b> (read-only): {blocked.slice(0, 4).join(', ')}{blocked.length > 4 ? '…' : ''} — never fired.</span>
          </div>
        )}
        </>}
      </div>
    </div>
  );
}

const ASK_CHIPS = ['How does delegation get audited?', 'What about SSO?', 'Show me out-of-office routing', 'Can you submit a real PO?'];

function Convo({ messages, typing, onAsk, canAsk, onMic, micActive }: { messages: Msg[]; typing: boolean; onAsk?: (text: string) => void; canAsk?: boolean; onMic?: () => void; micActive?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [messages.length, typing]);
  const send = (q: string) => { const t = q.trim(); if (!t || !onAsk || !canAsk) return; onAsk(t); setText(''); };
  const placeholder = onMic ? (micActive ? 'Listening… tap to send' : canAsk ? 'Tap the mic or type a question…' : 'Connecting…')
    : !onAsk ? 'Switch to Ask mode to type a question' : canAsk ? 'Ask the consultant a question…' : 'Connecting to the consultant…';
  return (
    <div className="convo">
      <div className="convo__head"><Icon name="sessions" size={14} style={{ stroke: 'var(--cr-fg3)' }} /><span className="overline">Conversation · intent-driven</span></div>
      <div className="convo__scroll" ref={ref}>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.side} ${m.uncertain ? 'uncertain' : ''}`}>
            <span className="msg__av" style={{ background: m.color }}>{m.av}</span>
            <div className="msg__body">
              <div className="msg__who">{m.who} · {m.role}</div>
              {m.tag && <span className={`msg__tag tag-${m.tag}`}>{m.tag}</span>}
              <div className="msg__bubble">{m.text}</div>
            </div>
          </div>
        ))}
        {typing && <div className="msg ai"><span className="msg__av" style={{ background: '#002855' }}>AI</span><div className="msg__bubble" style={{ padding: 0 }}><div className="typing"><i /><i /><i /></div></div></div>}
      </div>
      <div className="convo__input">
        {ASK_CHIPS.map((c) => <button key={c} className="ask-chip" onClick={() => send(c)} disabled={!canAsk}>{c}</button>)}
        <div className="field">
          {onMic && (
            <button onClick={onMic} disabled={!canAsk && !micActive} title={micActive ? 'Tap to send' : 'Tap to talk'}
              style={{ background: 'none', border: 'none', padding: 0, marginRight: 6, display: 'flex', cursor: (canAsk || micActive) ? 'pointer' : 'default' }}>
              <Icon name={micActive ? 'stop' : 'spark'} size={18} className="solid" style={{ stroke: 'none', fill: micActive ? '#C54644' : 'var(--cr-accent)' }} />
            </button>
          )}
          <input placeholder={placeholder} value={text} disabled={!canAsk}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(text); }} />
          <button onClick={() => send(text)} disabled={!canAsk} title="Send"
            style={{ background: 'none', border: 'none', padding: 0, display: 'flex', cursor: canAsk ? 'pointer' : 'default', opacity: canAsk ? 1 : 0.4 }}>
            <Icon name="send" size={16} className="solid" style={{ stroke: 'none', fill: 'var(--cr-accent)' }} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Transport({ beat, idx, playing, onPlay, onStep, onBack, onRestart, speed, onSpeed, live, liveRunning, liveDone }: { beat: Beat; idx: number; playing: boolean; onPlay: () => void; onStep: () => void; onBack: () => void; onRestart: () => void; speed: number; onSpeed: () => void; live?: boolean; liveRunning?: boolean; liveDone?: boolean }) {
  const last = idx >= BEATS.length - 1;
  const status = live
    ? (liveRunning ? 'Running the live demo on po.vin' : liveDone ? 'Demo complete · live' : 'Standing by — press Run agent')
    : (playing ? 'Running the demo on autopilot' : idx === 0 ? 'Standing by — ready to run' : last ? 'Demo complete' : 'Paused — you have the controls');
  const running = live ? !!liveRunning : playing;
  return (
    <div className="transport">
      <div className={`agent-status ${running ? 'run' : ''}`}>
        <span className="agent-status__dot" />
        <div><div className="agent-status__l">AI consultant</div><div className="agent-status__s">{status}</div></div>
      </div>
      <div className="tp-btns">
        {!live && <button className="tp-btn" onClick={onRestart} title="Start the demo over"><Icon name="restart" size={14} /></button>}
        {!live && <button className="tp-btn" onClick={onBack} title="Back one step" disabled={idx <= 0} style={{ opacity: idx <= 0 ? .4 : 1 }}><Icon name="step" size={14} style={{ transform: 'scaleX(-1)' }} /></button>}
        <button className="tp-run" onClick={onPlay} title={live ? (liveRunning ? 'Stop the live agent' : 'Run the live agent') : (playing ? 'Pause the agent' : 'Let the agent run')}>
          <Icon name={running ? 'pause' : 'play'} size={15} className="solid" /> {live ? (liveRunning ? 'Stop agent' : liveDone ? 'Run again' : 'Run agent') : (playing ? 'Pause agent' : last ? 'Run again' : 'Run agent')}
        </button>
        {!live && <button className="tp-ctl" onClick={onStep} disabled={last} title="Advance the agent one step (manual drive)"><Icon name="step" size={14} className="solid" /> Step</button>}
        {!live && <button className="tp-speed" onClick={onSpeed} title="How fast the agent advances">Pace {speed}×</button>}
      </div>
      <div className="loop">
        <span className="loop__cap">Demo loop</span>
        {LOOP.map((l, i) => {
          const done = beat.loopDone || i < beat.loopIdx;
          const active = !beat.loopDone && i === beat.loopIdx;
          const warn = active && beat.warn;
          return (
            <div key={l} className={`loop__step ${done ? 'done' : ''} ${active && !warn ? 'active' : ''} ${warn ? 'warn' : ''}`}>
              <span className="loop__node" /><div className="loop__bar" /><div className="loop__label">{l}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmt(s: number) { const m = Math.floor(s / 60); const ss = s % 60; return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; }

/* ── Live engine session (Phase 4) — consume the real streamed events ── */
interface LiveState {
  running: boolean; done: boolean; ready: boolean; loopIdx: number; phase: string; brain: string; sub: string; conf: number;
  messages: Msg[]; cite: any | null; cost: number; byType: { type: string; usd: number }[];
  screenshot: string | null; url: string; blocked: string[]; error: string | null;
  navAction: { label?: string; selectors?: string[]; url?: string; seq: number } | null; // client-driven nav instruction for the embedded browser
}
const LIVE_INIT: LiveState = { running: false, done: false, ready: false, loopIdx: -1, phase: 'Ready', brain: 'Live engine ready — press Run agent to drive po.vin read-only.', sub: 'awaiting start', conf: 0.9, messages: [], cite: null, cost: 0, byType: [], screenshot: null, url: '', blocked: [], error: null, navAction: null };

function reduceLive(p: LiveState, ev: any): LiveState {
  switch (ev.type) {
    case 'start': return { ...LIVE_INIT, running: !ev.interactive, url: ev.product ? `https://${ev.product}` : '' };
    case 'ready': return { ...p, ready: true, running: false, phase: 'Ready', brain: 'Ask me anything about the product — I’ll answer live and show the screen.', sub: 'interactive' };
    case 'turn_done': return { ...p, running: false };
    case 'message': return { ...p, messages: [...p.messages, { side: ev.side, who: ev.who, role: ev.role, av: ev.side === 'ai' ? 'AI' : String(ev.who ?? '?')[0].toUpperCase(), color: ev.side === 'ai' ? '#002855' : '#4D6995', text: ev.text, tag: ev.tag, uncertain: ev.uncertain }] };
    case 'beat': return { ...p, loopIdx: ev.loopIdx ?? p.loopIdx, phase: ev.phase ?? p.phase, brain: ev.brain ?? p.brain, sub: ev.sub ?? p.sub, conf: ev.conf ?? p.conf };
    case 'cite': return { ...p, cite: ev.k };
    case 'nav': return {
      ...p,
      screenshot: ev.screenshot ?? p.screenshot,
      url: ev.url ?? p.url,
      // Client-driven instruction → bump seq so the embedded browser performs it (click the labeled element).
      navAction: ev.clientDriven ? { label: ev.label, selectors: ev.selectors ?? [], url: ev.url || undefined, seq: (p.navAction?.seq ?? 0) + 1 } : p.navAction,
    };
    case 'blocked': return { ...p, blocked: ev.actions ?? [] };
    case 'cost': return { ...p, cost: ev.total ?? p.cost, byType: ev.byType ?? p.byType };
    case 'done': return { ...p, running: false, done: true, loopIdx: 6 };
    case 'error': return { ...p, running: false, error: ev.message ?? 'engine error' };
    case 'closed': return { ...p, running: false };
    default: return p;
  }
}

function useLiveSession() {
  const [live, setLive] = useState<LiveState>(LIVE_INIT);
  useEffect(() => {
    const api = (window as unknown as { session?: { onEvent(cb: (ev: any) => void): () => void } }).session;
    if (!api?.onEvent) return;
    return api.onEvent((ev: any) => setLive((p) => reduceLive(p, ev)));
  }, []);
  const start = (target?: TargetParams) => { setLive({ ...LIVE_INIT, running: true }); (window as unknown as { session?: { start(t?: TargetParams): void } }).session?.start?.(target); };
  const startInteractive = (target?: TargetParams) => { setLive({ ...LIVE_INIT }); (window as unknown as { session?: { startInteractive(t?: TargetParams): void } }).session?.startInteractive?.(target); };
  const ask = (text: string, speaker?: string) => { setLive((p) => ({ ...p, running: true })); (window as unknown as { session?: { ask(t: string, s?: string): void } }).session?.ask?.(text, speaker); };
  const stop = () => { (window as unknown as { session?: { stop(): void } }).session?.stop?.(); setLive((p) => ({ ...p, running: false, ready: false })); };
  const pushEvent = (ev: any) => setLive((p) => reduceLive(p, ev)); // feed VoiceClient (WS) events into the same state
  const reset = () => setLive({ ...LIVE_INIT });
  return { live, start, startInteractive, ask, stop, pushEvent, reset };
}

const COST_LABEL: Record<string, string> = { llm: 'LLM tokens', embeddings: 'Embeddings', navigation: 'Navigation / compute', compute: 'Compute', storage: 'Storage' };
const COST_COLOR: Record<string, string> = { llm: '#002855', navigation: '#0097A9', embeddings: '#4D6995', compute: '#007D61', storage: '#B9975B' };

const SEG_BTN: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--color-steel-hover)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', padding: '4px 9px', borderRadius: 6, cursor: 'pointer' };
const SEG_ON: React.CSSProperties = { background: '#fff', color: 'var(--color-navy)' };

export default function ControlRoom({ onLogout }: { onLogout?: () => void } = {}) {
  // Input mode: ASK = live interactive (type any question), REEL ('live') = canned 3-question run on
  // the real engine, SCRIPTED = offline canned beats (QA). All three render the same panels.
  type RT = 'ask' | 'talk' | 'live' | 'scripted';
  const [runtime, setRuntime] = useState<RT>(() => {
    try { const v = localStorage.getItem('vd-runtime'); return v === 'scripted' ? 'scripted' : v === 'talk' ? 'talk' : v === 'ask' ? 'ask' : 'live'; } catch { return 'live'; }
  });
  const setMode = (m: RT) => { setRuntime(m); try { localStorage.setItem('vd-runtime', m); } catch { /* */ } };
  const isLive = runtime === 'live';
  const engine = runtime !== 'scripted'; // ask + reel both consume the real streamed engine state

  // Scripted playback state (QA).
  const [idx, setIdx] = useState(() => { try { return parseInt(localStorage.getItem('vd-cr-beat') || '0', 10); } catch { return 0; } });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [secs, setSecs] = useState(724);
  // Live engine session.
  const { live, start, startInteractive, ask, stop, pushEvent, reset } = useLiveSession();
  const vcRef = useRef<VoiceClient | null>(null);
  const browserCtl = useRef<{ snapshot: () => Promise<any>; clickRef: (r: number) => Promise<any>; typeInto: (r: number, v: string) => Promise<any>; selectOption: (r: number, v: string) => Promise<any> } | null>(null);
  const driving = useRef(false);
  const [driveActive, setDriveActive] = useState(false);
  const [voiceState, setVoiceState] = useState<string>('idle');
  const [listening, setListening] = useState(false);
  const startVoice = async (t?: TargetParams) => {
    reset(); setVoiceState('connecting'); setListening(false);
    const api = (window as unknown as { auth?: { voiceToken(): Promise<{ token: string | null; engineUrl: string }> } }).auth;
    const cfg = api?.voiceToken ? await api.voiceToken() : null;
    if (!cfg?.token) { setVoiceState('error'); return; }
    let wss = String(cfg.engineUrl).replace(/^http/, 'ws') + `/voice?token=${encodeURIComponent(cfg.token)}`;
    // Append the operator's target — the engine boots the chosen product/role/mode/url for this session.
    for (const [k, v] of Object.entries(t ?? {})) if (v) wss += `&${k}=${encodeURIComponent(v)}`;
    const vc = new VoiceClient(wss, (ev) => pushEvent(ev), (s) => setVoiceState(s));
    vcRef.current = vc; vc.connect();
  };
  const stopVoice = () => { vcRef.current?.close(); vcRef.current = null; setListening(false); setVoiceState('idle'); };
  const toggleMic = () => { const vc = vcRef.current; if (!vc) return; if (listening) { vc.stopMic(); setListening(false); } else { void vc.startMic(); setListening(true); } };

  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState('convo');

  // Operator-chosen demo target. Initialized from the real products once they load (po.vin by default).
  // Each product carries a per-site DEFAULT execution mode (set in the web console); the operator can
  // override it per session in the picker below.
  const real = useReal();
  const products = real?.products ?? [];
  const [target, setTarget] = useState<DemoTarget | null>(null);
  useEffect(() => {
    if (target || !products.length) return;
    const p = products.find((x) => /po\.vin|^demo/i.test(x.name)) ?? products[0];
    setTarget({ productId: p.id, host: p.domain, mk: p.mk, color: p.color, role: 'admin', mode: p.defaultMode ?? 'read-only', url: '', scenario: '' });
  }, [products, target]);
  // The execution mode shown in the top strip reflects the operator's chosen target (default read-only).
  const mode = target?.mode ?? 'read-only';
  const targetParams: TargetParams | undefined = target
    ? { productId: target.productId || undefined, role: target.role, mode: target.mode, url: target.url || undefined, scenario: target.scenario || undefined, clientNav: '1' }
    : undefined;
  const tkey = target ? `${target.productId}|${target.role}|${target.mode}|${target.url}|${target.scenario}` : '';
  // The URL the embedded browser opens: an explicit override/ad-hoc URL, else the product's domain.
  const browserUrl = target ? (target.url?.trim() ? (/^https?:\/\//.test(target.url) ? target.url : `https://${target.url.replace(/^https?:\/\//, '')}`) : `https://${target.host}`) : '';

  // Active specialist persona (hand-off). Approved personas available for the current site (or unassigned).
  const [activePersona, setActivePersona] = useState<RealPersona | null>(null);
  const specialists = (real?.personas ?? []).filter((p) => p.status === 'approved' && (p.lead || !p.productIds.length || (target ? p.productIds.includes(target.productId) : true)));
  const handoffSpecialist = (p: RealPersona | null) => {
    const fromId = activePersona?.id ?? null;
    setActivePersona(p);
    (window as unknown as { session?: { handoff(x: any): void } }).session?.handoff?.({ fromId, toId: p?.id ?? null, trigger: 'operator' });
    pushEvent({ type: 'message', side: 'ai', who: 'Consultant', role: 'VIN Demo', text: p ? `Handing off to the ${p.name} — I'll focus on their scope and stay within their guardrails.` : 'Back to the Lead Consultant.' });
  };

  useEffect(() => { try { localStorage.setItem('vd-cr-beat', String(idx)); } catch { /* */ } }, [idx]);
  useEffect(() => { document.getElementById('boot')?.style.setProperty('display', 'none'); }, []);

  // Ask = interactive text (IPC SSE); Talk = voice (WS via VoiceClient). Open on entry, close on leave.
  // Re-runs when the operator changes the target (tkey) → tears the session down and reopens it on the
  // new product/role/mode/url. Reel ('live') is manual (Run agent), so it picks up the target on demand.
  useEffect(() => {
    if (!target) return; // wait for the default target to resolve from real products
    if (runtime === 'ask') { startInteractive(targetParams); return () => stop(); }
    if (runtime === 'talk') { void startVoice(targetParams); return () => stopVoice(); }
  }, [runtime, tkey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scripted autoplay (scripted mode only).
  useEffect(() => {
    if (!isLive && playing) {
      if (idx >= BEATS.length - 1) { setPlaying(false); return; }
      const t = setTimeout(() => setIdx((i) => Math.min(i + 1, BEATS.length - 1)), 2600 / speed);
      return () => clearTimeout(t);
    }
  }, [isLive, playing, idx, speed]);
  useEffect(() => {
    if (!isLive && playing) {
      const t = setInterval(() => setSecs((s) => s + 1), 1000);
      return () => clearInterval(t);
    }
  }, [isLive, playing]);

  // Unified render inputs from whichever runtime is active.
  const scriptedBeat = BEATS[idx];
  const liveBeat: Beat = { loopIdx: live.loopIdx, planIdx: Math.min(Math.max(live.loopIdx, 0), PLAN.length - 1), phase: live.phase, brain: live.brain, sub: live.sub, screen: 'dashboard', conf: live.conf, activeStk: 's1', cost: live.cost, cite: null, loopDone: live.done, push: [] };
  const beat = engine ? liveBeat : scriptedBeat;
  const messages = engine ? live.messages : [...SEED, ...BEATS.slice(1, idx + 1).flatMap((b) => b.push || [])];
  const typing = engine ? (live.running || driveActive) : (playing && idx > 0 && idx < BEATS.length - 1);
  const canAsk = runtime === 'ask' ? (live.ready && !live.running && !driveActive)
    : runtime === 'talk' ? (voiceState === 'ready' && !listening && !driveActive) : false;
  // Agentic DRIVE loop: perceive the live pane → ask the engine for the next action → click/type →
  // repeat, narrating each step. Read-only is enforced engine-side (mutating clicks are refused).
  const driveGoal = async (goal: string) => {
    const ctl = browserCtl.current;
    const api = (window as unknown as { session?: { agentStep(p: any): Promise<any> } }).session;
    if (!ctl || !api?.agentStep) { ask(goal); return; } // no live pane → fall back to a server turn
    if (driving.current) return;
    driving.current = true; setDriveActive(true);
    pushEvent({ type: 'message', side: 'them', who: target?.role ?? 'You', role: 'Operator', text: goal, tag: 'question' });
    pushEvent({ type: 'beat', loopIdx: 2, phase: 'Driving the demo', brain: 'Reading the live screen and taking the next step.', sub: goal });
    const history: string[] = [];
    const say = (text: string, uncertain?: boolean) => pushEvent({ type: 'message', side: 'ai', who: 'Consultant', role: 'VIN Demo', text, uncertain });
    let lastSig = ''; let finished = false;
    try {
      for (let i = 0; i < 14; i++) { // forms need several steps; stuck-detection (below) ends it early if it's not progressing
        const page = await ctl.snapshot().catch(() => null);
        if (!page) { say("I can't read the page yet — make sure it's loaded (and you're logged in), then ask again.", true); finished = true; break; }
        const res = await api.agentStep({ goal, page, history, role: target?.role, mode: target?.mode, personaId: activePersona?.id });
        if (!res) { say('Lost the connection to the engine for a moment — try again.', true); finished = true; break; }
        if (res.say) { say(res.say, res.action === 'done' && i === 0 ? false : undefined); history.push(res.say); }
        if (res.action === 'done') { finished = true; break; }
        // Never freeze: if the agent repeats the exact same action, it's stuck (e.g. a dropdown it can't
        // resolve) — hand the wheel back gracefully instead of looping.
        const sig = `${res.action}:${res.ref}:${res.value ?? ''}`;
        if (sig === lastSig) { say("I've gone as far as I can automatically here — could you set that field, then tell me to continue? I'll pick it right back up.", true); finished = true; break; }
        lastSig = sig;
        if (res.action === 'click') await ctl.clickRef(res.ref).catch(() => {});
        else if (res.action === 'type') await ctl.typeInto(res.ref, res.value ?? '').catch(() => {});
        else if (res.action === 'select') await ctl.selectOption(res.ref, res.value ?? '').catch(() => {});
        await new Promise((r) => setTimeout(r, 1500)); // let the page settle before the next perception
      }
      if (!finished) say("That's as far as I'll take this automatically — your turn to finish up, then ask me to continue.", true);
    } finally { driving.current = false; setDriveActive(false); }
  };
  // Typed questions in engine modes drive the live pane; spoken (mic) input still flows server-side.
  const onAsk = (t: string) => { if (engine && browserCtl.current) void driveGoal(t); else if (runtime === 'talk') vcRef.current?.sendText(t); else ask(t); };

  return (
    <div className="cr">
      <div className="cr-strip">
        <div className="cr-strip__brand"><img src="./assets/VIN-light.svg" alt="VIN" /><span className="cr-strip__div" />
          <div><div className="cr-strip__product">Demo</div><div className="cr-strip__sub">Control Room</div></div></div>
        <div className="cr-strip__live"><span className="rec" /><span>{runtime === 'scripted' ? 'Scripted' : runtime === 'ask' ? 'Ask · live' : runtime === 'talk' ? 'Talk · live' : 'Reel · live'}</span></div>
        <div className="cr-strip__meta"><b>Procurement</b> · {(engine && target?.host) || 'po.vin'} · {target?.scenario?.trim() ? 'Custom scenario' : 'Approval delegation'}</div>
        <div className="cr-strip__spacer" />
        <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 8, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)' }} title="Input mode — Ask: type · Talk: speak · Reel: canned scenario · Scripted: offline beats (QA). Ask/Talk/Reel use the live engine.">
          <button style={{ ...SEG_BTN, ...(runtime === 'ask' ? SEG_ON : {}) }} onClick={() => setMode('ask')}>Ask</button>
          <button style={{ ...SEG_BTN, ...(runtime === 'talk' ? SEG_ON : {}) }} onClick={() => setMode('talk')}>Talk</button>
          <button style={{ ...SEG_BTN, ...(runtime === 'live' ? SEG_ON : {}) }} onClick={() => setMode('live')}>Reel</button>
          <button style={{ ...SEG_BTN, ...(runtime === 'scripted' ? SEG_ON : {}) }} onClick={() => setMode('scripted')}>Scripted</button>
        </div>
        <span className={`cr-mode ${MODE_META[mode].cls}`} title="Read-only is the AI agent's limit — it never fires a mutating action. You're logged in yourself and have full control of your live session; take over and click anything, anytime."><Icon name={MODE_META[mode].icon} size={12} /> {MODE_META[mode].label}</span>
        <span className="cr-clock">{fmt(secs)}</span>
        <a className="cr-icon-btn" href="https://demofor.vin" target="_blank" rel="noreferrer" title="Back to console"><Icon name="external" size={16} /></a>
        <button className="cr-icon-btn" onClick={onLogout} title="Log out"><Icon name="logout" size={16} /></button>
      </div>

      <div className="cr-body">
        <div className="cr-stagearea">
          <Stage beat={beat} onResolve={() => setIdx((i) => Math.min(i + 1, BEATS.length - 1))}
            screenshot={engine ? live.screenshot : null} blocked={engine ? live.blocked : undefined} url={engine ? live.url : undefined}
            browser={engine && target && browserUrl
              ? <LiveBrowser initialUrl={browserUrl} navAction={live.navAction} driving={live.running} role={target.role} mode={target.mode} controlsRef={browserCtl}
                  picker={(liveUrl) => <TargetPicker products={products} target={target} liveUrl={liveUrl} onApply={setTarget} />}
                  specialist={<SpecialistSelect personas={specialists} activeId={activePersona?.id ?? null} onSelect={handoffSpecialist} />} />
              : undefined} />
        </div>
        <RightPanel beat={beat} mode={mode} open={panelOpen} setOpen={setPanelOpen} tab={tab} setTab={setTab} messages={messages} typing={typing}
          onAsk={(runtime === 'ask' || runtime === 'talk') ? onAsk : undefined} canAsk={canAsk}
          onMic={runtime === 'talk' ? toggleMic : undefined} micActive={listening}
          liveCite={engine ? live.cite : undefined} liveCost={engine ? { total: live.cost, byType: live.byType } : undefined} />
      </div>

      <Transport beat={beat} idx={idx} playing={playing} speed={speed}
        live={engine} liveRunning={live.running} liveDone={live.done}
        onPlay={() => { if (runtime === 'live') { if (live.running) stop(); else start(targetParams); } else if (runtime === 'ask') { if (live.running) stop(); else startInteractive(targetParams); } else { if (idx >= BEATS.length - 1) { setIdx(0); setSecs(724); } setPlaying((p) => !p); } }}
        onStep={() => setIdx((i) => Math.min(i + 1, BEATS.length - 1))}
        onBack={() => setIdx((i) => Math.max(i - 1, 0))}
        onRestart={() => { setIdx(0); setPlaying(false); setSecs(724); }}
        onSpeed={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))} />
    </div>
  );
}
