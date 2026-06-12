/* VIN Demo — Control Room runtime (ported 1:1 from desktop/runtime.jsx).
   Plays the demo-loop beats. Stage = the demoed product; one collapsible right panel
   with Conversation (default) / Brief / Reasoning; an AI-consultant control bar. */
import { useState, useEffect, useRef, createElement } from 'react';
import { Icon, MODE_META, VALIDATION } from './shell';
import { VD } from './data';
import { LOOP, PLAN, QUOTES, SEED, BEATS, type Beat, type Msg } from './beats';
import { useReal, useDemoProduct, type RealProduct, type RealPersona, type RealWorkflow, type RealTour, type RealJourney } from './real-data';
import { VoiceClient } from './voice-client';

/** What the operator can define per session, sent to the engine as query params. */
type TargetParams = { productId?: string; role?: string; mode?: string; url?: string; scenario?: string; clientNav?: string; journeyId?: string };
/** The committed demo target (selection + config) the control room drives against. */
interface DemoTarget { productId: string; host: string; mk: string; color: string; role: string; mode: string; url: string; scenario: string; journeyId?: string }
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

function CostMeter({ cost, live, engine }: { cost: number; live?: { total: number; byType: { type: string; usd: number }[] }; engine?: boolean }) {
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
  } else if (engine) {
    // Live session, no cost yet — show an honest zero, NEVER the scripted breakdown.
    rows = []; total = 0; label = 'this live demo · tagged to session';
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

function Citation({ id, chunk, engine }: { id: string | null; chunk?: any; engine?: boolean }) {
  const real = useReal();
  // In a live session the ONLY legitimate citation is the streamed chunk — never a scripted/regex-guessed
  // one. Before the first cite arrives, show the honest empty state.
  if (engine) {
    if (!chunk) return <div className="brain-now" style={{ color: 'var(--cr-fg3)', fontSize: 12 }}>No knowledge retrieved yet for the current step.</div>;
  } else if (!id && !chunk) {
    return <div className="brain-now" style={{ color: 'var(--cr-fg3)', fontSize: 12 }}>No knowledge retrieved yet for the current step.</div>;
  }
  // Live cite (real streamed chunk) wins; in scripted mode only, fall back to a real SSOT chunk then scripted.
  const realChunk = chunk ?? (engine ? null : real?.knowledge?.find((x) => /delegat|approval/i.test(`${x.title} ${x.content} ${x.source}`)) ?? real?.knowledge?.[0]);
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

function LeftRail({ beat, target, activePersona }: { beat: Beat; target?: DemoTarget | null; activePersona?: RealPersona | null }) {
  const po = useDemoProduct();
  // Real session facts from the operator's chosen target + the targeted product (no hardcoded dept/objective).
  return (
    <div className="cr-col cr-left">
      <div className="cr-sec">
        <div className="cr-sec__title">Session</div>
        <dl className="cr-kv">
          <dt>Product</dt><dd>{po ? `${po.name}${po.version && po.version !== '—' ? ` · ${po.version}` : ''}` : (target?.host ?? '—')}</dd>
          <dt>Target</dt><dd>{target ? (target.url?.trim() || target.host) : '—'}</dd>
          <dt>Drive as</dt><dd>{target?.role ?? '—'}</dd>
          <dt>Mode</dt><dd>{target?.mode ?? '—'}</dd>
          <dt>Scenario</dt><dd>{target?.scenario?.trim() || 'Interactive (operator-led)'}</dd>
          <dt>Environment</dt><dd>{po?.env || '—'}</dd>
          <dt>Knowledge</dt><dd>{po ? `${po.chunks} chunks · ${po.coverage}% validated` : '—'}</dd>
        </dl>
      </div>
      <div className="cr-sec">
        <div className="cr-sec__title">Demo plan <span className="badge">the consultant&apos;s loop</span></div>
        {/* Descriptive loop stages; the active stage tracks the real engine loop index when live. */}
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
        <div className="cr-sec__title">Active specialist</div>
        {/* Real hand-off state — who the consultant is currently speaking as (null = the lead consultant). */}
        <div className="stk">
          <div className="stk__card active">
            <div className="stk__top">
              <span className="stk__av" style={{ background: activePersona?.color ?? '#002855' }}>{(activePersona?.name ?? 'Lead Consultant').split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
              <div><div className="stk__name">{activePersona?.name ?? 'Lead Consultant'}</div><div className="stk__role">{activePersona ? (activePersona.role || 'Specialist') : 'Always-on default'}</div></div>
              <span className="stk__active-tag">Active</span>
            </div>
            <div className="stk__interest">{activePersona ? 'Handed off — answers, gate, and voice now reflect this specialist.' : 'Hand off to a specialist from the live browser footer for deep questions.'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RightRail({ beat, mode, liveCite, liveCost, onKill, engine }: { beat: Beat; mode: string; liveCite?: any; liveCost?: { total: number; byType: { type: string; usd: number }[] }; onKill?: () => void; engine?: boolean }) {
  return (
    <div className="cr-col cr-right">
      <div className="cr-sec">
        <div className="cr-sec__title">Execution mode</div>
        <div className="flex between items-center" style={{ gap: 10 }}>
          <span className={`cr-mode ${MODE_META[mode].cls}`} title="Read-only is the AI agent's limit — it never fires a mutating action. You're logged in yourself and have full control of your live session; take over and click anything, anytime."><Icon name={MODE_META[mode].icon} size={12} /> {MODE_META[mode].label}</span>
          <button className="kill" onClick={onKill} title="Hard kill — stop the agent immediately"><Icon name="stop" size={12} className="solid" /> Kill</button>
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
        <Citation id={beat.cite} chunk={liveCite} engine={engine} />
      </div>
      <div className="cr-sec" style={{ borderBottom: 'none' }}>
        <div className="cr-sec__title">Cost · live</div>
        <CostMeter cost={beat.cost} live={liveCost} engine={engine} />
      </div>
    </div>
  );
}

function RightPanel({ beat, mode, open, setOpen, tab, setTab, messages, typing, onAsk, canAsk, onMic, micActive, liveCite, liveCost, onKill, target, activePersona, handoffSuggestion, onHandoff, engine }: { beat: Beat; mode: string; open: boolean; setOpen: (b: boolean) => void; tab: string; setTab: (t: string) => void; messages: Msg[]; typing: boolean; onAsk?: (text: string) => void; canAsk?: boolean; onMic?: () => void; micActive?: boolean; liveCite?: any; liveCost?: { total: number; byType: { type: string; usd: number }[] }; onKill?: () => void; target?: DemoTarget | null; activePersona?: RealPersona | null; handoffSuggestion?: { topic: string; toPersona: string } | null; onHandoff?: (toPersona: string) => void; engine?: boolean }) {
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
        {tab === 'convo' && <Convo messages={messages} typing={typing} onAsk={onAsk} canAsk={canAsk} onMic={onMic} micActive={micActive} handoffSuggestion={handoffSuggestion} onHandoff={onHandoff} />}
        {tab === 'brief' && <LeftRail beat={beat} target={target} activePersona={activePersona} />}
        {tab === 'reasoning' && <RightRail beat={beat} mode={mode} liveCite={liveCite} liveCost={liveCost} onKill={onKill} engine={engine} />}
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
      if(item.filled){ var so=el.options[el.selectedIndex]; item.value=((so&&so.text)||'').trim().slice(0,80); } // RC-08: report the CHOSEN value so the model sees it's set, and to WHAT — not just a boolean (this is what ends the dropdown loop)
    } else if(tag==='input'){
      var t=(el.getAttribute('type')||'text').toLowerCase();
      item.filled = (t==='checkbox'||t==='radio') ? !!el.checked : !!el.value;
      if(item.filled && t!=='checkbox' && t!=='radio') item.value=(el.value||'').trim().slice(0,80); // RC-08: surface what's actually typed
      if(!item.filled && t!=='checkbox' && t!=='radio'){ // custom combobox: the chosen value often renders in a sibling node while the input itself stays empty
        try{ var cb=el.closest('[role="combobox"]')||el.closest('[class*="select"],[class*="Select"],[class*="combobox"],[class*="Combobox"],[class*="autocomplete"],[class*="Autocomplete"]');
          if(cb){ var sv=cb.querySelector('[class*="singleValue"],[class*="single-value"],[class*="multiValue"],[class*="multi-value"],[class*="-value"],[class*="Value"],[class*="selected"],[class*="Selected"],[class*="chosen"],[aria-selected="true"]');
            if(sv && (sv.textContent||'').trim()){ item.filled=true; item.value=(sv.textContent||'').trim().slice(0,80); } // RC-08: the chosen value lives in the sibling node — read it so the model knows it's set
            else { // last resort — the container shows chosen text that is neither the placeholder nor the (empty) input
              var ph=(el.getAttribute('placeholder')||'').trim(); var ival=(el.value||'').trim();
              var ctext=(cb.textContent||'').replace(/\\s+/g,' ').trim();
              if(ctext && ctext.length<80 && ctext!==ph && ctext!==ival && !/^(search|select|choose|type to search|— *none *—)/i.test(ctext)){ item.filled=true; item.value=ctext.slice(0,80); }
            }
          } }catch(e){}
      }
    } else if(tag==='textarea'){ item.filled = !!el.value; if(item.filled) item.value=(el.value||'').trim().slice(0,80); }
    out.push(item); ref++; }
  var heads=[].slice.call(document.querySelectorAll('h1,h2,h3')).filter(vis).map(function(h){return (h.innerText||'').trim().replace(/\\s+/g,' ').slice(0,100);}).filter(Boolean).slice(0,12);
  // RC-08: visible alerts / validation / toasts the model otherwise can't see (so it can react to "Submit failed: …", success banners, etc.).
  var notices=[].slice.call(document.querySelectorAll('[role="alert"],[class*="error"],[class*="Error"],[class*="toast"],[class*="Toast"],[class*="alert"],[class*="banner"]')).filter(vis).map(function(n){return (n.innerText||'').trim().replace(/\\s+/g,' ').slice(0,140);}).filter(function(t){return t && t.length>2;}).filter(function(t,i,a){return a.indexOf(t)===i;}).slice(0,6);
  return { url: location.href, title: document.title, headings: heads, notices: notices, elements: out };
})()`;
// Robustly set a native temporal input (<input type=date|datetime-local|month|week|time>) to a FUTURE
// value, coercing whatever the agent typed (ISO, dd/mm/yyyy, "June 16", "next week", "ASAP", or NOTHING)
// into the exact ISO string that input type requires, clamped to [min,max] and NEVER in the past — then
// firing input/change via the native value setter so React/controlled forms register it. This is why a
// date field now "just fills" with zero gaps instead of stranding the drive loop on an unclickable native
// calendar popup (the #1 demo blocker). Injected as a function decl so click/type/replay can all reuse it.
const TEMPORAL_FN = `
  function __vinTType(el){ try{ return (el.getAttribute('type')||el.type||'').toLowerCase(); }catch(e){ return ''; } }
  function __vinIsTemporal(el){ return !!el && el.tagName==='INPUT' && ['date','datetime-local','month','week','time'].indexOf(__vinTType(el))>=0; }
  function __vinSetTemporal(el, raw){
    var TYPE=__vinTType(el);
    function pad(n){ n=Math.floor(n); return (n<10?'0':'')+n; }
    function mid(d){ var x=new Date(d.getTime()); x.setHours(0,0,0,0); return x; }
    var today=mid(new Date());
    var MON={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    function parseLoose(s){
      if(s==null) return null; s=(''+s).trim().toLowerCase();
      if(!s || s==='dd/mm/yyyy' || s==='mm/dd/yyyy' || s==='yyyy-mm-dd' || s==='hh:mm') return null; // placeholder echoes → treat as empty
      if(s==='today') return new Date(today);
      if(s==='tomorrow'){ var t=new Date(today); t.setDate(t.getDate()+1); return t; }
      if(/asap|urgent|immediat|rush|right away|soon/.test(s)){ var a=new Date(today); a.setDate(a.getDate()+3); return a; }
      var rel=s.match(/in\\s+(\\d+)\\s*(day|week|month|year)/);
      if(rel){ var n=+rel[1], u=rel[2], r=new Date(today); if(u==='day')r.setDate(r.getDate()+n); else if(u==='week')r.setDate(r.getDate()+7*n); else if(u==='month')r.setMonth(r.getMonth()+n); else r.setFullYear(r.getFullYear()+n); return r; }
      if(/next\\s+week/.test(s)){ var w=new Date(today); w.setDate(w.getDate()+7); return w; }
      if(/next\\s+month|end of (the )?month|month end/.test(s)){ var m=new Date(today); m.setMonth(m.getMonth()+1); return m; }
      if(/next\\s+quarter/.test(s)){ var q=new Date(today); q.setMonth(q.getMonth()+3); return q; }
      var iso=s.match(/^(\\d{4})-(\\d{1,2})(?:-(\\d{1,2}))?/);                       // ISO yyyy-mm[-dd] (also month/week-min)
      if(iso){ return mid(new Date(+iso[1], (+iso[2])-1, iso[3]?+iso[3]:1)); }
      var nm=s.match(/([a-z]{3,9})/);                                                // "june 16, 2026" / "16 jun" / "jun 2026"
      if(nm && MON[nm[1].slice(0,3)]!==undefined){
        var mo=MON[nm[1].slice(0,3)], dm=s.match(/(\\d{1,2})(?!\\d|:)/), ym=s.match(/(\\d{4})/);
        var yr=ym?+ym[1]:today.getFullYear(), dy=dm?+dm[1]:1, dd=mid(new Date(yr, mo, dy));
        if(!ym && dd<today) dd.setFullYear(dd.getFullYear()+1);                      // bare "june 16" already passed → next year
        return isNaN(dd.getTime())?null:dd;
      }
      var p=s.split(/[\\/.\\-\\s]+/).filter(Boolean).map(Number);                    // d/m/y or m/d/y (also . - )
      if(p.length>=3 && p.every(function(x){return !isNaN(x);})){
        var yi,mi,di;
        if(p[0]>=1000){ yi=p[0]; mi=p[1]-1; di=p[2]; }                               // y/m/d
        else { yi=p[2]<100?2000+p[2]:p[2]; if(p[0]>12){ di=p[0]; mi=p[1]-1; } else { mi=p[0]-1; di=p[1]; } } // >12 ⇒ day, else mm/dd
        var nd=mid(new Date(yi, mi, di)); return isNaN(nd.getTime())?null:nd;
      }
      var dn=new Date(s); return isNaN(dn.getTime())?null:mid(dn);                   // last resort
    }
    var minD=parseLoose(el.getAttribute('min')), maxD=parseLoose(el.getAttribute('max'));
    var floor=new Date(today); floor.setDate(floor.getDate()+1);                     // future = at least tomorrow
    if(minD && minD>floor) floor=minD;                                              // respect the form's own min
    var d=parseLoose(raw);
    if(!d || isNaN(d.getTime())){ d=new Date(today); d.setDate(d.getDate()+7); if(minD && d<minD) d=new Date(minD); } // unset/garbage → a week out
    if(d<floor) d=new Date(floor);                                                  // FUTURE guarantee — never the past
    if(maxD && d>maxD) d=new Date(maxD);
    function isoDate(x){ return x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate()); }
    function isoWeek(x){ var u=new Date(Date.UTC(x.getFullYear(),x.getMonth(),x.getDate())), day=u.getUTCDay()||7; u.setUTCDate(u.getUTCDate()+4-day); var ys=new Date(Date.UTC(u.getUTCFullYear(),0,1)), wk=Math.ceil((((u-ys)/86400000)+1)/7); return u.getUTCFullYear()+'-W'+pad(wk); }
    var val;
    if(TYPE==='datetime-local') val=isoDate(d)+'T09:00';
    else if(TYPE==='month') val=d.getFullYear()+'-'+pad(d.getMonth()+1);
    else if(TYPE==='week') val=isoWeek(d);
    else if(TYPE==='time'){ var tm=(''+raw).match(/(\\d{1,2}):(\\d{2})/); val=tm?pad(+tm[1])+':'+tm[2]:'09:00'; }
    else val=isoDate(d);
    try{ var st=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; st.call(el, val); }catch(e){ try{ el.value=val; }catch(x){} }
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
    try{ el.blur&&el.blur(); }catch(e){}
    return val;
  }`;
// Robustly resolve ANY dropdown to a chosen option — the other #1 demo blocker. Handles three shapes with one
// async path: (a) a native <select>; (b) an ARIA combobox/menu button; (c) a SEARCHABLE typeahead (a "Search …"
// field backed by a long list, e.g. GL Account · 302 accounts) that shows NOTHING until you type to filter.
// It opens the control, types the wanted value to filter, WAITS (polls) for options to render in the page OR a
// portal, and clicks the best match — falling back to clearing the query / ArrowDown / Enter so it always lands
// on a real option. This is why a custom search-dropdown now "just selects" instead of stranding the drive loop.
const COMBO_FN = `
  function __vinVis(el){ try{ var r=el.getBoundingClientRect(); return el.offsetParent!==null && r.width>1 && r.height>1; }catch(e){ return false; } }
  function __vinSleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function __vinFire(el,type){ try{ var ev; if(type.indexOf('key')===0) ev=new KeyboardEvent(type,{bubbles:true,cancelable:true}); else if(/^(mouse|click|pointer|dbl)/.test(type)) ev=new MouseEvent(type,{bubbles:true,cancelable:true,view:window}); else ev=new Event(type,{bubbles:true}); el.dispatchEvent(ev); }catch(e){} }
  function __vinKey(el,key){ var kc=key==='Enter'?13:(key==='ArrowDown'?40:0); ['keydown','keypress','keyup'].forEach(function(t){ try{ el.dispatchEvent(new KeyboardEvent(t,{bubbles:true,cancelable:true,key:key,code:key,keyCode:kc,which:kc})); }catch(e){} }); }
  function __vinSetVal(el,v){ try{ var p=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,v); }catch(e){ try{ el.value=v; }catch(x){} } }
  function __vinHilite(el){ try{ var o=el.style.outline; el.style.outline='3px solid #0861CE'; setTimeout(function(){ el.style.outline=o; },2200); }catch(e){} }
  function __vinIsCombo(el){ if(!el) return false; if(el.tagName==='SELECT') return true;
    try{ var role=(el.getAttribute('role')||'').toLowerCase(); if(role==='combobox'||role==='listbox') return true;
      var hp=(el.getAttribute('aria-haspopup')||'').toLowerCase(); if(['listbox','menu','tree','grid','dialog','true'].indexOf(hp)>=0) return true;
      if(el.getAttribute('aria-autocomplete')||el.getAttribute('aria-expanded')!==null) return true;
      if(el.closest && el.closest('[role="combobox"],[role="listbox"]')) return true; }catch(e){}
    return false; }
  function __vinCollect(input){
    var tiers=['[role="option"]','[role="listbox"] li','[role="menu"] [role="menuitem"]','[role="menuitem"]','[aria-selected]'];
    var found=[]; for(var i=0;i<tiers.length && !found.length;i++){ try{ found=[].slice.call(document.querySelectorAll(tiers[i])).filter(__vinVis); }catch(e){} }
    if(!found.length){ try{ found=[].slice.call(document.querySelectorAll('[class*="option"],[class*="-option"],[id*="-option-"],[class*="menu-item"],[class*="MenuItem"],[data-option-index],[class*="autocomplete"] li,[class*="Autocomplete"] li')).filter(__vinVis); }catch(e){} }
    return found.filter(function(o){ var t=(o.textContent||'').trim(); return o!==input && t && t.length<160 && !/^(no .*(result|match|option|account|item)|type to search|start typing|loading|searching)/i.test(t) && (!o.getAttribute||o.getAttribute('aria-disabled')!=='true'); }).slice(0,200); // RC-20: a long GL/account list can render many rows — collect more before matching (filter-by-token still narrows it first)
  }
  async function __vinWaitOpts(input,tries){ var o=[]; for(var i=0;i<(tries||16);i++){ o=__vinCollect(input); if(o.length) return o; await __vinSleep(90); } return o; }
  function __vinCode(s){ var m=(''+s).toLowerCase().match(/[a-z]{1,6}[-\\s]?\\d{2,6}(?:\\.\\d+)?|\\d{3,6}(?:\\.\\d+)?/); return m?m[0].replace(/\\s/g,''):''; }
  function __vinChoose(opts,want){ if(!opts.length) return null; var w=(want||'').toLowerCase().trim();
    if(!w) return null;                                                         // RC-15: no specific want → do NOT commit an arbitrary option (a bare click just opens the dropdown; the model re-perceives and picks a real value)
    function tx(o){ return (o.textContent||'').toLowerCase().trim(); }
    for(var i=0;i<opts.length;i++){ if(tx(opts[i])===w) return opts[i]; }       // 1) exact
    var code=__vinCode(w);                                                      // 2) account/code token (e.g. "FA104") — match it as a whole token, NOT a loose substring
    if(code){ for(var c=0;c<opts.length;c++){ var t=tx(opts[c]).replace(/\\s/g,''); if(t.indexOf(code)===0) return opts[c]; }
      for(var c2=0;c2<opts.length;c2++){ if(new RegExp('(^|[^0-9a-z])'+code.replace(/\\./g,'\\\\.')+'($|[^0-9])').test(tx(opts[c2]))) return opts[c2]; } }
    for(var s=0;s<opts.length;s++){ if(tx(opts[s]).indexOf(w)===0) return opts[s]; }   // 3) startsWith the wanted phrase
    var words=w.split(/[^a-z0-9.]+/).filter(function(x){return x.length>2;});
    if(words.length){ for(var k=0;k<opts.length;k++){ var ot=tx(opts[k]); if(words.every(function(x){return ot.indexOf(x)>=0;})) return opts[k]; } } // 4) all significant words present
    if(words.length===1){ for(var m=0;m<opts.length;m++){ if(tx(opts[m]).indexOf(words[0])>=0) return opts[m]; } }                                   // 5) single distinctive word
    return null;                                                               // a SPECIFIC want with no real match → don't pick an arbitrary option (that mis-picked the wrong GL account)
  }
  function __vinNative(el,want){ var opts=[].slice.call(el.options), pick=-1, w=(want||'').toLowerCase().trim();
    for(var i=0;i<opts.length;i++){ var t=(opts[i].text||'').toLowerCase().trim(), v=(opts[i].value||'').toLowerCase().trim(); if(w&&(t===w||v===w)){pick=i;break;} }
    if(pick<0&&w) for(var j=0;j<opts.length;j++){ if((opts[j].text||'').toLowerCase().indexOf(w)>=0){pick=j;break;} }
    if(pick<0 && !w) for(var k=0;k<opts.length;k++){ if(opts[k].value && !opts[k].disabled){pick=k;break;} } // RC-15: only auto-pick the first option when NO value was wanted — a SPECIFIC unmatched want must NOT fall back to an arbitrary option
    if(pick<0) return {ok:false}; el.selectedIndex=pick; __vinFire(el,'input'); __vinFire(el,'change'); return {ok:true,picked:(opts[pick].text||'').trim().slice(0,60)}; }
  async function __vinClickOpt(pick){ try{ pick.scrollIntoView({block:'nearest'}); }catch(e){} __vinFire(pick,'mousedown'); __vinFire(pick,'mouseup'); try{ pick.click(); }catch(e){} __vinFire(pick,'click'); await __vinSleep(140); }
  async function __vinCombo(el,want){
    want=(want==null?'':(''+want)).trim(); __vinHilite(el);
    try{ el.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){}
    if(el.tagName==='SELECT') return __vinNative(el,want);
    var input = el.tagName==='INPUT' ? el : (el.querySelector('input:not([type=hidden]),textarea')||el);
    try{ input.focus(); }catch(e){}
    __vinFire(input,'mousedown'); __vinFire(input,'mouseup'); try{ input.click(); }catch(e){} __vinFire(el,'click');
    await __vinSleep(150);
    var isText = input.tagName==='INPUT' && /^(text|search|email|tel|url|)$/.test((input.getAttribute('type')||'').toLowerCase());
    if(isText && want){ var fq=__vinCode(want)||want; __vinSetVal(input,fq); __vinFire(input,'input'); __vinFire(input,'keyup'); }   // type a CONCISE filter token (e.g. just "FA104", not the whole phrase) so the right rows render
    var opts = await __vinWaitOpts(input,16);
    if(!opts.length && isText && input.value){ __vinSetVal(input,''); __vinFire(input,'input'); opts = await __vinWaitOpts(input,12); } // RC-42: the filter token matched nothing → clear it and re-collect the FULL list, then match the want against it (__vinChoose still returns null if the want isn't there — we never "take any option")
    if(!opts.length){ __vinKey(input,'ArrowDown'); opts = await __vinWaitOpts(input,12); }                                              // some lists only open on ArrowDown
    if(!opts.length){ __vinKey(input,'Enter'); await __vinSleep(120); return { ok: !!input.value, picked: input.value||'', reason: 'no-options' }; }
    var pick = __vinChoose(opts,want); if(!pick) return { ok:false, reason:'no-match' };
    var ptext=(pick.textContent||'').trim().slice(0,60);
    var wcode=__vinCode(want); // RC-20: a coded want (e.g. "FA104") MUST resolve to an option containing that code — never commit a wrong-coded row from a loose name/word match
    if(wcode && ptext.toLowerCase().replace(/\\s/g,'').indexOf(wcode)<0) return { ok:false, reason:'code-mismatch', picked: ptext };
    await __vinClickOpt(pick);
    if(input.value==='' && isText && ptext){ __vinKey(input,'Enter'); }   // keyboard fallback for libs that commit on Enter
    return { ok:true, picked: ptext };
  }`;
// Everything injected ahead of an executor: the date filler + the dropdown resolver (both reused by click/type/select).
const INJECT = TEMPORAL_FN + COMBO_FN;
// Highlight an element briefly (shared by the click/type executors so the operator sees what the AI touched).
const HILITE = `var o=el.style.outline, off=el.style.outlineOffset; el.style.outline='3px solid #0861CE'; el.style.outlineOffset='2px'; setTimeout(function(){ el.style.outline=o; el.style.outlineOffset=off; }, 2400);`;
const clickRefJs = (ref: number) => `(async function(){ ${INJECT}
  var el=document.querySelector('[data-vin-ref="'+${ref}+'"]'); if(!el) return false;
  el.scrollIntoView({behavior:'smooth',block:'center'}); ${HILITE}
  if(__vinIsTemporal(el)){ __vinSetTemporal(el, ''); return true; } // a click on a date field opens an unclickable native calendar → fill a future date instead
  if(__vinIsCombo(el)){ return await __vinCombo(el, ''); }          // RC-15/42: a click on a dropdown OPENS it (no value wanted → __vinChoose returns null, so it commits NOTHING arbitrary); the model re-perceives the options and selects a real value
  setTimeout(function(){ try{ el.click(); }catch(e){} }, 400); return true; })()`;
// Resolve a dropdown (native <select>, ARIA combobox, or searchable typeahead) to the wanted option in ONE call.
const comboPickJs = (ref: number, val: string) => `(async function(){ ${INJECT}
  var el=document.querySelector('[data-vin-ref="'+${ref}+'"]'); if(!el) return {ok:false};
  el.scrollIntoView({behavior:'smooth',block:'center'});
  return await __vinCombo(el, ${JSON.stringify(val)}); })()`;
const typeRefJs = (ref: number, val: string) => `(async function(){ ${INJECT}
  var el=document.querySelector('[data-vin-ref="'+${ref}+'"]'); if(!el) return false;
  el.scrollIntoView({behavior:'smooth',block:'center'}); ${HILITE}
  if(__vinIsTemporal(el)){ __vinSetTemporal(el, ${JSON.stringify(val)}); return true; } // date/time field → coerce to a valid future ISO value
  if(__vinIsCombo(el)){ return await __vinCombo(el, ${JSON.stringify(val)}); }            // typing into a dropdown → filter + pick the option, don't just type text
  try{ el.focus(); var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; var s=Object.getOwnPropertyDescriptor(proto,'value').set; s.call(el, ${JSON.stringify(val)}); }catch(e){ try{ el.value=${JSON.stringify(val)}; }catch(x){} }
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

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
      selectOption: (r: number, v: string) => ref.current?.executeJavaScript(comboPickJs(r, v), true),
      comboPick: (r: number, v: string) => ref.current?.executeJavaScript(comboPickJs(r, v), true),
    };
    return () => { if (controlsRef) controlsRef.current = null; };
  }, [controlsRef]);
  // Operator switched product → load the new site (it carries its own persisted login).
  useEffect(() => { const wv = ref.current; if (wv && initialUrl && initialUrl !== lastBase.current) { lastBase.current = initialUrl; try { wv.loadURL(initialUrl); } catch { /* */ } } }, [initialUrl]);
  // AI co-drive → the agent issued a nav instruction; perform it in the operator's live session.
  // RC-31: when the node carries a verified screen_route (url), PREFER a direct route navigation (loadURL)
  // over a guessed click — the route is the most authoritative target. A relative route ("/approvals") is
  // resolved against the live webview's current origin (where the real base URL lives). RC-32: otherwise try
  // the node's FULL ordered, verified locators IN ORDER, then fall back to a label match RANKED by
  // role/nav-container (a[href], role=link/menuitem/tab, nav/aside) — not by shortest string length (which
  // clicked "Approve" for "Approvals").
  useEffect(() => {
    const wv = ref.current;
    if (!wv || !navAction || navAction.seq === lastSeq.current) return;
    lastSeq.current = navAction.seq;
    const { label, selectors = [], url } = navAction;
    // RC-31: route-preferred — resolve the route against the current origin and navigate directly. Only treat
    // a route as preferred when it's absolute or ROOT-relative ("/approvals"); a slashless value would resolve
    // against the current path segment and navigate to the wrong page, so fall through to the locator/label click.
    if (url && (/^https?:/.test(url) || url.startsWith('/'))) {
      try {
        const abs = /^https?:/.test(url) ? url : new URL(url, wv.getURL() || undefined).href;
        wv.loadURL(abs);
        return;
      } catch { /* relative resolve failed (no origin yet) → fall through to locator/label click below */ }
    }
    if (label || selectors.length) {
      const code = `(function(){
        var label=${JSON.stringify(label ?? '')}, sels=${JSON.stringify(selectors)};
        function act(el){ if(!el) return false; el.scrollIntoView({behavior:'smooth',block:'center'});
          var o=el.style.outline, off=el.style.outlineOffset; el.style.outline='3px solid #0861CE'; el.style.outlineOffset='2px';
          setTimeout(function(){ try{ el.click(); }catch(e){} }, 420);
          setTimeout(function(){ el.style.outline=o; el.style.outlineOffset=off; }, 2400); return true; }
        // RC-32: try each verified ordered locator first; querySelector THROWS on non-CSS (Playwright
        // text=/:has-text) — caught and skipped, so the verified-graph order is honored without breaking.
        for(var i=0;i<sels.length;i++){ try{ var e=document.querySelector(sels[i]); if(e&&e.offsetParent!==null) return act(e); }catch(x){} }
        if(label){ var lc=label.toLowerCase(),
          els=[].slice.call(document.querySelectorAll('a,button,[role="button"],[role="menuitem"],[role="tab"],nav a,aside a,li a,li')), best=null, bestScore=-1;
          // RC-32: rank label matches by role/nav-container corroboration, then prefer an EXACT/tighter text
          // match — not arbitrary shortest-string. A nav/menu link to "Approvals" outranks a stray "Approve" button.
          for(var j=0;j<els.length;j++){ var el=els[j], t=(el.textContent||'').trim(); if(!t||el.offsetParent===null) continue;
            var tl=t.toLowerCase(); if(tl.indexOf(lc)<0) continue;
            var score=0;
            if(tl===lc) score+=100; // exact label text — strongest signal
            else if(tl.indexOf(lc)===0) score+=20; // prefix match over mid-string
            var rl=(el.getAttribute&&el.getAttribute('role'))||'';
            if(el.tagName==='A'&&el.getAttribute('href')!=null) score+=40; // real nav link
            if(rl==='link'||rl==='menuitem'||rl==='tab') score+=35;
            try{ if(el.closest&&el.closest('nav,aside,[role="navigation"],[class*="sidebar" i],[class*="side-nav" i]')) score+=25; }catch(z){} // in a nav container
            score-=Math.min(t.length,40)*0.1; // mild shortest-tiebreak only AFTER role/container ranking
            if(score>bestScore){ bestScore=score; best=el; } }
          if(best) return act(best.closest('a,button,[role="button"],[role="menuitem"],[role="tab"]')||best); }
        return false; })();`;
      try { wv.executeJavaScript(code, true).catch(() => {}); } catch { /* */ }
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
          : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#76859a', fontSize: 13, background: '#f4f6f9' }}>Connecting to the live product…</div>}
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

function Convo({ messages, typing, onAsk, canAsk, onMic, micActive, handoffSuggestion, onHandoff }: { messages: Msg[]; typing: boolean; onAsk?: (text: string) => void; canAsk?: boolean; onMic?: () => void; micActive?: boolean; handoffSuggestion?: { topic: string; toPersona: string } | null; onHandoff?: (toPersona: string) => void }) {
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
        {handoffSuggestion?.toPersona && onHandoff && (
          <button className="ask-chip" style={{ borderColor: '#0861CE', color: '#0861CE', fontWeight: 700 }}
            onClick={() => onHandoff(handoffSuggestion.toPersona)} title={`This question is better for the ${handoffSuggestion.toPersona}`}>
            ↪ Bring in {handoffSuggestion.toPersona}
          </button>
        )}
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
  sessionId: string | null; // real demo_sessions id from the engine `start` event (used for hand-off records)
  handoffSuggestion: { topic: string; toPersona: string } | null; // active specialist suggested bringing in another
  journeyName: string | null; journeyStep: number; journeyTotal: number; journeyDone: boolean; turnSeq: number; // V5 voice-walk progress + per-turn completion counter (auto-advance signal)
  voices: { id: string; label: string }[]; voice: string; // unified voice catalog (Google + ElevenLabs) + the selected voice id (from the `start` event)
}
const LIVE_INIT: LiveState = { running: false, done: false, ready: false, loopIdx: -1, phase: 'Ready', brain: 'Live engine ready — press Run agent to drive po.vin read-only.', sub: 'awaiting start', conf: 0.9, messages: [], cite: null, cost: 0, byType: [], screenshot: null, url: '', blocked: [], error: null, navAction: null, sessionId: null, handoffSuggestion: null, journeyName: null, journeyStep: 0, journeyTotal: 0, journeyDone: false, turnSeq: 0, voices: [], voice: '' };

function reduceLive(p: LiveState, ev: any): LiveState {
  switch (ev.type) {
    case 'start': return { ...LIVE_INIT, running: !ev.interactive, url: ev.product ? `https://${ev.product}` : '', sessionId: typeof ev.sessionId === 'string' ? ev.sessionId : null, voices: Array.isArray(ev.profiles) ? ev.profiles : [], voice: typeof ev.voice === 'string' ? ev.voice : '' };
    case 'voice': return typeof ev.id === 'string' ? { ...p, voice: ev.id } : p; // engine confirmed a voice switch
    case 'ready': return { ...p, ready: true, running: false, phase: 'Ready', brain: 'Ask me anything about the product — I’ll answer live and show the screen.', sub: 'interactive' };
    case 'turn_done': return { ...p, running: false, turnSeq: p.turnSeq + 1 };
    case 'message': return { ...p, messages: [...p.messages, { side: ev.side, who: ev.who, role: ev.role, av: ev.side === 'ai' ? 'AI' : String(ev.who ?? '?')[0].toUpperCase(), color: ev.side === 'ai' ? '#002855' : '#4D6995', text: ev.text, tag: ev.tag, uncertain: ev.uncertain }], handoffSuggestion: ev.side === 'them' ? null : p.handoffSuggestion };
    case 'handoff_suggestion': return { ...p, handoffSuggestion: { topic: String(ev.topic ?? ''), toPersona: String(ev.toPersona ?? '') } };
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
    // V5 journey voice-walk progress (from the engine voice session).
    case 'journey_start': return { ...p, journeyName: String(ev.journey ?? 'Journey'), journeyTotal: Number(ev.steps ?? 0), journeyStep: 0, journeyDone: false };
    case 'journey_step': return { ...p, journeyStep: Number(ev.index ?? p.journeyStep) };
    case 'journey_complete': return { ...p, journeyDone: true, journeyStep: Number(ev.steps ?? p.journeyTotal) };
    case 'journey_unwalkable': return { ...p, error: String(ev.message ?? 'This journey has no walkable steps yet.') };
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

/* ── Guided demo TOURS (record-and-replay) ── The SCRIPTED tab. The operator drives the REAL product in the
   embedded browser and CAPTURES steps (a page to show · a click to perform · a talking-point note + a
   caption); replay re-performs them on the live product with Prev/Next. Everything is CLIENT-SIDE in the
   webview (no server browser, no LLM) — deterministic + reliable. Tours persist via the web admin endpoint. */
function primaryCtl(d: boolean): React.CSSProperties { return { background: '#0861CE', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 16px', cursor: d ? 'default' : 'pointer', opacity: d ? .7 : 1, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 13 }; }
const smBtn: React.CSSProperties = { fontSize: 12, padding: '6px 10px', border: '1px solid #d4dbe5', borderRadius: 7, background: '#fff', color: '#283e5b', cursor: 'pointer', fontWeight: 600 };
const tinyBtn: React.CSSProperties = { fontSize: 11, padding: '2px 6px', border: '1px solid #e3e8ef', borderRadius: 5, background: '#fff', color: '#5a6b80', cursor: 'pointer' };
function ctlBtnLight(d: boolean): React.CSSProperties { return { fontSize: 13, padding: '8px 14px', border: '1px solid #d4dbe5', borderRadius: 8, background: '#fff', color: '#283e5b', cursor: d ? 'default' : 'pointer', fontWeight: 600 }; }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A recorded step. kind: navigate | click | input | select | check | note. `value` carries the typed text /
// chosen option / checkbox state for input/select/check steps (this is what makes a real form-fill replayable).
type TStep = { kind: string; url?: string; selector?: string; label?: string; value?: string; caption: string };
interface TourCtl {
  url(): string; navigate(u: string): void;
  click(label: string, sels: string[]): Promise<any>;
  setField(sels: string[], label: string, value: string, kind: string): Promise<any>; // replay a typed/selected/checked field
  recOn(): void; recDrain(): Promise<any[]>; recOff(): Promise<any[]>;                  // auto-record: clicks + field changes
}

// Click an element by plain selector (id) first, then by VISIBLE TEXT label — same matcher the AI co-drive
// uses. Highlights, then clicks (so the real product reacts/navigates).
function clickJs(label: string, sels: string[]): string {
  return `(function(){ ${TEMPORAL_FN}
    var label=${JSON.stringify(label || '')}, sels=${JSON.stringify(sels || [])};
    function act(el){ if(!el) return false; el.scrollIntoView({behavior:'smooth',block:'center'});
      var o=el.style.outline; el.style.outline='3px solid #0861CE'; el.style.outlineOffset='2px';
      setTimeout(function(){ el.style.outline=o; }, 2200);
      if(__vinIsTemporal(el)){ __vinSetTemporal(el, ''); return true; } // recorded click on a date field → fill a valid future date on replay
      setTimeout(function(){ try{ el.click(); }catch(e){} }, 360); return true; }
    for(var i=0;i<sels.length;i++){ if(!sels[i]) continue; try{ var e=document.querySelector(sels[i]); if(e&&e.offsetParent!==null) return act(e); }catch(x){} }
    if(label){ var lc=label.toLowerCase(),
      els=[].slice.call(document.querySelectorAll('a,button,[role=\\"button\\"],[role=\\"menuitem\\"],nav a,aside a,li a,li,td,th')), best=null;
      for(var j=0;j<els.length;j++){ var el=els[j], t=(el.textContent||'').trim(); if(t&&t.toLowerCase().indexOf(lc)>=0&&el.offsetParent!==null){ if(!best||t.length<(best.textContent||'').trim().length) best=el; } }
      if(best) return act(best.closest('a,button,[role=\\"button\\"],[role=\\"menuitem\\"]')||best); }
    return false; })();`;
}
// AUTO-RECORD: while on, capture-phase listeners log every meaningful interaction into window.__vinRec —
// not just clicks but FIELD CHANGES (text/number/textarea → input, native <select> → select, checkbox/radio
// → check) and custom-combobox selections (read off the dropdown's displayed value on focus-out). Listeners
// do NOT preventDefault, so the operator keeps driving the real product normally. The host drains the buffer
// on a timer so steps accrue live. This is what lets a full purchase-order submit (mostly typing + selects)
// be recorded, where the old one-click capture could only record navigation.
const REC_ON_JS = `(function(){
  if(window.__vinRecOn) return 'on'; window.__vinRecOn=true; if(!window.__vinRec) window.__vinRec=[];
  function esc(s){ return (window.CSS&&CSS.escape)?CSS.escape(s):s; }
  function sel(el){ if(!el||!el.getAttribute) return ''; if(el.id) return '#'+esc(el.id); var nm=el.getAttribute('name'); if(nm) return el.tagName.toLowerCase()+'[name="'+nm+'"]'; return ''; }
  function labelOf(el){ try{
    var al=el.getAttribute&&el.getAttribute('aria-label'); if(al) return al.trim().slice(0,60);
    if(el.id){ var lab=document.querySelector('label[for="'+esc(el.id)+'"]'); if(lab&&lab.textContent) return lab.textContent.trim().replace(/\\s+/g,' ').slice(0,60); }
    var p=el.closest&&el.closest('label'); if(p&&p.textContent) return p.textContent.trim().replace(/\\s+/g,' ').slice(0,60);
    var ph=el.getAttribute&&el.getAttribute('placeholder'); if(ph) return ph.trim().slice(0,60);
    return ''; }catch(e){ return ''; } }
  function comboOf(el){ try{ return el.closest&&el.closest('[role="combobox"],[aria-haspopup="listbox"],[class*="select"],[class*="Select"],[class*="combobox"],[class*="Combobox"],[class*="autocomplete"],[class*="Autocomplete"]'); }catch(e){ return null; } }
  function push(s){ s.url=location.href; window.__vinRec.push(s); }
  function onClick(e){
    var t=e.target; if(!t||!t.closest) return;
    if(t.closest('input,select,textarea')) return;        // a focus click on a field — the change/focus-out handler captures it
    if(comboOf(t)) return;                                 // a click inside a custom dropdown — focus-out captures the chosen value
    var act=t.closest('a,button,[role="button"],[role="menuitem"],[role="tab"],summary,tr,td,th,li');
    if(!act) return;
    var label=((act.textContent||'').trim().replace(/\\s+/g,' ')).slice(0,60);
    if(!label && !sel(act)) return;
    push({ kind:'click', selector: sel(act), label: label, value:'' });
  }
  function onChange(e){
    var el=e.target; if(!el||!el.tagName) return; var tag=el.tagName.toLowerCase();
    if(tag!=='input'&&tag!=='select'&&tag!=='textarea') return;
    if(tag!=='select' && comboOf(el)) return;             // custom combobox input — focus-out handles its value
    var type=(el.getAttribute('type')||'text').toLowerCase();
    if(type==='checkbox'||type==='radio'){ push({ kind:'check', selector:sel(el), label:labelOf(el), value: el.checked?'1':'0' }); return; }
    var val = tag==='select' ? (((el.options[el.selectedIndex]||{}).text)||el.value||'') : (el.value||'');
    if(!String(val).trim()) return;
    push({ kind: tag==='select'?'select':'input', selector: sel(el), label: labelOf(el), value: String(val).slice(0,200) });
  }
  function onFocusOut(e){
    var el=e.target; if(!el||el.tagName!=='INPUT') return; var cb=comboOf(el); if(!cb) return;
    var sv=cb.querySelector('[class*="singleValue"],[class*="single-value"],[class*="multiValue"],[class*="multi-value"],[aria-selected="true"]');
    var v=((sv&&sv.textContent)?sv.textContent.trim():'')||el.value||''; if(!v) return; v=v.slice(0,120);
    var s2=sel(el)||sel(cb), last=window.__vinRec[window.__vinRec.length-1];
    if(last&&last.kind==='select'&&last.selector===s2&&last.value===v) return; // dedupe repeated focus-out
    push({ kind:'select', selector: s2, label: labelOf(el), value: v });
  }
  window.__vinOnClick=onClick; window.__vinOnChange=onChange; window.__vinOnFocusOut=onFocusOut;
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('focusout', onFocusOut, true);
  return 'on';
})();`;
const REC_DRAIN_JS = `(function(){ var r=window.__vinRec||[]; window.__vinRec=[]; return r; })();`;
const REC_OFF_JS = `(function(){ window.__vinRecOn=false;
  try{ document.removeEventListener('click', window.__vinOnClick, true); }catch(e){}
  try{ document.removeEventListener('change', window.__vinOnChange, true); }catch(e){}
  try{ document.removeEventListener('focusout', window.__vinOnFocusOut, true); }catch(e){}
  var r=window.__vinRec||[]; window.__vinRec=[]; return r; })();`;
// REPLAY a recorded field: locate it (by id/name selector, else by its <label>/placeholder text), then set the
// value the right way for its type — checkbox/radio toggle, date via the future-safe filler, dropdown via the
// combobox resolver, plain text via the native value setter — firing input/change so the real form registers it.
const setFieldJs = (sels: string[], label: string, val: string, kind: string) => `(async function(){ ${INJECT}
  var sels=${JSON.stringify(sels || [])}, label=${JSON.stringify(label || '')}, val=${JSON.stringify(val ?? '')}, kind=${JSON.stringify(kind || 'input')};
  var el=null;
  for(var i=0;i<sels.length;i++){ if(!sels[i]) continue; try{ var e=document.querySelector(sels[i]); if(e){ el=e; break; } }catch(x){} }
  if(!el && label){ var lc=label.toLowerCase();
    try{ var labs=[].slice.call(document.querySelectorAll('label'));
      for(var j=0;j<labs.length;j++){ if((labs[j].textContent||'').trim().toLowerCase().indexOf(lc)>=0){ var f=labs[j].getAttribute('for'); var t=f?document.getElementById(f):labs[j].querySelector('input,select,textarea'); if(t){ el=t; break; } } } }catch(x){}
    if(!el){ try{ var cands=[].slice.call(document.querySelectorAll('input,select,textarea')).filter(function(n){ return ((n.getAttribute('placeholder')||n.getAttribute('aria-label')||'').toLowerCase().indexOf(lc)>=0); }); if(cands.length) el=cands[0]; }catch(x){} }
  }
  if(!el) return {ok:false, reason:'not-found'};
  el.scrollIntoView({behavior:'smooth',block:'center'});
  var o=el.style.outline; el.style.outline='3px solid #0861CE'; setTimeout(function(){ el.style.outline=o; }, 2000);
  if(kind==='check'){ try{ var want=(val==='1'||val==='true'); if(!!el.checked!==want){ el.click(); } }catch(e){} return {ok:true}; }
  if(__vinIsTemporal(el)){ return {ok:true, picked: __vinSetTemporal(el, val)}; }
  if(kind==='select' || __vinIsCombo(el)){ return await __vinCombo(el, val); }
  try{ el.focus(); var p=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el, val); }catch(e){ try{ el.value=val; }catch(x){} }
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  try{ el.blur&&el.blur(); }catch(e){}
  return {ok:true}; })()`;

/* The embedded REAL browser (Electron <webview>) the operator logs into + drives — SAME rendering as
   Ask/Reel: the live-browser shell + the product DROPDOWN (TargetPicker) in the bar. Exposes a control
   handle for the recorder/player: navigate (loadURL), click, setField (replay a value), rec* (auto-record).
   When `recording`, the capture listeners are re-injected on every page load so they survive navigation. */
function TourBrowser({ initialUrl, ctlRef, products, target, onApply, recording }: { initialUrl: string; ctlRef: React.MutableRefObject<TourCtl | null>; products: RealProduct[]; target: DemoTarget | null; onApply: (t: DemoTarget) => void; recording?: boolean }) {
  const ref = useRef<any>(null);
  const [bar, setBar] = useState(initialUrl);
  const firstUrl = useRef(initialUrl);
  const lastBase = useRef(initialUrl);
  const rec = useRef(false); rec.current = !!recording;
  useEffect(() => {
    const wv = ref.current; if (!wv) return;
    const upd = () => { try { setBar(wv.getURL()); } catch { /* */ } };
    // Re-arm the recorder after a (re)load so capture survives full navigations, not just SPA route changes.
    const rearm = () => { upd(); if (rec.current) { try { wv.executeJavaScript(REC_ON_JS, true); } catch { /* */ } } };
    for (const e of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading']) wv.addEventListener(e, upd);
    wv.addEventListener('dom-ready', rearm);
    return () => { for (const e of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading']) wv.removeEventListener(e, upd); wv.removeEventListener('dom-ready', rearm); };
  }, []);
  // Operator switched product in the dropdown → load the new site (its own persisted login).
  useEffect(() => { const wv = ref.current; if (wv && initialUrl && initialUrl !== lastBase.current) { lastBase.current = initialUrl; try { wv.loadURL(initialUrl); } catch { /* */ } } }, [initialUrl]);
  useEffect(() => {
    const exec = (code: string) => { try { return ref.current?.executeJavaScript(code, true) ?? Promise.resolve(null); } catch { return Promise.resolve(null); } };
    ctlRef.current = {
      url: () => { try { return ref.current?.getURL() ?? ''; } catch { return ''; } },
      navigate: (u: string) => { try { ref.current?.loadURL(u); } catch { /* */ } },
      click: (label: string, sels: string[]) => exec(clickJs(label, sels)),
      setField: (sels: string[], label: string, value: string, kind: string) => exec(setFieldJs(sels, label, value, kind)),
      recOn: () => { void exec(REC_ON_JS); },
      recDrain: () => exec(REC_DRAIN_JS).then((r: any) => (Array.isArray(r) ? r : [])),
      recOff: () => exec(REC_OFF_JS).then((r: any) => (Array.isArray(r) ? r : [])),
    };
    return () => { ctlRef.current = null; };
  }, [ctlRef]);
  return (
    <div className="live-browser">
      <div className="live-bar"><TargetPicker products={products} target={target} liveUrl={bar} onApply={onApply} /></div>
      {createElement('webview', { ref, src: firstUrl.current, partition: 'persist:vinlive', allowpopups: 'true', className: 'live-webview' })}
    </div>
  );
}

function TourRunner({ products, target, onApplyTarget }: { products: RealProduct[]; target: DemoTarget | null; onApplyTarget: (t: DemoTarget) => void }) {
  const real = useReal();
  const product = products.find((p) => p.id === target?.productId) ?? null;
  const browserUrl = product ? `https://${product.domain}` : '';
  // Merge server tours with any saved THIS session, so a just-saved tour shows before the next data refresh.
  const [localTours, setLocalTours] = useState<RealTour[]>([]);
  const serverTours = (real?.tours ?? []).filter((t) => t.productId === product?.id);
  const tours = [...localTours.filter((l) => l.productId === product?.id), ...serverTours.filter((s) => !localTours.some((l) => l.id === s.id))];
  const [mode, setMode] = useState<'list' | 'record' | 'play'>('list');
  const [active, setActive] = useState<RealTour | null>(null);
  const onSaved = (t: RealTour) => { setLocalTours((prev) => [t, ...prev.filter((p) => p.id !== t.id)]); setMode('list'); };

  if (!product) return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#76859a', fontSize: 14 }}>No product selected — pick one in the Ask/Reel target picker.</div>;
  if (mode === 'record') return <TourRecord product={product} browserUrl={browserUrl} tour={active} products={products} target={target} onApply={onApplyTarget} onClose={() => setMode('list')} onSaved={onSaved} />;
  if (mode === 'play' && active) return <TourPlay tour={active} browserUrl={browserUrl} products={products} target={target} onApply={onApplyTarget} onExit={() => setMode('list')} />;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 28, background: '#f4f6f9' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#002855' }}>Guided demos — {product.name}</div>
            <div style={{ color: '#5a6b80', fontSize: 13, marginTop: 4 }}>Record a click-through demo on the real product, then replay it on cue. All pages and roles are available — you drive the actual product. (Switch product in the Ask/Reel target picker.)</div>
          </div>
          <button onClick={() => { setActive(null); setMode('record'); }} style={primaryCtl(false)}><Icon name="play" size={13} /> New demo (record)</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          {!tours.length && <div style={{ padding: 20, background: '#fff', border: '1px solid #e3e8ef', borderRadius: 10, color: '#76859a', fontSize: 13 }}>No demos yet. Click <strong>New demo (record)</strong> — drive {product.name} on the left and capture each step (a page to show, a click to perform, a talking point).</div>}
          {tours.map((t) => (
            <div key={t.id} style={{ background: '#fff', border: '1px solid #e3e8ef', borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: '#002855' }}>{t.name}</div>
                <div style={{ color: '#76859a', fontSize: 12, marginTop: 4 }}>{t.steps.length} step{t.steps.length === 1 ? '' : 's'}{t.description ? ` · ${t.description}` : ''}</div>
              </div>
              <button onClick={() => { setActive(t); setMode('play'); }} style={primaryCtl(false)}><Icon name="play" size={13} /> Present</button>
              <button onClick={() => { setActive(t); setMode('record'); }} style={ctlBtnLight(false)}>Edit</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* RECORD: drive the real product (left) + capture steps (right). Press ● Record, then just USE the product —
   every click, typed value, dropdown choice, date, and checkbox is captured automatically (so a full purchase-
   order submit can be recorded, not just navigation). + This page / + Note add explicit steps; caption + reorder. */
function TourRecord({ product, browserUrl, tour, products, target, onApply, onClose, onSaved }: { product: RealProduct; browserUrl: string; tour: RealTour | null; products: RealProduct[]; target: DemoTarget | null; onApply: (t: DemoTarget) => void; onClose: () => void; onSaved: (t: RealTour) => void }) {
  const ctlRef = useRef<TourCtl | null>(null);
  const [name, setName] = useState(tour?.name ?? '');
  const [steps, setSteps] = useState<TStep[]>(tour ? tour.steps.map((s) => ({ kind: s.kind, url: s.url, selector: s.selector, label: s.label, value: s.value, caption: s.caption })) : []);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const pollRef = useRef<any>(null);

  const append = (got: any[]) => { if (got && got.length) setSteps((s) => [...s, ...got.map((c: any) => ({ kind: String(c.kind || 'click'), url: c.url || '', selector: c.selector || '', label: c.label || '', value: c.value || '', caption: '' }))]); };
  const startRec = () => { if (recording) return; setErr(''); ctlRef.current?.recOn(); setRecording(true); if (pollRef.current) clearInterval(pollRef.current); pollRef.current = setInterval(() => { void ctlRef.current?.recDrain().then(append).catch(() => {}); }, 700); };
  const stopRec = async () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } setRecording(false); try { append(await (ctlRef.current?.recOff() ?? Promise.resolve([]))); } catch { /* */ } };
  const toggleRec = () => { if (recording) void stopRec(); else startRec(); };
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); try { void ctlRef.current?.recOff(); } catch { /* */ } }, []);

  const capturePage = () => { const u = ctlRef.current?.url() ?? ''; setSteps((s) => [...s, { kind: 'navigate', url: u, caption: '' }]); };
  const addNote = () => setSteps((s) => [...s, { kind: 'note', caption: '' }]);
  const setCap = (i: number, v: string) => setSteps((s) => s.map((st, j) => (j === i ? { ...st, caption: v } : st)));
  const removeAt = (i: number) => setSteps((s) => s.filter((_, j) => j !== i));
  const move = (i: number, d: number) => setSteps((s) => { const j = i + d; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const trim = (v?: string) => { const t = (v || '').trim(); return t.length > 30 ? `${t.slice(0, 30)}…` : t; };
  const stepLabel = (s: TStep) => {
    switch (s.kind) {
      case 'navigate': return `Go to ${s.url ? s.url.replace(/^https?:\/\//, '') : 'page'}`;
      case 'click': return `Click “${s.label || s.selector || 'element'}”`;
      case 'input': return `Type “${trim(s.value)}”${s.label ? ` in ${s.label}` : ''}`;
      case 'select': return `Choose “${trim(s.value)}”${s.label ? ` in ${s.label}` : ''}`;
      case 'check': return `${s.value === '1' ? 'Check' : 'Uncheck'} ${s.label || s.selector || 'box'}`;
      default: return 'Talking point';
    }
  };

  const save = async () => {
    if (recording) await stopRec();
    if (!name.trim()) { setErr('Give the demo a name.'); return; }
    if (!steps.length) { setErr('Capture at least one step — press ● Record and drive the product.'); return; }
    setSaving(true); setErr('');
    const api = (window as unknown as { consoleData?: { mutate(b: any): Promise<{ ok: boolean; id?: string; error?: string }> } }).consoleData;
    const body = { entity: 'demo_tour', op: tour?.id ? 'update' : 'create', id: tour?.id, data: { product_id: product.id, name: name.trim(), description: '', steps } };
    const r: { ok: boolean; id?: string; error?: string } = await api?.mutate?.(body).catch(() => ({ ok: false, error: 'save failed' })) ?? { ok: false, error: 'no console bridge' };
    if (!r.ok) { setErr(r.error || 'Save failed'); setSaving(false); return; }
    onSaved({ id: tour?.id || r.id || `local-${Date.now()}`, productId: product.id, name: name.trim(), description: '', steps: steps.map((s) => ({ kind: s.kind, url: s.url ?? '', selector: s.selector ?? '', label: s.label ?? '', value: s.value ?? '', caption: s.caption ?? '' })) });
  };

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><TourBrowser initialUrl={browserUrl} ctlRef={ctlRef} products={products} target={target} onApply={onApply} recording={recording} /></div>
      <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid #e3e8ef', background: '#fff', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #eef2f7' }}>
          <div style={{ fontWeight: 800, color: '#002855', fontSize: 14, marginBottom: 8 }}>{tour ? 'Edit demo' : 'Record a demo'}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Demo name (e.g. CFO approval walkthrough)" style={{ width: '100%', padding: '8px 10px', border: '1px solid #d4dbe5', borderRadius: 8, fontSize: 13 }} />
          <button onClick={toggleRec} style={{ width: '100%', marginTop: 8, padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid', borderColor: recording ? '#C54644' : '#0861CE', background: recording ? '#C54644' : '#0861CE', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: recording ? 2 : '50%', background: '#fff', display: 'inline-block' }} />
            {recording ? 'Stop recording' : 'Record — then just use the product'}
          </button>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={capturePage} style={smBtn}>+ This page</button>
            <button onClick={addNote} style={smBtn}>+ Note</button>
          </div>
          {recording && <div style={{ fontSize: 11.5, color: '#0861CE', marginTop: 8, fontWeight: 600 }}>● Recording — every click, typed value, dropdown, date and checkbox in the product (left) is being captured.</div>}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!steps.length && <div style={{ color: '#76859a', fontSize: 12 }}>Log in + open the form on the left, press <strong>● Record</strong>, then fill it out normally — every field you type or choose becomes a step. Press <strong>Stop</strong> when done.</div>}
          {steps.map((s, i) => (
            <div key={i} style={{ background: '#f7f9fc', border: '1px solid #e3e8ef', borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#0861CE' }}>{i + 1}.</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#283e5b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stepLabel(s)}</span>
                <button onClick={() => move(i, -1)} disabled={i === 0} style={tinyBtn}>↑</button>
                <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} style={tinyBtn}>↓</button>
                <button onClick={() => removeAt(i)} style={tinyBtn}>✕</button>
              </div>
              <input value={s.caption} onChange={(e) => setCap(i, e.target.value)} placeholder="what to say here (optional)" style={{ width: '100%', marginTop: 6, padding: '6px 8px', border: '1px solid #d4dbe5', borderRadius: 6, fontSize: 12 }} />
            </div>
          ))}
        </div>
        {err && <div style={{ color: '#C54644', fontSize: 12, padding: '0 12px 8px' }}>{err}</div>}
        <div style={{ padding: 12, borderTop: '1px solid #eef2f7', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={onClose} style={ctlBtnLight(false)}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...primaryCtl(saving), marginLeft: 'auto' }}>{saving ? 'Saving…' : 'Save demo'}</button>
        </div>
      </div>
    </div>
  );
}

/* PLAY: replay the recorded steps on the real product — navigate / click each step, show the caption,
   advance on Next. Everything happens in the embedded browser (no server, no LLM). */
function TourPlay({ tour, browserUrl, products, target, onApply, onExit }: { tour: RealTour; browserUrl: string; products: RealProduct[]; target: DemoTarget | null; onApply: (t: DemoTarget) => void; onExit: () => void }) {
  const ctlRef = useRef<TourCtl | null>(null);
  const [idx, setIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const steps = tour.steps;
  const product = products.find((p) => p.id === tour.productId) ?? null;

  const runStep = async (i: number) => {
    if (i < 0 || i >= steps.length || busy) return;
    setBusy(true); setIdx(i);
    const s = steps[i];
    const sels = s.selector ? [s.selector] : [];
    try {
      if (s.kind === 'navigate' && s.url) { ctlRef.current?.navigate(s.url); await wait(1500); }
      else if (s.kind === 'click') { await ctlRef.current?.click(s.label || '', sels); await wait(1200); }
      else if (s.kind === 'input' || s.kind === 'select' || s.kind === 'check') { await ctlRef.current?.setField(sels, s.label || '', s.value || '', s.kind); await wait(1100); }
      // 'note' → caption only, no product action
    } catch { /* */ }
    setBusy(false);
  };
  const cur = idx >= 0 ? steps[idx] : null;
  const atFirst = idx <= 0; const atLast = idx >= steps.length - 1;
  const status = idx < 0 ? `${tour.name} · ${steps.length} step${steps.length === 1 ? '' : 's'}` : `${tour.name} · Step ${idx + 1} / ${steps.length}`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><TourBrowser initialUrl={browserUrl} ctlRef={ctlRef} products={products} target={target} onApply={onApply} /></div>
      {cur && cur.caption && <div className="tour-caption">{cur.caption}</div>}
      {/* Native control — the SAME .transport bar Ask/Reel use (not a bespoke overlay). */}
      <div className="transport">
        <div className={`agent-status ${busy ? 'run' : ''}`}>
          <span className="agent-status__dot" />
          <div><div className="agent-status__l">Guided demo</div><div className="agent-status__s">{status}</div></div>
        </div>
        <div className="tp-btns">
          <button className="tp-btn" onClick={() => runStep(0)} disabled={busy} title="Restart from the first step"><Icon name="restart" size={14} /></button>
          <button className="tp-btn" onClick={() => runStep(idx - 1)} disabled={atFirst || busy} title="Previous step" style={{ opacity: atFirst || busy ? .4 : 1 }}><Icon name="step" size={14} style={{ transform: 'scaleX(-1)' }} /></button>
          <button className="tp-run" onClick={() => (idx < 0 ? runStep(0) : atLast ? onExit() : runStep(idx + 1))} title={idx < 0 ? 'Start the demo' : atLast ? 'Finish' : 'Next step'}>
            <Icon name={busy ? 'pause' : 'play'} size={15} className="solid" /> {idx < 0 ? 'Start' : atLast ? 'Finish' : busy ? 'Working…' : 'Next step'}
          </button>
          <button className="tp-ctl" onClick={onExit}>Exit</button>
        </div>
        <div className="loop" style={{ justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--cr-fg3)' }}>{product?.name ?? 'po.vin'}</span>
        </div>
      </div>
    </div>
  );
}

/* V5 Phase 4 — Start Experience: an OPTIONAL pre-flight ABOVE Ask/Talk/Reel/Scripted. Reads the current
   product's authored journeys / outcomes / buying committee (from the web SSOT) and lets the operator review
   the experience and pick a journey — which sets the opening scenario and drops into Ask. FULLY ISOLATED: it
   never touches the LiveBrowser / TargetPicker / TourRunner render (mirrors how Scripted is isolated).
   Skippable — picking any other tab goes straight to today's flow. */
/* Readable foreground for a filled swatch: dark navy on light brand colors (e.g. the gold #B9975B), white on
   dark ones — so the ▶ Start label never washes out. Relative luminance of the sRGB color (0..1). */
function readableOn(color: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((color || '').trim());
  if (!m) return '#fff';
  let h = m[1]; if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#0a1f3c' : '#fff';
}

/* Launcher = the home screen: ALL products, each with its list of JOURNEYS. Click a journey → VIN logs into
   the live product and the voice-led WALK begins. (Isolated, like Scripted — no LiveBrowser/TargetPicker.) */
function StartExperience({ products, target, onApply, onLaunch }: { products: RealProduct[]; target: DemoTarget | null; onApply: (t: DemoTarget) => void; onLaunch: (m: 'ask' | 'talk') => void }) {
  // Products that actually HAVE a journey are the launch choices; empty ones list under a muted footer in the rail.
  const withJourneys = products.filter((p) => (p.journeys ?? []).length);
  const without = products.filter((p) => !(p.journeys ?? []).length);
  const [selId, setSelId] = useState('');
  const [q, setQ] = useState('');
  const sel = withJourneys.find((p) => p.id === selId) ?? withJourneys[0];
  // Click a journey → pin the product + journey on the target and start the voice-led walk. The engine logs
  // into the live product (adapter.open) and walks the journey's story_flow, narrating each step.
  const launch = (p: RealProduct, j: RealJourney) => {
    // RC-27: a journey with broken steps silently degrades to free navigation for those steps. Don't launch
    // one into a buyer demo without an explicit operator confirmation.
    if (j.missingCount > 0 && !window.confirm(`“${j.name}” has ${j.missingCount} broken step${j.missingCount > 1 ? 's' : ''} — VIN will fall back to free navigation for those. Launch anyway?`)) return;
    onApply({ productId: p.id, host: p.domain, mk: p.mk, color: p.color, role: target?.role ?? 'admin', mode: p.defaultMode ?? target?.mode ?? 'read-only', url: '', scenario: '', journeyId: j.id });
    onLaunch('talk');
  };
  if (!products.length) return <div style={{ flex: 1, display: 'grid', placeItems: 'center', opacity: .6 }}>Loading products…</div>;

  const needle = q.trim().toLowerCase();
  const journeys = (sel?.journeys ?? []).filter((j) => !needle || `${j.name} ${j.businessGoal} ${j.outcomeTitle} ${(j.stakeholderNames ?? []).join(' ')}`.toLowerCase().includes(needle));

  return (
    <div className="cr-stagearea" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '15px 22px', borderBottom: '1px solid var(--cr-line)', flexShrink: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--cr-fg)' }}>Pick a journey to demo</div>
        <div style={{ color: 'var(--cr-fg2)', fontSize: 12.5, marginTop: 3 }}>Choose a product, then a journey — VIN logs into the live product and the voice-led walk begins.</div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* ── Product rail (master) ── */}
        <div style={{ width: 250, flexShrink: 0, borderRight: '1px solid var(--cr-line)', overflow: 'auto', padding: '10px 10px 16px', background: 'var(--cr-panel)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--cr-fg3)', padding: '6px 8px' }}>Products</div>
          {withJourneys.map((p) => (
            <button key={p.id} className="cr-prodbtn" aria-selected={sel?.id === p.id} onClick={() => { setSelId(p.id); setQ(''); }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: p.color || 'var(--cr-accent)', flexShrink: 0 }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13, color: 'var(--cr-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--cr-fg3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.domain}</span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--cr-fg3)' }}>{(p.journeys ?? []).length}</span>
            </button>
          ))}
          {without.length > 0 && (
            <>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--cr-fg3)', padding: '16px 8px 6px' }}>No journeys yet</div>
              {without.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', opacity: .5 }} title="Author a journey in the web console → Pipeline → Journeys">
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: p.color || 'var(--cr-fg3)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: 'var(--cr-fg2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* ── Journeys for the selected product (detail) ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {sel ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--cr-line)', flexShrink: 0 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: sel.color || 'var(--cr-accent)', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--cr-fg)' }}>{sel.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--cr-fg3)' }}>{sel.domain} · {(sel.journeys ?? []).length} journeys</div>
                </div>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search journeys…"
                  style={{ marginLeft: 'auto', flex: '0 1 280px', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--cr-line)', background: 'var(--cr-panel)', color: 'var(--cr-fg)', fontSize: 13 }} />
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
                {journeys.length === 0 ? <div style={{ opacity: .6, padding: 20 }}>No journeys match “{q}”.</div>
                  : <div className="cr-launch-grid">
                      {journeys.map((j) => {
                        const label = j.name.replace(/^Assembled\s+[—-]\s+/, '');
                        const sub = j.outcomeTitle && j.outcomeTitle !== label ? j.outcomeTitle : (j.businessGoal && j.businessGoal !== label ? j.businessGoal : '');
                        return (
                          <button key={j.id} className="cr-jcard" onClick={() => launch(sel, j)} title={`Log into ${sel.name} and walk "${j.name}"`}>
                            <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--cr-fg)', lineHeight: 1.3 }}>{label}</div>
                            {sub && <div style={{ color: 'var(--cr-fg2)', fontSize: 12, lineHeight: 1.4 }}>{sub}</div>}
                            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 8 }}>
                              <span style={{ color: 'var(--cr-accent)', fontWeight: 800, fontSize: 12.5 }}>▶ Start</span>
                              {j.missingCount > 0
                                ? <span style={{ color: 'var(--cr-warn)', background: 'var(--cr-warn-bg)', border: '1px solid var(--cr-warn-bd)', borderRadius: 999, padding: '1px 8px', fontSize: 10.5, fontWeight: 700 }}>{j.missingCount} broken</span>
                                : (j.status && j.status !== 'active' ? <span style={{ color: 'var(--cr-fg3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 800 }}>{j.status}</span> : null)}
                            </div>
                          </button>
                        );
                      })}
                    </div>}
              </div>
            </>
          ) : <div style={{ flex: 1, display: 'grid', placeItems: 'center', opacity: .6, padding: 24, textAlign: 'center' }}>No journeys yet — author one in the web console → Pipeline → Journeys.</div>}
        </div>
      </div>
    </div>
  );
}

export default function ControlRoom({ onLogout }: { onLogout?: () => void } = {}) {
  // Input mode: ASK = live interactive (type any question), REEL ('live') = canned 3-question run on
  // the real engine, SCRIPTED = offline canned beats (QA). All three render the same panels.
  type RT = 'start' | 'ask' | 'talk' | 'live' | 'scripted';
  // Always open on the Start launcher (the journey-selection home: all products + their journeys). The other
  // modes live behind the ⚙ gear; setMode still persists within a session, but each launch lands here so a
  // journey is always selectable (a stale stored mode must never hide the launcher).
  const [runtime, setRuntime] = useState<RT>('start');
  const setMode = (m: RT) => { setRuntime(m); try { localStorage.setItem('vd-runtime', m); } catch { /* */ } };
  const isLive = runtime === 'live';
  const engine = runtime !== 'scripted' && runtime !== 'start'; // ask + reel both consume the real streamed engine state; start = offline pre-flight
  const scriptedMode = runtime === 'scripted'; // REAL scripted workflow runner (isolated ScriptedRunner), not the old beats theater
  const startMode = runtime === 'start'; // V5 Phase 4 — Start Experience pre-flight (isolated; no live session, mirrors scripted's isolation)

  // Scripted playback state (QA).
  const [idx, setIdx] = useState(() => { try { return parseInt(localStorage.getItem('vd-cr-beat') || '0', 10); } catch { return 0; } });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [secs, setSecs] = useState(0); // real elapsed-session clock (engine: ticks while running; scripted: while playing)
  // Live engine session.
  const { live, start, startInteractive, ask, stop, pushEvent, reset } = useLiveSession();
  const vcRef = useRef<VoiceClient | null>(null);
  const browserCtl = useRef<{ snapshot: () => Promise<any>; clickRef: (r: number) => Promise<any>; typeInto: (r: number, v: string) => Promise<any>; selectOption: (r: number, v: string) => Promise<any>; comboPick: (r: number, v: string) => Promise<any> } | null>(null);
  const driving = useRef(false);
  const [driveActive, setDriveActive] = useState(false);
  const [voiceState, setVoiceState] = useState<string>('idle');
  const [listening, setListening] = useState(false);
  const [autoWalk, setAutoWalk] = useState(false); // V5 voice-walk: auto-advance vs operator-paced (Next ▶)
  const [modeMenu, setModeMenu] = useState(false);  // demo-mode picker tucked behind the gear
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
  const advanceWalk = () => vcRef.current?.next(); // advance the voice-led journey walk one step

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
    ? { productId: target.productId || undefined, role: target.role, mode: target.mode, url: target.url || undefined, scenario: target.scenario || undefined, clientNav: '1', journeyId: target.journeyId || undefined }
    : undefined;
  const tkey = target ? `${target.productId}|${target.role}|${target.mode}|${target.url}|${target.scenario}|${target.journeyId ?? ''}` : '';
  // The URL the embedded browser opens: an explicit override/ad-hoc URL, else the product's domain.
  const browserUrl = target ? (target.url?.trim() ? (/^https?:\/\//.test(target.url) ? target.url : `https://${target.url.replace(/^https?:\/\//, '')}`) : `https://${target.host}`) : '';

  // Active specialist persona (hand-off). Approved personas available for the current site (or unassigned).
  const [activePersona, setActivePersona] = useState<RealPersona | null>(null);
  const specialists = (real?.personas ?? []).filter((p) => p.status === 'approved' && !p.archived && (p.lead || !p.productIds.length || (target ? p.productIds.includes(target.productId) : true)));
  const handoffSpecialist = (p: RealPersona | null) => {
    const fromId = activePersona?.id ?? null;
    setActivePersona(p);
    // Pass the real sessionId so the hand-off is recorded in ALL modes (Talk/Reel too), not only when an
    // interactive SSE happens to be open. The engine then activates the specialist's overlay for next turns.
    (window as unknown as { session?: { handoff(x: any): void } }).session?.handoff?.({ fromId, toId: p?.id ?? null, sessionId: live.sessionId ?? undefined, trigger: 'operator' });
    pushEvent({ type: 'message', side: 'ai', who: p?.name ?? 'Consultant', role: 'VIN Demo', text: p ? `Handing off to the ${p.name} — I'll focus on their scope and stay within their guardrails.` : 'Back to the Lead Consultant.' });
  };
  // Act on a hand-off SUGGESTION (the consultant proposed a better specialist) — match by name, then hand off.
  const handoffByName = (name: string) => {
    const p = (real?.personas ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase() || x.name.toLowerCase().includes(name.toLowerCase()));
    if (p) handoffSpecialist(p);
    // No matching specialist on the roster → say so instead of silently doing nothing (the chip click looked dead).
    else pushEvent({ type: 'message', side: 'ai', who: 'Consultant', role: 'VIN Demo', text: `I don't have a "${name}" specialist on the roster to bring in — I'll stay with the current consultant.`, uncertain: true });
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

  // V5 voice-walk auto-advance — keyed on turn_done (live.turnSeq), NOT voiceState. A step's turn_done fires
  // only AFTER its narration completes AND the engine is idle, so the timer can never fire before step 0 is
  // spoken (the premature-advance race) and never lands mid-step (no swallowed/wasted advance). Pauses while
  // the mic is open; stops at journey end; manual mode (autoWalk=false) never fires.
  const isJourneyWalk = runtime === 'talk' && !!target?.journeyId;
  useEffect(() => {
    if (!isJourneyWalk || !autoWalk) return;
    if (!live.journeyName || live.journeyDone || live.turnSeq === 0) return; // wait for the first completed step
    if (listening) return;
    const t = setTimeout(() => vcRef.current?.next(), 1800);
    return () => clearTimeout(t);
  }, [isJourneyWalk, autoWalk, live.journeyName, live.journeyDone, live.turnSeq, listening]);

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
  // Engine modes: reset the clock when a new real session starts, then tick while it's running.
  useEffect(() => { if (engine) setSecs(0); }, [engine, live.sessionId]);
  useEffect(() => {
    if (engine && (live.running || live.ready)) {
      const t = setInterval(() => setSecs((s) => s + 1), 1000);
      return () => clearInterval(t);
    }
  }, [engine, live.running, live.ready]);

  // Unified render inputs from whichever runtime is active.
  const scriptedBeat = BEATS[idx];
  const liveBeat: Beat = { loopIdx: live.loopIdx, planIdx: Math.min(Math.max(live.loopIdx, 0), PLAN.length - 1), phase: live.phase, brain: live.brain, sub: live.sub, screen: 'dashboard', conf: live.conf, activeStk: 's1', cost: live.cost, cite: null, loopDone: live.done, push: [] };
  const beat = engine ? liveBeat : scriptedBeat;
  const messages = engine ? live.messages : [...SEED, ...BEATS.slice(1, idx + 1).flatMap((b) => b.push || [])];
  const typing = engine ? (live.running || driveActive) : (playing && idx > 0 && idx < BEATS.length - 1);
  const canAsk = runtime === 'ask' ? (live.ready && !live.running && !driveActive)
    : runtime === 'talk' ? (voiceState === 'ready' && !listening && !driveActive) : false;
  // ── Talk-vs-Ask drive boundary ───────────────────────────────────────────────────────────────────
  // TALK (runtime==='talk'): voice. Spoken input → STT → server runTurn (answer · navigate · explain) →
  //   TTS. Conversational — it SHOWS and EXPLAINS screens, but does not drive multi-step forms. (Typed
  //   text in Talk also flows server-side via the voice channel.)
  // ASK  (runtime==='ask'): typed. WITH a live embedded browser → driveGoal() below = the agentic
  //   perceive→reason→act loop that steps THROUGH a multi-step flow (e.g. fill out a new-PO form). WITHOUT
  //   a live pane → it falls back to ask() = a server runTurn (answer · navigate), same brain as Talk.
  // Both default READ-ONLY: a CONFIRMED mutating click (Submit/Approve/Pay) is refused engine-side at
  //   /agent/step regardless of mode UNLESS the operator chose EXECUTION; the loop then stops and hands back.
  //
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
    let lastSig = ''; let repeats = 0; let finished = false; const filledDates = new Set<string>();
    try {
      for (let i = 0; i < 32; i++) { // a 5-step wizard needs many actions; stuck-detection + `done` end it early
        const page = await ctl.snapshot().catch(() => null);
        if (!page) { say("I can't read the page yet — make sure it's loaded (and you're logged in), then ask again.", true); finished = true; break; }
        // ── Deterministic date safety net ──────────────────────────────────────────────────────────────
        // The model is unreliable on native date inputs (a calendar popup isn't clickable), so BEFORE asking
        // it, fill any empty date/time field visible on this step directly with a valid FUTURE date — once
        // each (tracked by label). This guarantees the wizard never stalls on a "Needed by" gate regardless
        // of the model, and without spending an agent step. The snapshot only lists visible elements, so this
        // is scoped to the current wizard step.
        const dueDates = (Array.isArray(page.elements) ? page.elements : []).filter((e: any) =>
          /^(date|datetime-local|month|week|time)$/.test(String(e.kind || '')) && !e.filled && !filledDates.has(String(e.text || e.ref)));
        if (dueDates.length) {
          for (const f of dueDates) { filledDates.add(String(f.text || f.ref)); await ctl.typeInto(f.ref, '').catch(() => {}); } // '' → filler synthesizes a valid future date
          say(dueDates.length === 1 ? `I'll set ${dueDates[0].text && dueDates[0].text !== 'dd/mm/yyyy' ? `“${dueDates[0].text}”` : 'the required date'} to a valid date in the future.` : `I'll set the date fields to valid future dates.`);
          await wait(900); continue; // re-perceive so the model sees them filled and advances
        }
        const res = await api.agentStep({ goal, page, history, role: target?.role, mode: target?.mode, personaId: activePersona?.id, sessionId: live.sessionId ?? undefined, productId: target?.productId });
        if (!res) { say('Lost the connection to the engine for a moment — try again.', true); finished = true; break; }
        // RC-29: detect a repeated action BEFORE narrating, so an action that didn't visibly take (e.g. a custom
        // dropdown re-read as empty) is retried quietly instead of re-narrated to the buyer ("set it to Asset
        // once more"×N). The 'done' hand-back is always spoken.
        const tgt = Array.isArray(page.elements) ? page.elements.find((e: any) => e.ref === res.ref) : null;
        const sig = `${res.action}:${tgt?.text ?? res.ref}:${res.value ?? ''}`; // RC-22: key stuck-detection on the element's stable TEXT (refs are re-stamped every snapshot), not the volatile ref
        const repeated = sig === lastSig;
        if (res.say && (!repeated || res.action === 'done')) { say(res.say, res.action === 'done' && i === 0 ? false : undefined); history.push(res.say); }
        if (res.action === 'done') { finished = true; break; }
        // Date/time fields: a native calendar popup isn't DOM-clickable, so the executor (typeInto/clickRef)
        // coerces the value into a valid FUTURE date and fills it directly. Because that ALWAYS makes the
        // field non-empty on the next snapshot, route any action on a temporal target to the filler AND
        // exempt it from stuck-detection so a repeated value never trips the "I've gone as far as I can"
        // hand-back. This is the fix for the date-picker stall.
        const tKind = String(tgt?.kind || ''), tRole = String(tgt?.role || '');
        const temporal = /^(date|datetime-local|month|week|time)$/.test(tKind);
        // A dropdown the resolver should handle: native <select>, an ARIA combobox/listbox, or anything the
        // model issued `select` on. (A searchable typeahead the snapshot saw as a plain text input is caught
        // live inside clickRef/typeInto via __vinIsCombo.) These resolve atomically and may keep their input
        // visually empty after selection, so they must NOT count as a stuck repeat.
        const dropdown = tKind === 'select' || tRole === 'combobox' || tRole === 'listbox' || (Array.isArray(tgt?.options) && tgt.options.length > 0);
        // Never freeze: a repeated NON-resolving action is stuck — hand the wheel back gracefully. Temporal,
        // dropdowns, and any `select` are exempt (they always make progress on the real control).
        repeats = repeated ? repeats + 1 : 0;
        lastSig = sig;
        // Never freeze, never loop forever. A non-resolving REPEAT hands the wheel back. Temporal always makes
        // progress (exempt). Dropdowns/`select` get ONE extra pass (a custom control can need a second try) but
        // a 3rd identical attempt means it isn't taking — hand off instead of looping ("set it to Asset once more"×N).
        if (!temporal && repeats >= ((dropdown || res.action === 'select') ? 2 : 1)) {
          say("I've set what I can on that field — could you confirm it, then tell me to continue? I'll pick it right back up.", true); finished = true; break;
        }
        if (temporal) await ctl.typeInto(res.ref, res.value ?? '').catch(() => {});                 // click/type/select on a date field → future-date filler
        else if (res.action === 'select' || (dropdown && res.action === 'click')) {                 // any dropdown → open + filter + pick, in one shot
          const r = await ctl.comboPick(res.ref, res.value ?? '').catch(() => null);
          // RC-25: act on the executor's VERIFIED result — if the resolver genuinely found no matching option,
          // tell the model so it stops re-issuing the same value (don't wait for stuck-detection to catch it).
          if (r && r.ok === false && (r.reason === 'no-match' || r.reason === 'code-mismatch')) history.push(`(Note: "${res.value}" was not found in that list — pick a different value or hand off; do not repeat it.)`);
        }
        else if (res.action === 'click') await ctl.clickRef(res.ref).catch(() => {});               // (clickRef itself resolves a typeahead it detects live)
        else if (res.action === 'type') await ctl.typeInto(res.ref, res.value ?? '').catch(() => {});
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
        <div className="cr-strip__live"><span className="rec" /><span>{runtime === 'start' ? 'Start Experience' : runtime === 'scripted' ? 'Scripted' : runtime === 'ask' ? 'Ask · live' : runtime === 'talk' ? 'Talk · live' : 'Reel · live'}</span></div>
        <div className="cr-strip__meta"><b>{activePersona?.name ?? 'Lead Consultant'}</b> · {(engine && target?.host) || (target?.host ?? 'po.vin')} · {target?.scenario?.trim() ? target.scenario.trim().slice(0, 40) : 'Interactive'}</div>
        <div className="cr-strip__spacer" />
        <div style={{ position: 'relative' }}>
          <button onClick={() => setModeMenu((v) => !v)} className="cr-icon-btn" title="Demo modes (Start · Ask · Talk · Reel · Scripted)" style={{ fontSize: 16 }}>⚙</button>
          {modeMenu && (
            <div style={{ position: 'absolute', right: 0, top: '120%', zIndex: 60, background: 'var(--color-navy, #001b3a)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: 4, minWidth: 168, boxShadow: '0 10px 28px rgba(0,0,0,.45)' }}>
              {([['start', 'Start · launcher'], ['ask', 'Ask · type'], ['talk', 'Talk · voice'], ['live', 'Reel · canned'], ['scripted', 'Scripted · recorder']] as [RT, string][]).map(([m, lbl]) => (
                <button key={m} onClick={() => { setMode(m); setModeMenu(false); }} style={{ ...SEG_BTN, display: 'block', width: '100%', textAlign: 'left', textTransform: 'none', letterSpacing: 0, fontSize: 12, padding: '7px 10px', ...(runtime === m ? SEG_ON : {}) }}>{lbl}</button>
              ))}
            </div>
          )}
        </div>
        <span className={`cr-mode ${MODE_META[mode].cls}`} title="Read-only is the AI agent's limit — it never fires a mutating action. You're logged in yourself and have full control of your live session; take over and click anything, anytime."><Icon name={MODE_META[mode].icon} size={12} /> {MODE_META[mode].label}</span>
        <span className="cr-clock">{fmt(secs)}</span>
        <a className="cr-icon-btn" href="https://demofor.vin" target="_blank" rel="noreferrer" title="Back to console"><Icon name="external" size={16} /></a>
        <button className="cr-icon-btn" onClick={onLogout} title="Log out"><Icon name="logout" size={16} /></button>
      </div>

      {isJourneyWalk && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', background: 'var(--cr-navy, #002855)', color: '#fff', borderBottom: '1px solid rgba(0,0,0,.2)', flexShrink: 0 }}>
          {live.journeyName ? <>
            <span style={{ fontWeight: 800, fontSize: 12.5 }}>▶ {live.journeyName}</span>
            <span style={{ opacity: .7, fontSize: 12 }}>{live.journeyDone ? 'Complete' : `Step ${Math.min(live.journeyStep + 1, live.journeyTotal || 1)} / ${live.journeyTotal || '…'}`}</span>
            <div style={{ flex: 1 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', opacity: .85 }} title="Auto-advance through steps, or click Next yourself">
              <input type="checkbox" checked={autoWalk} onChange={(e) => setAutoWalk(e.target.checked)} /> Auto-advance
            </label>
            <button disabled={live.journeyDone || voiceState !== 'ready'} onClick={advanceWalk} style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: (live.journeyDone || voiceState !== 'ready') ? 'rgba(255,255,255,.12)' : '#0097A9', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: (live.journeyDone || voiceState !== 'ready') ? 'default' : 'pointer' }}>{live.journeyDone ? '✓ Done' : 'Next ▶'}</button>
          </> : <>
            {/* RC-28: surface the connect → login → prepare PHASE instead of a static label, so the multi-second
                live-product login isn't silent dead-air in front of the buyer. */}
            <span style={{ fontSize: 12.5, color: voiceState === 'error' ? '#ff9b9b' : '#e8a33d' }}>
              {live.error ? live.error
                : voiceState === 'connecting' ? 'Connecting to the engine…'
                : voiceState === 'error' ? 'Voice connection failed — check mic/network and relaunch.'
                : voiceState === 'ready' ? 'Logging into the live product…'
                : 'Preparing the journey…'}
            </span>
            <div style={{ flex: 1 }} />
          </>}
          {/* Voice selection for the journey — the unified catalog (Google Neural2 + your ElevenLabs voices);
              switches live mid-walk via the WS 'voice' control. ElevenLabs voices appear only when its key is set. */}
          {live.voices.length > 0 && (
            <select value={live.voice} onChange={(e) => vcRef.current?.setVoice(e.target.value)} title="Voice for this journey — Google Neural2 or your ElevenLabs voices"
              style={{ padding: '4px 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,.2)', background: 'var(--cr-navy, #002855)', color: '#fff', fontSize: 12, maxWidth: 230, cursor: 'pointer' }}>
              {live.voices.map((v) => <option key={v.id} value={v.id} style={{ color: '#000' }}>{v.label}</option>)}
            </select>
          )}
          <button onClick={() => { stopVoice(); setMode('start'); }} title="Back to the launcher" style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: '#fff', fontSize: 12, cursor: 'pointer' }}>Exit</button>
        </div>
      )}
      <div className="cr-body">
        {startMode ? <StartExperience products={products} target={target} onApply={setTarget} onLaunch={setMode} />
        : scriptedMode ? <TourRunner products={products} target={target} onApplyTarget={setTarget} /> : <>
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
          onKill={engine ? stop : undefined} target={target} activePersona={activePersona}
          handoffSuggestion={engine ? live.handoffSuggestion : null} onHandoff={handoffByName} engine={engine}
          liveCite={engine ? live.cite : undefined} liveCost={engine ? { total: live.cost, byType: live.byType } : undefined} />
        </>}
      </div>

      {!scriptedMode && !startMode && !isJourneyWalk && <Transport beat={beat} idx={idx} playing={playing} speed={speed}
        live={engine} liveRunning={live.running} liveDone={live.done}
        onPlay={() => { if (runtime === 'live') { if (live.running) stop(); else start(targetParams); } else if (runtime === 'ask') { if (live.running) stop(); else startInteractive(targetParams); } else { if (idx >= BEATS.length - 1) { setIdx(0); setSecs(0); } setPlaying((p) => !p); } }}
        onStep={() => setIdx((i) => Math.min(i + 1, BEATS.length - 1))}
        onBack={() => setIdx((i) => Math.max(i - 1, 0))}
        onRestart={() => { setIdx(0); setPlaying(false); setSecs(0); }}
        onSpeed={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))} />}
    </div>
  );
}
