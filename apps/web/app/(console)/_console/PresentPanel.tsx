'use client';
/* Present — the GUIDED / SCRIPTED demo player. Connects to the engine's /session/scripted SSE for one
   workflow: the engine logs into the REAL product and walks the workflow's screens in FIXED order,
   streaming a screenshot + your authored caption per step. NO LLM in the loop — deterministic, the
   "click-to-present" path. Advance with Next/Prev (POST /session/advance). Reuses the same engine token
   mint as Ask VIN (/api/voice/token); the screenshot stream is the same plumbing Ask VIN already uses. */
import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { Icon } from './shell';

interface StepInfo { index: number; label: string; status: string; hasCaption?: boolean }
type Status = 'connecting' | 'ready' | 'navigating' | 'done' | 'error';

export function PresentPanel({ workflowId, title, onClose }: { workflowId: string; title: string; onClose: () => void }) {
  const [status, setStatus] = useState<Status>('connecting');
  const [shot, setShot] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [cur, setCur] = useState<{ index: number; total: number; label: string; caption: string; status: string } | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const cfg = useRef<{ token: string; engineUrl: string } | null>(null);

  const handle = useCallback((ev: any) => {
    switch (ev?.type) {
      case 'start': setSteps(Array.isArray(ev.steps) ? ev.steps : []); setStatus('ready'); break;
      case 'connecting': setStatus('navigating'); break;
      case 'step': setCur({ index: ev.index, total: ev.total, label: ev.label, caption: ev.caption ?? '', status: ev.status ?? '' }); setNote(''); setStatus('navigating'); break;
      case 'nav': if (ev.screenshot) setShot(ev.screenshot); if (ev.url) setUrl(ev.url); setNote(ev.navOk ? '' : (ev.navNote || '')); setStatus('ready'); break;
      case 'message': setNote(ev.text || ''); break;
      case 'done': setStatus('done'); break;
      case 'error': setErr(ev.message || 'Engine error.'); setStatus('error'); break;
    }
  }, []);

  // One scripted session per mounted panel. A short delay lets any prior engine session close first.
  useEffect(() => {
    let es: EventSource | null = null; let closed = false;
    setStatus('connecting'); setErr('');
    (async () => {
      if (!cfg.current) { const r = await fetch('/api/voice/token'); if (!r.ok) { setErr('Could not authorize the demo session.'); setStatus('error'); return; } cfg.current = await r.json(); }
      await new Promise((res) => setTimeout(res, 350));
      if (closed || !cfg.current) return;
      es = new EventSource(`${cfg.current.engineUrl}/session/scripted?token=${encodeURIComponent(cfg.current.token)}&workflowId=${encodeURIComponent(workflowId)}`);
      es.onmessage = (e) => { let ev: any; try { ev = JSON.parse(e.data); } catch { return; } handle(ev); };
      es.onerror = () => { if (!closed) setStatus((s) => (s === 'connecting' ? 'error' : s)); es?.close(); };
    })();
    return () => { closed = true; es?.close(); };
  }, [workflowId, handle]);

  const cmd = useCallback((dir: 'next' | 'back' | 'goto', index?: number) => {
    if (!cfg.current) return;
    setStatus('navigating');
    fetch(`${cfg.current.engineUrl}/session/advance?token=${encodeURIComponent(cfg.current.token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, index }) }).catch(() => {});
  }, []);

  const idx = cur?.index ?? -1; const total = cur?.total ?? steps.length;
  const atFirst = idx <= 0; const atLast = total > 0 && idx >= total - 1;
  const navving = status === 'navigating' || status === 'connecting';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(6,12,22,.93)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', color: '#fff' }}>
        <span style={{ width: 28, height: 28, borderRadius: 7, background: '#0861CE', display: 'grid', placeItems: 'center' }}><Icon name="play" size={13} fill /></span>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div><div style={{ fontSize: 12, opacity: .7 }}>{statusLabel(status)}{url ? ` · ${url}` : ''}</div></div>
        <div style={{ fontSize: 13, opacity: .85 }}>{total ? `Step ${Math.max(idx + 1, 1)} / ${total}` : ''}</div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}><Icon name="x" size={15} /> Exit</button>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 18px', overflow: 'hidden' }}>
        {err ? <div style={{ color: '#f0807d', maxWidth: 540, textAlign: 'center', fontSize: 14 }}>{err}</div>
          : shot ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={shot} alt={cur?.label ?? 'screen'} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10, boxShadow: '0 14px 50px rgba(0,0,0,.5)', objectFit: 'contain' }} />
          : <div style={{ color: '#9fb0c4', fontSize: 14 }}>{navving ? 'Navigating to the screen…' : 'Connecting to the live product…'}</div>}
      </div>

      <div style={{ background: '#0b1626', color: '#fff', padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        {cur && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, opacity: .6, marginBottom: 3 }}>{cur.label}{cur.status && cur.status !== 'verified' ? ` · ${cur.status}` : ''}</div>
            <div style={{ fontSize: 16, lineHeight: 1.5 }}>{cur.caption || <span style={{ opacity: .55 }}>No caption for this screen — add one in the Workflow Builder.</span>}</div>
            {note && <div style={{ fontSize: 12, color: '#f4c150', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="info" size={12} /> {note}</div>}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => cmd('back')} disabled={atFirst || navving} style={btn(atFirst || navving)}><Icon name="chevR" size={15} style={{ transform: 'rotate(180deg)' }} /> Prev</button>
          {atLast
            ? <button onClick={onClose} style={primaryBtn(false)}>Finish</button>
            : <button onClick={() => cmd('next')} disabled={navving} style={primaryBtn(navving)}>{navving ? 'Loading…' : 'Next'} <Icon name="chevR" size={15} /></button>}
          <button onClick={() => cmd('goto', 0)} disabled={navving} style={btn(navving)} title="Restart from the first screen">Restart</button>
          <div style={{ display: 'flex', gap: 5, marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
            {steps.map((s) => <button key={s.index} onClick={() => cmd('goto', s.index)} title={s.label} disabled={navving} style={{ width: 22, height: 8, borderRadius: 99, border: 'none', cursor: navving ? 'default' : 'pointer', background: s.index === idx ? '#0861CE' : 'rgba(255,255,255,.22)' }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function statusLabel(s: Status) { return { connecting: 'Connecting…', ready: 'Live · read-only', navigating: 'Navigating…', done: 'Demo complete', error: 'Connection error' }[s]; }
function btn(disabled: boolean): CSSProperties { return { background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', borderRadius: 8, padding: '9px 14px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .5 : 1, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }; }
function primaryBtn(disabled: boolean): CSSProperties { return { background: '#0861CE', border: 'none', color: '#fff', borderRadius: 8, padding: '9px 18px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .7 : 1, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700 }; }
