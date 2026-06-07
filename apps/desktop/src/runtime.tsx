/* VIN Demo — Control Room runtime (ported 1:1 from desktop/runtime.jsx).
   Plays the demo-loop beats. Stage = the demoed product; one collapsible right panel
   with Conversation (default) / Brief / Reasoning; an AI-consultant control bar. */
import { useState, useEffect, useRef } from 'react';
import { Icon, MODE_META, VALIDATION } from './shell';
import { VD } from './data';
import { LOOP, PLAN, QUOTES, SEED, BEATS, type Beat, type Msg } from './beats';
import { DemoApp } from './demo-app';

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

function CostMeter({ cost }: { cost: number }) {
  const rows = VD.costBreakdown;
  return (
    <div className="cost-meter">
      <div className="cost-total"><span className="cost-total__val">${cost.toFixed(2)}</span><span className="cost-total__label">this demo · tagged to session</span></div>
      <div className="cost-rows">
        {rows.map((r) => (
          <div className="cost-row" key={r.k}>
            <span className="cost-row__k"><i className="swatch" style={{ background: r.color }} />{r.k}</span>
            <span className="cost-row__bar"><i style={{ width: `${r.pct}%`, background: r.color }} /></span>
            <span className="cost-row__v">${(cost * r.pct / 100).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Citation({ id }: { id: string | null }) {
  if (!id) return <div className="brain-now" style={{ color: 'var(--cr-fg3)', fontSize: 12 }}>No knowledge retrieved yet for the current step.</div>;
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
        <div className="cite__quote">&quot;{QUOTES[id] || 'Retrieved passage.'}&quot;</div>
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
  return (
    <div className="cr-col cr-left">
      <div className="cr-sec">
        <div className="cr-sec__title">Session</div>
        <dl className="cr-kv">
          <dt>Department</dt><dd>Procurement</dd>
          <dt>Product</dt><dd>demo.vin · v3.4</dd>
          <dt>Scenario</dt><dd>Approval delegation</dd>
          <dt>Environment</dt><dd>demo-04</dd>
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

function RightRail({ beat, mode }: { beat: Beat; mode: string }) {
  return (
    <div className="cr-col cr-right">
      <div className="cr-sec">
        <div className="cr-sec__title">Execution mode</div>
        <div className="flex between items-center" style={{ gap: 10 }}>
          <span className={`cr-mode ${MODE_META[mode].cls}`}><Icon name={MODE_META[mode].icon} size={12} /> {MODE_META[mode].label}</span>
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
        <Citation id={beat.cite} />
      </div>
      <div className="cr-sec" style={{ borderBottom: 'none' }}>
        <div className="cr-sec__title">Cost · live</div>
        <CostMeter cost={beat.cost} />
      </div>
    </div>
  );
}

function RightPanel({ beat, mode, open, setOpen, tab, setTab, messages, typing }: { beat: Beat; mode: string; open: boolean; setOpen: (b: boolean) => void; tab: string; setTab: (t: string) => void; messages: Msg[]; typing: boolean }) {
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
        {tab === 'convo' && <Convo messages={messages} typing={typing} />}
        {tab === 'brief' && <LeftRail beat={beat} />}
        {tab === 'reasoning' && <RightRail beat={beat} mode={mode} />}
      </div>
    </div>
  );
}

function Stage({ beat, onResolve }: { beat: Beat; onResolve: () => void }) {
  return (
    <div className="stage-wrap">
      <div className="stage-bar">
        <div className="stage-dots"><i /><i /><i /></div>
        <div className="stage-bar__url"><Icon name="lock" size={12} /> https://{beat.screen === 'audit' ? 'demo.vin/audit' : beat.screen === 'delegation' || beat.screen === 'settings' || beat.screen === 'newdelegation' ? 'demo.vin/approvals/' + beat.screen : 'demo.vin/' + (beat.screen === 'dashboard' ? '' : beat.screen)}</div>
        <span className="stage-bar__env">Demo tenant · demo-04</span>
      </div>
      <div className="stage">
        <DemoApp screen={beat.screen} />
        {beat.hl && <div className="ai-highlight" style={{ left: `${beat.hl.x}%`, top: `${beat.hl.y}%`, width: `${beat.hl.w}%`, height: `${beat.hl.h}%` }} />}
        {beat.cursor && <div className="ai-cursor" style={{ left: `${beat.cursor.x}%`, top: `${beat.cursor.y}%` }}>{CURSOR}</div>}
        {beat.callout && (
          <div className="ai-callout below" style={{ left: `${beat.callout.x}%`, top: `${beat.callout.y}%` }}>
            <div className="ai-callout__label">{beat.callout.label}</div>{beat.callout.text}
          </div>
        )}
        {beat.event === 'heal' && (
          <div className="heal-toast" onClick={onResolve} style={{ cursor: 'pointer' }}>
            <span className="heal-toast__spin"><Icon name="refresh" size={18} /></span>
            <div className="heal-toast__txt"><b>Self-healing navigation.</b> <span className="mono">[data-pa=delegation-tab]</span> not found — re-grounding by role + label instead of failing the demo.</div>
          </div>
        )}
        {beat.event === 'block' && (
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
      </div>
    </div>
  );
}

const ASK_CHIPS = ['How does delegation get audited?', 'What about SSO?', 'Show me out-of-office routing', 'Can you submit a real PO?'];

function Convo({ messages, typing }: { messages: Msg[]; typing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [messages.length, typing]);
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
        {ASK_CHIPS.map((c) => <button key={c} className="ask-chip">{c}</button>)}
        <div className="field"><input placeholder="Ask the consultant a question…" /><Icon name="send" size={16} className="solid" style={{ stroke: 'none', fill: 'var(--cr-accent)' }} /></div>
      </div>
    </div>
  );
}

function Transport({ beat, idx, playing, onPlay, onStep, onBack, onRestart, speed, onSpeed }: { beat: Beat; idx: number; playing: boolean; onPlay: () => void; onStep: () => void; onBack: () => void; onRestart: () => void; speed: number; onSpeed: () => void }) {
  const last = idx >= BEATS.length - 1;
  const status = playing ? 'Running the demo on autopilot' : idx === 0 ? 'Standing by — ready to run' : last ? 'Demo complete' : 'Paused — you have the controls';
  return (
    <div className="transport">
      <div className={`agent-status ${playing ? 'run' : ''}`}>
        <span className="agent-status__dot" />
        <div><div className="agent-status__l">AI consultant</div><div className="agent-status__s">{status}</div></div>
      </div>
      <div className="tp-btns">
        <button className="tp-btn" onClick={onRestart} title="Start the demo over"><Icon name="restart" size={14} /></button>
        <button className="tp-btn" onClick={onBack} title="Back one step" disabled={idx <= 0} style={{ opacity: idx <= 0 ? .4 : 1 }}><Icon name="step" size={14} style={{ transform: 'scaleX(-1)' }} /></button>
        <button className="tp-run" onClick={onPlay} title={playing ? 'Pause the agent' : 'Let the agent run'}>
          <Icon name={playing ? 'pause' : 'play'} size={15} className="solid" /> {playing ? 'Pause agent' : last ? 'Run again' : 'Run agent'}
        </button>
        <button className="tp-ctl" onClick={onStep} disabled={last} title="Advance the agent one step (manual drive)"><Icon name="step" size={14} className="solid" /> Step</button>
        <button className="tp-speed" onClick={onSpeed} title="How fast the agent advances">Pace {speed}×</button>
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

export default function ControlRoom() {
  const [idx, setIdx] = useState(() => parseInt(localStorage.getItem('vd-cr-beat') || '0', 10));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState('convo');
  const [secs, setSecs] = useState(724);
  const beat = BEATS[idx];
  const mode = 'read-only';

  useEffect(() => { localStorage.setItem('vd-cr-beat', String(idx)); }, [idx]);
  useEffect(() => { document.getElementById('boot')?.style.setProperty('display', 'none'); }, []);

  useEffect(() => {
    if (!playing) return;
    if (idx >= BEATS.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, BEATS.length - 1)), 2600 / speed);
    return () => clearTimeout(t);
  }, [playing, idx, speed]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [playing]);

  const messages = [...SEED, ...BEATS.slice(1, idx + 1).flatMap((b) => b.push || [])];
  const typing = playing && idx > 0 && idx < BEATS.length - 1;

  return (
    <div className="cr">
      <div className="cr-strip">
        <div className="cr-strip__brand"><img src="./assets/VIN-light.svg" alt="VIN" /><span className="cr-strip__div" />
          <div><div className="cr-strip__product">Demo</div><div className="cr-strip__sub">Control Room</div></div></div>
        <div className="cr-strip__live"><span className="rec" /><span>Live</span></div>
        <div className="cr-strip__meta"><b>Procurement</b> · demo.vin · Approval delegation · <b>{VD.stakeholders.length}</b> stakeholders</div>
        <div className="cr-strip__spacer" />
        <span className={`cr-mode ${MODE_META[mode].cls}`}><Icon name={MODE_META[mode].icon} size={12} /> {MODE_META[mode].label}</span>
        <span className="cr-clock">{fmt(secs)}</span>
        <a className="cr-icon-btn" href="https://demofor.vin" target="_blank" rel="noreferrer" title="Back to console"><Icon name="external" size={16} /></a>
      </div>

      <div className="cr-body">
        <div className="cr-stagearea">
          <Stage beat={beat} onResolve={() => setIdx((i) => Math.min(i + 1, BEATS.length - 1))} />
        </div>
        <RightPanel beat={beat} mode={mode} open={panelOpen} setOpen={setPanelOpen} tab={tab} setTab={setTab} messages={messages} typing={typing} />
      </div>

      <Transport beat={beat} idx={idx} playing={playing} speed={speed}
        onPlay={() => { if (idx >= BEATS.length - 1) { setIdx(0); setSecs(724); } setPlaying((p) => !p); }}
        onStep={() => setIdx((i) => Math.min(i + 1, BEATS.length - 1))}
        onBack={() => setIdx((i) => Math.max(i - 1, 0))}
        onRestart={() => { setIdx(0); setPlaying(false); setSecs(724); }}
        onSpeed={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))} />
    </div>
  );
}
