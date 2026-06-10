/**
 * Google Cloud Text-to-Speech adapter. Outputs MP3 so any browser can decode it directly
 * (decodeAudioData). Credentials come from GOOGLE_APPLICATION_CREDENTIALS (the engine writes the
 * base64 key env var to a file at boot — see index.ts).
 */
import textToSpeech from '@google-cloud/text-to-speech';
import type { TTSProvider, TTSResult, VoiceProfile } from './providers.js';
import { speakable } from './segmenter.js';

// Lazy so GOOGLE_APPLICATION_CREDENTIALS is set (by the engine at boot) before the client reads it.
let _client: textToSpeech.TextToSpeechClient | null = null;
const client = () => (_client ??= new textToSpeech.TextToSpeechClient());

export const googleTTS: TTSProvider = {
  async synthesize(text: string, voice: VoiceProfile): Promise<TTSResult> {
    // Sanitize at the LAST boundary before speech: no markdown/symbol artifact (e.g. "**") ever reaches
    // Google, regardless of which caller produced the text.
    const clean = speakable(text);
    const call = (name: string, pitch: number) =>
      client().synthesizeSpeech({
        input: { text: clean },
        voice: { languageCode: voice.languageCode, name },
        audioConfig: { audioEncoding: 'MP3', speakingRate: voice.rate, pitch },
      });
    try {
      const [res] = await call(voice.name, voice.pitch);
      return { audio: (res.audioContent as Buffer) ?? Buffer.alloc(0), mime: 'audio/mpeg' };
    } catch (e) {
      // A voice name/config the project hasn't validated (e.g. a Studio tier) must NEVER break the demo's
      // audio — fall back to a known-good Neural2 voice (pitch 0) so speech always plays.
      if (voice.name === 'en-US-Neural2-F') throw e;
      console.error('[tts] voice', voice.name, 'failed — falling back to en-US-Neural2-F:', (e as any)?.message ?? e);
      const [res] = await call('en-US-Neural2-F', 0);
      return { audio: (res.audioContent as Buffer) ?? Buffer.alloc(0), mime: 'audio/mpeg' };
    }
  },
};
