'use client';
/* Ask VIN — a live, interactive conversation panel for the web console. Connects the browser
   DIRECTLY to the hosted engine: GET /api/voice/token mints a short-lived token, then EventSource
   opens the interactive SSE and POST /session/utterance sends each question. The engine is the brain;
   this is a thin channel. (Voice/STT-TTS layers onto this same path in Phase 2.) */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from './shell';

interface Msg { side: 'them' | 'ai'; who: string; role: string; text: string; tag?: string; uncertain?: boolean }
type Status = 'connecting' | 'ready' | 'answering' | 'busy' | 'error' | 'closed';

const CHIPS = ['How does approval delegation work?', 'What happens when an approver is out of office?', 'Can you submit a real PO?'];

export function AskPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const [shot, setShot] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [cite, setCite] = useState<any>(null);
  const [cost, setCost] = useState(0);
  const [text, setText] = useState('');
  const cfg = useRef<{ token: string; engineUrl: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages.length, status]);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    (async () => {
      try {
        const r = await fetch('/api/voice/token');
        if (!r.ok) { setStatus('error'); return; }
        cfg.current = await r.json();
        if (closed || !cfg.current) return;
        es = new EventSource(`${cfg.current.engineUrl}/session/interactive?token=${encodeURIComponent(cfg.current.token)}`);
        es.onmessage = (e) => {
          let ev: any; try { ev = JSON.parse(e.data); } catch { return; }
          switch (ev.type) {
            case 'start': setUrl(ev.product ? `https://${ev.product}` : ''); break;
            case 'ready': setStatus('ready'); break;
            case 'message': setMessages((m) => [...m, { side: ev.side, who: ev.who, role: ev.role, text: ev.text, tag: ev.tag, uncertain: ev.uncertain }]); break;
            case 'cite': setCite(ev.k); break;
            case 'nav': if (ev.screenshot) setShot(ev.screenshot); if (ev.url) setUrl(ev.url); break;
            case 'cost': setCost(ev.total ?? 0); break;
            case 'turn_done': setStatus('ready'); break;
            case 'busy': setStatus('busy'); setMessages((m) => [...m, { side: 'ai', who: 'VIN Demo', role: 'system', text: ev.message || 'The engine is busy.', uncertain: true }]); break;
            case 'error': setStatus('error'); setMessages((m) => [...m, { side: 'ai', who: 'VIN Demo', role: 'system', text: ev.message || 'Engine error.', uncertain: true }]); break;
          }
        };
        es.onerror = () => { if (!closed) setStatus((s) => (s === 'connecting' ? 'error' : 'closed')); es?.close(); };
      } catch { if (!closed) setStatus('error'); }
    })();
    return () => { closed = true; es?.close(); };
  }, []);

  const send = useCallback(async (q: string) => {
    const t = q.trim(); const c = cfg.current;
    if (!t || !c || status !== 'ready') return;
    setStatus('answering'); setText('');
    try {
      await fetch(`${c.engineUrl}/session/utterance?token=${encodeURIComponent(c.token)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t }),
      });
    } catch { setStatus('ready'); }
  }, [status]);

  const canAsk = status === 'ready';
  const statusLabel = { connecting: 'Connecting…', ready: 'Ready — ask anything', answering: 'Thinking…', busy: 'Engine busy', error: 'Connection error', closed: 'Disconnected' }[status];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end', background: 'rgba(8,16,28,.38)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)', height: '100%', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 40px rgba(20,40,70,.22)' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#002855', color: '#fff' }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#0861CE', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>AI</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Ask VIN</div>
            <div style={{ fontSize: 11, opacity: .8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: status === 'ready' ? '#3ddc97' : status === 'answering' ? '#f4c150' : status === 'error' || status === 'closed' ? '#f0807d' : '#9fb0c4' }} />
              {statusLabel}{cost > 0 ? ` · $${cost.toFixed(3)}` : ''}
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={18} /></button>
        </div>

        {/* live screen (when the agent has navigated) */}
        {shot && (
          <div style={{ borderBottom: '1px solid #eef2f7' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 11, color: '#76859a' }}><Icon name="lock" size={11} /> {url || 'po.vin'} <span style={{ marginLeft: 'auto', color: '#1f7a52', fontWeight: 700 }}>LIVE · read-only</span></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt="Live product (driven read-only by VIN)" style={{ width: '100%', display: 'block', maxHeight: 220, objectFit: 'cover', objectPosition: 'top' }} />
          </div>
        )}

        {/* conversation */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: '#f7f9fc' }}>
          {messages.length === 0 && status !== 'error' && (
            <div style={{ color: '#76859a', fontSize: 13, textAlign: 'center', marginTop: 24 }}>Ask the consultant anything about the product — it answers live and drives the real UI, read-only.</div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, flexDirection: m.side === 'ai' ? 'row' : 'row-reverse' }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, color: '#fff', background: m.side === 'ai' ? '#002855' : '#4D6995' }}>{m.side === 'ai' ? 'AI' : (m.who?.[0] ?? '?').toUpperCase()}</span>
              <div style={{ maxWidth: '80%' }}>
                <div style={{ fontSize: 10.5, color: '#94a2b5', marginBottom: 3, textAlign: m.side === 'ai' ? 'left' : 'right' }}>{m.who}{m.role && m.role !== m.who ? ` · ${m.role}` : ''}</div>
                <div style={{ padding: '9px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.5, background: m.side === 'ai' ? '#fff' : '#0861CE', color: m.side === 'ai' ? '#283e5b' : '#fff', border: m.side === 'ai' ? '1px solid #e3e8ef' : 'none', borderLeft: m.uncertain ? '3px solid #B75D04' : undefined }}>{m.text}</div>
              </div>
            </div>
          ))}
          {status === 'answering' && <div style={{ fontSize: 12, color: '#76859a', paddingLeft: 36 }}>VIN is thinking…</div>}
          {cite && (
            <div style={{ fontSize: 11, color: '#76859a', background: '#fff', border: '1px solid #e3e8ef', borderRadius: 8, padding: '7px 10px' }}>
              <Icon name="file" size={11} /> {cite.source} · confidence {Math.round((cite.conf ?? 0) * 100)}% · {cite.status}
            </div>
          )}
        </div>

        {/* composer */}
        <div style={{ borderTop: '1px solid #eef2f7', padding: 12, background: '#fff' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {CHIPS.map((c) => <button key={c} onClick={() => send(c)} disabled={!canAsk} style={{ fontSize: 11, padding: '5px 9px', borderRadius: 999, border: '1px solid #d4dbe5', background: '#fff', color: '#5a6b80', cursor: canAsk ? 'pointer' : 'default', opacity: canAsk ? 1 : .5 }}>{c}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={text} disabled={!canAsk} placeholder={canAsk ? 'Ask the consultant a question…' : statusLabel}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(text); }}
              style={{ flex: 1, padding: '10px 12px', border: '1px solid #d4dbe5', borderRadius: 8, fontSize: 13, color: '#283e5b' }} />
            <button onClick={() => send(text)} disabled={!canAsk} title="Send" style={{ width: 38, height: 38, borderRadius: 8, border: 'none', background: '#0861CE', color: '#fff', display: 'grid', placeItems: 'center', cursor: canAsk ? 'pointer' : 'default', opacity: canAsk ? 1 : .5 }}><Icon name="send" size={16} fill /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
