/**
 * ElevenLabs Text-to-Speech adapter — a streaming-native vendor with markedly more natural prosody
 * than Google Neural2. DROP-IN for googleTTS: synthesize(text, voice) -> { audio: Buffer, mime }, so
 * the existing sentence-by-sentence speak() loop and the say_chunk streaming path work UNCHANGED.
 *
 * This adapter is selected ONLY when ELEVENLABS_API_KEY is present (see selectTTS in voice-session.ts);
 * with no key the engine stays on Google, byte-identical to today. The key is read from process.env at
 * CALL time and is NEVER logged, echoed, or persisted.
 *
 * NOTE (follow-on): true word/token-level audio streaming would use the ElevenLabs WebSocket endpoint
 * (`/v1/text-to-speech/{voiceId}/stream-input`), which would re-architect the per-sentence audio
 * pipeline. We deliberately stay at sentence-level synthesize here — the turbo model already gives much
 * warmer prosody than Neural2 without touching the WS protocol or the speak() loop. See risks.
 */
import type { TTSProvider, TTSResult, VoiceProfile } from './providers.js';
import { speakable } from './segmenter.js';

const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
// Low-latency model — good for streaming sentence-by-sentence in a live demo.
const MODEL_ID = 'eleven_turbo_v2_5';

// Map our VoiceProfile ids → ElevenLabs voiceIds. These are ElevenLabs' stock public voices; an operator
// can override the voice used for EVERY profile via ELEVENLABS_VOICE_ID (single global override). The
// warm default ("Rachel") is used for any profile not explicitly mapped.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel — warm, conversational
const PROFILE_VOICE: Record<string, string> = {
  'consultant-f': '21m00Tcm4TlvDq8ikWAM',   // Rachel — warm female
  'consultant-m': 'pNInz6obpgDQGcFmaJgB',   // Adam — warm male
  'professional-f': 'EXAVITQu4vr4xnSDxMaL', // Sarah — clear female
  'professional-m': 'TxGEqnHWrfWFTfGW9XjX', // Josh — clear male
  'executive-f': 'oWAxZDx7w5VEj9dCyTzz',    // Grace — measured female
  'executive-m': 'VR6AewLTigWG4xSOukaG',    // Arnold — measured male
};

function voiceIdFor(voice: VoiceProfile): string {
  // A single global override wins for every profile when set (operator pins one ElevenLabs voice).
  const override = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (override) return override;
  return PROFILE_VOICE[voice.id] ?? DEFAULT_VOICE_ID;
}

export const elevenLabsTTS: TTSProvider = {
  async synthesize(text: string, voice: VoiceProfile): Promise<TTSResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY; // read at call time; never logged/persisted
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set'); // selection guards this; caller falls back
    // Sanitize at the LAST boundary before speech — same guarantee as the Google adapter (no markdown/
    // symbol artifact ever reaches the vendor), so this is a true drop-in.
    const clean = speakable(text);
    const voiceId = voiceIdFor(voice);
    const res = await fetch(`${API_BASE}/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean,
        model_id: MODEL_ID,
        // Warm, steady delivery for a live demo: moderate stability, high similarity, a little style.
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
      }),
    });
    if (!res.ok) {
      // NEVER include the request (which carries the key headers) in the error — only status + body text.
      const detail = await res.text().catch(() => '');
      throw new Error(`ElevenLabs TTS ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new Error('ElevenLabs TTS returned empty audio'); // treat empty as failure → caller falls back
    return { audio, mime: 'audio/mpeg' };
  },
};
