/**
 * ElevenLabs WORD/TOKEN-LEVEL TTS via the WebSocket `stream-input` endpoint — lowest latency-to-first-
 * audio + smoother continuous prosody than per-sentence synthesize. ADDITIVE + GATED + FALLBACK-SAFE.
 *
 * This path is used ONLY when (a) the selected voice.provider === 'elevenlabs', (b) ELEVENLABS_API_KEY
 * is set, AND (c) ELEVENLABS_WS is truthy. With the flag OFF the engine never opens a socket here and
 * stays byte-identical to today (per-sentence selectTTS().synthesize). On ANY failure the caller
 * (voice-session.ts) degrades to the existing per-sentence path for that turn — never silent, never crash.
 *
 * Protocol (https://elevenlabs.io/docs ... /stream-input):
 *   open  wss://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream-input?model_id=...&output_format=mp3_44100_128
 *   send  BOS  { text:" ", voice_settings, generation_config, xi_api_key }   (key in the first message — NEVER in a log)
 *   send  feed { text:"<sentence> " , try_trigger_generation:true }          (one per say_chunk as it streams)
 *   send  EOS  { text:"" }                                                    (flush + close)
 *   recv  { audio:"<base64 mp3>", isFinal, alignment? }                       → emitted via onAudio as audio/mpeg
 *
 * We pin output_format to an mp3 variant so the client (apps/desktop voice-client.ts / apps/web) plays the
 * SAME {type:'audio',mime:'audio/mpeg',data} frames it already decodes — no client change. The key is read
 * from process.env at CALL time and is NEVER logged, echoed, or persisted; errors carry only status/text.
 *
 * RC-31: word-level WS streaming (gated by ELEVENLABS_WS).
 */
import WS from 'ws';
import type { VoiceProfile } from './providers.js';
import { speakable } from './segmenter.js';

// mp3 output so decodeAudioData on the client is unchanged (PCM would force a client decoder — avoided).
const WS_BASE = 'wss://api.elevenlabs.io/v1/text-to-speech';
const MODEL_ID = 'eleven_turbo_v2_5';
const OUTPUT_FORMAT = 'mp3_44100_128';
const OPEN_TIMEOUT_MS = 6000;   // socket must connect within this or we fall back
const DRAIN_TIMEOUT_MS = 15000; // upper bound on end() so a hung server can never block turn_done
const AUDIO_MIME = 'audio/mpeg';

/** Resolve the ElevenLabs voice_id for a profile — mirrors voiceIdFor in tts-elevenlabs.ts so the WS path
 *  selects the SAME voice as the sentence path (catalog `name` wins; then global pin; then a warm default). */
function wsVoiceId(voice: VoiceProfile): string {
  if (voice.provider === 'elevenlabs' && voice.name) return voice.name;
  const override = process.env.ELEVENLABS_VOICE_ID?.trim();
  return override || '21m00Tcm4TlvDq8ikWAM'; // Rachel — warm default (matches DEFAULT_VOICE_ID)
}

export interface ElevenWsHandle {
  /** Feed one chunk of text (typically a say_chunk sentence) into the open stream. Sanitized like the
   *  sentence path so no markdown/symbol artifact reaches the vendor. No-op once closed/closing. */
  feed(text: string): void;
  /** Signal end-of-utterance (flush + let the server finish) — resolves when the server closes or errors. */
  end(): Promise<void>;
  /** Hard stop (barge-in): stop forwarding + close the socket immediately. */
  abort(): void;
  /** Characters fed so far — for best-effort TTS cost metering by the caller. */
  charCount(): number;
}

export interface ElevenWsCallbacks {
  onAudio: (audio: Buffer, mime: string) => void; // a base64-decoded mp3 chunk → caller forwards as {type:'audio',...}
  onError: (err: Error) => void;                  // any WS/protocol failure → caller falls back to per-sentence
}

/**
 * Open ONE WebSocket for a turn. Resolves with a handle once the socket is OPEN and the BOS is sent; rejects
 * (so the caller can fall back BEFORE speaking) if the socket fails to open within OPEN_TIMEOUT_MS. After it
 * resolves, transport errors surface via cb.onError and the handle's feed()/end() become no-ops.
 */
