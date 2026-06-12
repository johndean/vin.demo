/**
 * Voice profiles are DATA, not code — an operator can pick a voice per session without a deploy.
 * (Names are Google Neural2 voices; behind the TTSProvider interface these map to any vendor.)
 */
import type { VoiceProfile } from './providers.js';

// Google Neural2 voices — KNOWN-GOOD, always available on the project (no key needed). The OPERATOR picks any
// of these per session/journey; behind the TTSProvider interface each routes to its `provider`.
// (Studio voices were tried as a "warmer" tier but aren't enabled here → synthesis returned no audio and the
//  demo went silent; restored to Neural2 so speech always plays.)
export const GOOGLE_PROFILES: VoiceProfile[] = [
  { id: 'consultant-f', label: 'Consultant · Female (Google)', provider: 'google', languageCode: 'en-US', name: 'en-US-Neural2-F', rate: 1.05, pitch: 0 }, // RC-37: a touch brisker — 1.0 read slow for a live demo
  { id: 'consultant-m', label: 'Consultant · Male (Google)', provider: 'google', languageCode: 'en-US', name: 'en-US-Neural2-D', rate: 1.05, pitch: 0 },
  { id: 'professional-f', label: 'Professional · Female (Google)', provider: 'google', languageCode: 'en-US', name: 'en-US-Neural2-C', rate: 1.02, pitch: 0.5 },
  { id: 'professional-m', label: 'Professional · Male (Google)', provider: 'google', languageCode: 'en-US', name: 'en-US-Neural2-J', rate: 1.02, pitch: 0 },
  { id: 'executive-f', label: 'Executive · Female (Google)', provider: 'google', languageCode: 'en-US', name: 'en-US-Neural2-E', rate: 0.96, pitch: -1 },
  { id: 'executive-m', label: 'Executive · Male (Google)', provider: 'google', languageCode: 'en-US', name: 'en-US-Neural2-A', rate: 0.95, pitch: -2 },
];

// ElevenLabs voices (the operator's VoiceLab) — markedly more natural prosody. `name` is the ElevenLabs
// voice_id; `provider:'elevenlabs'` routes synthesis to the ElevenLabs adapter. OFFERED to the operator ONLY
// when ELEVENLABS_API_KEY is configured (see voiceCatalog). rate/pitch are unused for ElevenLabs (it uses
// its own voice_settings) — kept for the shared shape. To add/remove, edit this list (ids from /v1/voices).
export const ELEVENLABS_PROFILES: VoiceProfile[] = [
  { id: 'el-tessa', label: 'Tessa · SaaS Demo (ElevenLabs)', provider: 'elevenlabs', languageCode: 'en-US', name: 'kw7MsfzXoT4yQD1Lgo5A', rate: 1.0, pitch: 0 },
  { id: 'el-eryn', label: 'Eryn · Friendly AI (ElevenLabs)', provider: 'elevenlabs', languageCode: 'en-US', name: 'DXFkLCBUTmvXpp2QwZjA', rate: 1.0, pitch: 0 },
  { id: 'el-jerry', label: 'Jerry B. · Instructional (ElevenLabs)', provider: 'elevenlabs', languageCode: 'en-US', name: 'tCgAUbeV0tdD1S2yFoCx', rate: 1.0, pitch: 0 },
  { id: 'el-mark', label: 'Mark · Casual (ElevenLabs)', provider: 'elevenlabs', languageCode: 'en-US', name: '1SM7GgM6IMuvQlz2BwM3', rate: 1.0, pitch: 0 },
];

// Full registry — profileById resolves ANY id (so a previously-selected ElevenLabs voice still resolves even
// if the key were toggled off; synthesis then falls back to Google in selectTTS).
export const VOICE_PROFILES: VoiceProfile[] = [...GOOGLE_PROFILES, ...ELEVENLABS_PROFILES];

/** The voices OFFERED to the operator for selection: Google always; ElevenLabs only when its key is set. */
export function voiceCatalog(): VoiceProfile[] {
  return process.env.ELEVENLABS_API_KEY ? VOICE_PROFILES : GOOGLE_PROFILES;
}

export const DEFAULT_PROFILE = GOOGLE_PROFILES[0];

/** The session's default voice: a purpose-built ElevenLabs demo voice (Tessa) when the key is set, else the
 *  known-good Google consultant. The operator can still pick any voice from voiceCatalog() per session. */
export function defaultProfile(): VoiceProfile {
  if (process.env.ELEVENLABS_API_KEY) return VOICE_PROFILES.find((p) => p.id === 'el-tessa') ?? DEFAULT_PROFILE;
  return DEFAULT_PROFILE;
}

export function profileById(id: string | undefined): VoiceProfile {
  return VOICE_PROFILES.find((p) => p.id === id) ?? defaultProfile();
}
