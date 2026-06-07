/**
 * WS voice session — speech as a thin channel over the SAME brain. Audio in → Google STT → utterance
 * → runTurn (the dynamic LangGraph loop) → the spoken answer text → sentence segmenter → Google TTS
 * → audio out. Barge-in: when the user starts talking (mic_start) we stop the current TTS. VIN does
 * all reasoning/navigation/governance via runTurn — this file only moves audio and text.
 *
 * Client → server : binary frames = LINEAR16 PCM (16 kHz); text frames = JSON control
 *   {type:'mic_start'} | {type:'mic_end'} | {type:'interrupt'} | {type:'voice',id} | {type:'text',text}
 * Server → client : JSON events (same shape as the interactive SSE) plus
 *   {type:'transcript',text,final} | {type:'audio',mime,data(base64)} | {type:'listening'} | {type:'voice',id,label}
 */
import type { WebSocket } from 'ws';
import { bootSession, runTurn, LOOP, type SessionCtx } from '../../../src/core/live-session.js';
import { googleSTT } from './voice/stt-google.js';
import { googleTTS } from './voice/tts-google.js';
import { splitSentences } from './voice/segmenter.js';
import { profileById, DEFAULT_PROFILE, VOICE_PROFILES } from './voice/profiles.js';
import type { STTStream, VoiceProfile } from './voice/providers.js';

const SAMPLE_RATE = 16000;

export async function startVoiceSession(ws: WebSocket): Promise<void> {
  const send = (o: Record<string, unknown>) => { try { ws.send(JSON.stringify(o)); } catch { /* socket closing */ } };

  const ctx: SessionCtx | null = await bootSession('voice');
  if (!ctx) { send({ type: 'error', message: 'PO_VIN_PRODUCT_ID not set — run `npm run seed`.' }); try { ws.close(); } catch { /* */ } return; }

  let profile: VoiceProfile = DEFAULT_PROFILE;
  let stt: STTStream | null = null;
  let answering = false;
  let interrupted = false;        // barge-in flag: stop emitting TTS for the current answer
  let ttsChain: Promise<void> = Promise.resolve();
  const speaker = 'Procurement';

  send({ type: 'start', product: 'po.vin', scenario: 'Voice', mode: ctx.mode, loop: LOOP, sessionId: ctx.sessionId, interactive: true, voice: profile.id, profiles: VOICE_PROFILES.map((p) => ({ id: p.id, label: p.label })) });
  send({ type: 'ready' });

  // Speak one answer: synthesize sentence-by-sentence so audio starts on the first sentence.
  const speak = async (text: string) => {
    for (const sentence of splitSentences(text)) {
      if (interrupted) return;
      try {
        const { audio, mime } = await googleTTS.synthesize(sentence, profile);
        if (interrupted) return;
        if (audio.length) send({ type: 'audio', mime, data: audio.toString('base64') });
      } catch (e: any) {
        send({ type: 'tts_error', message: String(e?.message ?? e) }); // degrade gracefully — text was already sent
      }
    }
  };

  // Forward every brain event to the client; when the consultant SAYS something, also speak it.
  const voiceEmit = (ev: Record<string, unknown>) => {
    send(ev);
    if (ev.type === 'message' && ev.side === 'ai' && typeof ev.text === 'string' && !interrupted) {
      ttsChain = ttsChain.then(() => speak(ev.text as string)); // serialize so audio stays in order
    }
  };

  const runVoiceTurn = async (text: string) => {
    const q = (text || '').trim();
    if (!q) return;
    if (answering) { send({ type: 'busy', message: 'One moment — still answering.' }); return; }
    answering = true; interrupted = false;
    try {
      await runTurn(ctx, { speaker, text: q }, voiceEmit);
      await ttsChain; // let queued TTS finish before signaling the turn is done
    } catch (e: any) {
      send({ type: 'error', message: String(e?.message ?? e) });
    } finally {
      answering = false;
      send({ type: 'turn_done' });
    }
  };

  ws.on('message', (data: any, isBinary: boolean) => {
    if (isBinary) { if (stt) stt.write(Buffer.isBuffer(data) ? data : Buffer.from(data)); return; }
    let msg: any; try { msg = JSON.parse(data.toString()); } catch { return; }
    switch (msg?.type) {
      case 'mic_start':
        interrupted = true; // user is talking → cut off any current TTS (barge-in)
        if (stt) { try { stt.end(); } catch { /* */ } }
        stt = googleSTT.open({
          sampleRate: SAMPLE_RATE,
          onInterim: (t) => send({ type: 'transcript', text: t, final: false }),
          onFinal: (t) => { send({ type: 'transcript', text: t, final: true }); stt = null; if (t) void runVoiceTurn(t); },
          onError: (e) => { send({ type: 'stt_error', message: e.message }); stt = null; },
        });
        send({ type: 'listening' });
        break;
      case 'mic_end':
        if (stt) { try { stt.end(); } catch { /* */ } } // end-of-utterance → STT emits final → turn
        break;
      case 'interrupt':
        interrupted = true;
        break;
      case 'voice':
        profile = profileById(msg.id);
        send({ type: 'voice', id: profile.id, label: profile.label });
        break;
      case 'text': // typing is allowed in the voice panel too
        void runVoiceTurn(String(msg.text ?? ''));
        break;
    }
  });

  ws.on('close', () => { if (stt) { try { stt.end(); } catch { /* */ } stt = null; } });
}
