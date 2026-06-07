'use client';
/* Ask VIN — live conversation for the web console. Two channels over the same engine session:
   TEXT (EventSource /session/interactive + POST /session/utterance) and VOICE (WebSocket /voice via
   VoiceClient: mic → STT → brain → TTS → speech). The engine is the brain; this is a thin channel.
   GET /api/voice/token mints a short-lived token (the httpOnly cookie can't cross to the engine origin). */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from './shell';
import { VoiceClient, type VoiceState } from './voice-client';

interface Msg { side: 'them' | 'ai'; who: string; role: string; text: string; tag?: string; uncertain?: boolean }
type Status = 'connecting' | 'ready' | 'answering' | 'busy' | 'error' | 'closed';
interface Profile { id: string; label: string }

const CHIPS = ['How does approval delegation work?', 'What happens when an approver is out of office?', 'Can you submit a real PO?'];

export function AskPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const [shot, setShot] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [cite, setCite] = useState<any>(null);
  const [cost, setCost] = useState(0);
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profile, setProfile] = useState('consultant-f');
  const cfg = useRef<{ token: string; engineUrl: string } | null>(null);
  const vc = useRef<VoiceClient | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handle = useCallback((ev: any) => {
    switch (ev?.type) {
      case 'start': setUrl(ev.product ? `https://${ev.product}` : ''); if (Array.isArray(ev.profiles)) setProfiles(ev.profiles); break;
      case 'ready': setStatus('ready'); break;
      case 'message': setMessages((m) => [...m, { side: ev.side, who: ev.who, role: ev.role, text: ev.text, tag: ev.tag, uncertain: ev.uncertain }]); break;
      case 'transcript': setInterim(ev.final ? '' : ev.text); break;
      case 'cite': setCite(ev.k); break;
      case 'nav': if (ev.screenshot) setShot(ev.screenshot); if (ev.url) setUrl(ev.url); break;
      case 'cost': setCost(ev.total ?? 0); break;
      case 'turn_done': setStatus('ready'); break;
      case 'busy': setStatus('busy'); setMessages((m) => [...m, { side: 'ai', who: 'VIN Demo', role: 'system', text: ev.message || 'Engine busy.', uncertain: true }]); break;
      case 'error': case 'stt_error': setStatus('error'); setMessages((m) => [...m, { side: 'ai', who: 'VIN Demo', role: 'system', text: ev.message || 'Engine error.', uncertain: true }]); break;
    }
  }, []);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages.length, status, interim]);

  // (Re)connect whenever the channel (text vs voice) changes. A short delay lets the prior session
  // close on the engine first (it serves one session at a time).
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    setStatus('connecting'); setInterim(''); setListening(false);
    (async () => {
      if (!cfg.current) {
        const r = await fetch('/api/voice/token');
        if (!r.ok) { setStatus('error'); return; }
        cfg.current = await r.json();
      }
      await new Promise((res) => setTimeout(res, 350));
      if (closed || !cfg.current) return;
      if (voice) {
        const wss = cfg.current.engineUrl.replace(/^http/, 'ws') + `/voice?token=${encodeURIComponent(cfg.current.token)}`;
        const client = new VoiceClient(wss, handle, (s: VoiceState) => {
          if (s === 'error') setStatus('error'); else if (s === 'closed') setStatus((p) => (p === 'connecting' ? 'error' : 'closed'));
        });
        vc.current = client; client.connect();
      } else {
        es = new EventSource(`${cfg.current.engineUrl}/session/interactive?token=${encodeURIComponent(cfg.current.token)}`);
        es.onmessage = (e) => { let ev: any; try { ev = JSON.parse(e.data); } catch { return; } handle(ev); };
        es.onerror = () => { if (!closed) setStatus((s) => (s === 'connecting' ? 'error' : 'closed')); es?.close(); };
      }
    })();
    return () => { closed = true; es?.close(); if (vc.current) { vc.current.close(); vc.current = null; } };
  }, [voice, handle]);

  const send = useCallback((q: string) => {
    const t = q.trim();
    if (!t || status !== 'ready') return;
    setStatus('answering'); setText('');
    if (voice && vc.current) vc.current.sendText(t);
    else if (cfg.current) {
      fetch(`${cfg.current.engineUrl}/session/utterance?token=${encodeURIComponent(cfg.current.token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t }) }).catch(() => setStatus('ready'));
    }
  }, [voice, status]);

  const toggleMic = () => {
    const c = vc.current; if (!c) return;
    if (listening) { c.stopMic(); setListening(false); setStatus('answering'); }
    else { void c.startMic(); setListening(true); }
  };
  const pickVoice = (id: string) => { setProfile(id); vc.current?.setVoice(id); };

  const canAsk = status === 'ready';
  const statusLabel = listening ? 'Listening… (tap to send)' : { connecting: 'Connecting…', ready: voice ? 'Ready — tap the mic or type' : 'Ready — ask anything', answering: 'Thinking…', busy: 'Engine busy', error: 'Connection error', closed: 'Disconnected' }[status];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end', background: 'rgba(8,16,28,.38)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)', height: '100%', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 40px rgba(20,40,70,.22)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#002855', color: '#fff' }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#0861CE', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>AI</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Ask VIN</div>
            <div style={{ fontSize: 11, opacity: .8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: listening ? '#f4c150' : status === 'ready' ? '#3ddc97' : status === 'answering' ? '#f4c150' : status === 'error' || status === 'closed' ? '#f0807d' : '#9fb0c4' }} />
              {statusLabel}{cost > 0 ? ` · $${cost.toFixed(3)}` : ''}
            </div>
          </div>
          <button onClick={() => setVoice((v) => !v)} title={voice ? 'Switch to text' : 'Switch to voice'} style={{ background: voice ? '#0861CE' : 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="spark" size={13} /> {voice ? 'Voice' : 'Text'}</button>
          <button onClick={onClose} title="Close" style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={18} /></button>
        </div>

        {voice && profiles.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #eef2f7', fontSize: 12, color: '#5a6b80' }}>
            <Icon name="spark" size={12} /> Voice
            <select value={profile} onChange={(e) => pickVoice(e.target.value)} style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 8px', border: '1px solid #d4dbe5', borderRadius: 6 }}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        )}

        {shot && (
          <div style={{ borderBottom: '1px solid #eef2f7' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 11, color: '#76859a' }}><Icon name="lock" size={11} /> {url || 'po.vin'} <span style={{ marginLeft: 'auto', color: '#1f7a52', fontWeight: 700 }}>LIVE · read-only</span></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt="Live product (driven read-only by VIN)" style={{ width: '100%', display: 'block', maxHeight: 220, objectFit: 'cover', objectPosition: 'top' }} />
          </div>
        )}

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: '#f7f9fc' }}>
          {messages.length === 0 && status !== 'error' && (
            <div style={{ color: '#76859a', fontSize: 13, textAlign: 'center', marginTop: 24 }}>Ask anything about the product — VIN answers live and drives the real UI, read-only.{voice ? ' Tap the mic and speak.' : ''}</div>
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
          {interim && <div style={{ alignSelf: 'flex-end', fontSize: 13, color: '#5a6b80', fontStyle: 'italic', padding: '4px 10px' }}>{interim}…</div>}
          {status === 'answering' && !interim && <div style={{ fontSize: 12, color: '#76859a', paddingLeft: 36 }}>VIN is thinking…</div>}
          {cite && (
            <div style={{ fontSize: 11, color: '#76859a', background: '#fff', border: '1px solid #e3e8ef', borderRadius: 8, padding: '7px 10px' }}>
              <Icon name="file" size={11} /> {cite.source} · confidence {Math.round((cite.conf ?? 0) * 100)}% · {cite.status}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid #eef2f7', padding: 12, background: '#fff' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {CHIPS.map((c) => <button key={c} onClick={() => send(c)} disabled={!canAsk} style={{ fontSize: 11, padding: '5px 9px', borderRadius: 999, border: '1px solid #d4dbe5', background: '#fff', color: '#5a6b80', cursor: canAsk ? 'pointer' : 'default', opacity: canAsk ? 1 : .5 }}>{c}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {voice && (
              <button onClick={toggleMic} disabled={status !== 'ready' && !listening} title={listening ? 'Tap to send' : 'Tap to talk'}
                style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: listening ? '#C54644' : '#0861CE', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0, boxShadow: listening ? '0 0 0 4px rgba(197,70,68,.2)' : 'none' }}>
                <Icon name={listening ? 'stop' : 'spark'} size={16} fill />
              </button>
            )}
            <input value={text} disabled={!canAsk} placeholder={canAsk ? 'Ask the consultant a question…' : statusLabel}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(text); }}
              style={{ flex: 1, padding: '10px 12px', border: '1px solid #d4dbe5', borderRadius: 8, fontSize: 13, color: '#283e5b' }} />
            <button onClick={() => send(text)} disabled={!canAsk} title="Send" style={{ width: 38, height: 38, borderRadius: 8, border: 'none', background: '#0861CE', color: '#fff', display: 'grid', placeItems: 'center', cursor: canAsk ? 'pointer' : 'default', opacity: canAsk ? 1 : .5, flexShrink: 0 }}><Icon name="send" size={16} fill /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
