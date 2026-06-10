/**
 * Voice profiles are DATA, not code — an operator can pick a voice per session without a deploy.
 * (Names are Google Neural2 voices; behind the TTSProvider interface these map to any vendor.)
 */
import type { VoiceProfile } from './providers.js';

export const VOICE_PROFILES: VoiceProfile[] = [
  // Studio voices = Google's most natural / "human" tier — the warm default for a conversational consultant.
  // (If a Studio voice/config isn't available, tts-google falls back to a known-good Neural2 voice so audio
  //  never breaks.) Studio ignores pitch, so pitch stays 0 here.
  { id: 'consultant-f', label: 'Consultant · Female', languageCode: 'en-US', name: 'en-US-Studio-O', rate: 1.0, pitch: 0 },
  { id: 'consultant-m', label: 'Consultant · Male', languageCode: 'en-US', name: 'en-US-Studio-Q', rate: 1.0, pitch: 0 },
  { id: 'professional-f', label: 'Professional · Female', languageCode: 'en-US', name: 'en-US-Neural2-C', rate: 1.02, pitch: 0.5 },
  { id: 'professional-m', label: 'Professional · Male', languageCode: 'en-US', name: 'en-US-Neural2-J', rate: 1.02, pitch: 0 },
  { id: 'executive-f', label: 'Executive · Female', languageCode: 'en-US', name: 'en-US-Neural2-E', rate: 0.96, pitch: -1 },
  { id: 'executive-m', label: 'Executive · Male', languageCode: 'en-US', name: 'en-US-Neural2-A', rate: 0.95, pitch: -2 },
];

export const DEFAULT_PROFILE = VOICE_PROFILES[0];

export function profileById(id: string | undefined): VoiceProfile {
  return VOICE_PROFILES.find((p) => p.id === id) ?? DEFAULT_PROFILE;
}