export function openElevenWs(voice: VoiceProfile, cb: ElevenWsCallbacks): Promise<ElevenWsHandle> {
  const apiKey = process.env.ELEVENLABS_API_KEY; // read at call time; never logged/persisted
  if (!apiKey) return Promise.reject(new Error('ELEVENLABS_API_KEY not set'));

  const voiceId = wsVoiceId(voice);
  const url = `${WS_BASE}/${voiceId}/stream-input?model_id=${MODEL_ID}&output_format=${OUTPUT_FORMAT}`;
  const sock = new WS(url, { headers: { 'xi-api-key': apiKey } }); // key in the connect header (also sent in BOS) — header never echoed in any error

  let closed = false;     // we've torn down (end/abort/error) — feed()/send become no-ops
  let chars = 0;          // characters fed → caller meters TTS cost best-effort
  let settled = false;    // open promise resolved/rejected exactly once
  let endResolve: (() => void) | null = null;
  let endPromise: Promise<void> | null = null;

  const safeSend = (o: Record<string, unknown>) => {
    if (closed || sock.readyState !== WS.OPEN) return;
    try { sock.send(JSON.stringify(o)); } catch { /* socket closing — caller already degrades */ }
  };

  const teardown = () => {
    if (closed) return;
    closed = true;
    try { sock.close(); } catch { /* */ }
    if (endResolve) { const r = endResolve; endResolve = null; r(); }
  };

  return new Promise<ElevenWsHandle>((resolve, reject) => {
    const openTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      teardown();
      reject(new Error('ElevenLabs WS open timeout')); // caller falls back to per-sentence for this turn
    }, OPEN_TIMEOUT_MS);

    const failOpen = (e: Error) => {
      if (settled) { cb.onError(e); return; } // already running → surface so the turn falls back going forward
      settled = true;
      clearTimeout(openTimer);
      teardown();
      reject(e);
    };

    sock.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(openTimer);
      // BOS — voice_settings mirror the sentence adapter; chunk_length_schedule biased small for low first-audio latency.
      safeSend({
        text: ' ',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
        generation_config: { chunk_length_schedule: [50, 120, 160, 290] },
        xi_api_key: apiKey, // EL accepts the key in the first message; never logged
      });
      resolve({
        feed(text: string) {
          if (closed) return;
          const clean = speakable(text);
          if (!clean) return;
          chars += clean.length;
          // Trailing space helps the server tokenize across chunk boundaries; try_trigger_generation keeps audio flowing.
          safeSend({ text: clean + ' ', try_trigger_generation: true });
        },
        end(): Promise<void> {
          if (endPromise) return endPromise;
          endPromise = new Promise<void>((res) => {
            if (closed) { res(); return; }
            endResolve = res;
            safeSend({ text: '' }); // EOS — server flushes remaining audio then closes
            // Safety: a hung/silent server must never block turn_done — force teardown after the drain bound.
            const drain = setTimeout(() => teardown(), DRAIN_TIMEOUT_MS);
            if (typeof drain.unref === 'function') drain.unref();
          });
          return endPromise;
        },
        abort() { teardown(); },     // barge-in: stop forwarding + close now
        charCount() { return chars; },
      });
    });

    sock.on('message', (data: WS.RawData) => {
      if (closed) return;
      let msg: any;
      try { msg = JSON.parse(data.toString()); } catch { return; } // EL frames are JSON; ignore anything else
      if (typeof msg?.audio === 'string' && msg.audio.length) {
        const buf = Buffer.from(msg.audio, 'base64');
        if (buf.length) cb.onAudio(buf, AUDIO_MIME);
      }
      // isFinal arrives just before the server closes; the 'close' handler resolves end().
    });

    // NEVER include request headers (which carry the key) in the surfaced error — only a status/message string.
    sock.on('error', (e: Error) => failOpen(new Error(`ElevenLabs WS error: ${String(e?.message ?? e)}`)));
    sock.on('close', (code: number) => {
      if (!settled) { failOpen(new Error(`ElevenLabs WS closed before open (code ${code})`)); return; }
      teardown(); // resolves a pending end()
    });
  });
}
