/**
 * Google Cloud Speech-to-Text streaming adapter. The client streams raw LINEAR16 PCM in; Google
 * emits interim + final transcripts. We finalize on end-of-utterance (the client signals mic-stop,
 * which calls end()). Credentials via GOOGLE_APPLICATION_CREDENTIALS (set at boot from the env key).
 */
import speech from '@google-cloud/speech';
import type { STTProvider, STTStream, STTCallbacks } from './providers.js';

// Lazy so GOOGLE_APPLICATION_CREDENTIALS is set (by the engine at boot) before the client reads it.
let _client: speech.SpeechClient | null = null;
const client = () => (_client ??= new speech.SpeechClient());

export const googleSTT: STTProvider = {
  open({ sampleRate, onInterim, onFinal, onError }: STTCallbacks): STTStream {
    const stream = client().streamingRecognize({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: sampleRate,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        model: 'latest_long',
      },
      interimResults: true,
    });
    stream.on('data', (data: any) => {
      const r = data.results?.[0];
      if (!r) return;
      const t = r.alternatives?.[0]?.transcript ?? '';
      if (!t) return;
      if (r.isFinal) onFinal(t.trim()); else onInterim(t.trim());
    });
    stream.on('error', (e: any) => onError(e instanceof Error ? e : new Error(String(e))));
    return {
      write: (pcm: Buffer) => { try { stream.write(pcm); } catch { /* stream may be closing */ } },
      end: () => { try { stream.end(); } catch { /* */ } },
    };
  },
};
