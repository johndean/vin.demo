/**
 * Google Cloud Text-to-Speech adapter. Outputs MP3 so any browser can decode it directly
 * (decodeAudioData). Credentials come from GOOGLE_APPLICATION_CREDENTIALS (the engine writes the
 * base64 key env var to a file at boot — see index.ts).
 */
import textToSpeech from '@google-cloud/text-to-speech';
import type { TTSProvider, TTSResult, VoiceProfile } from './providers.js';

// Lazy so GOOGLE_APPLICATION_CREDENTIALS is set (by the engine at boot) before the client reads it.
let _client: textToSpeech.TextToSpeechClient | null = null;
const client = () => (_client ??= new textToSpeech.TextToSpeechClient());

export const googleTTS: TTSProvider = {
  async synthesize(text: string, voice: VoiceProfile): Promise<TTSResult> {
    const [res] = await client().synthesizeSpeech({
      input: { text },
      voice: { languageCode: voice.languageCode, name: voice.name },
      audioConfig: { audioEncoding: 'MP3', speakingRate: voice.rate, pitch: voice.pitch },
    });
    return { audio: (res.audioContent as Buffer) ?? Buffer.alloc(0), mime: 'audio/mpeg' };
  },
};
