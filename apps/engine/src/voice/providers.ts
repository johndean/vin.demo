/**
 * Voice provider interfaces — keep STT/TTS behind small adapters so vendors swap without touching
 * the gateway or the brain (Google now; ElevenLabs/Azure/etc. later). VIN stays the single brain;
 * these only convert audio↔text.
 */
export interface VoiceProfile {
  id: string;
  label: string;
  languageCode: string;
  name: string;        // provider voice name (e.g. Google 'en-US-Neural2-F')
  rate: number;        // speaking rate (1.0 = normal)
  pitch: number;       // semitones
}

export interface TTSResult {
  audio: Buffer;       // encoded audio bytes
  mime: string;        // e.g. 'audio/mpeg'
}

export interface TTSProvider {
  /** Synthesize one chunk of text (typically a sentence) into playable audio. */
  synthesize(text: string, voice: VoiceProfile): Promise<TTSResult>;
}

export interface STTStream {
  write(pcm: Buffer): void; // feed raw LINEAR16 PCM audio
  end(): void;              // signal end-of-utterance → provider emits the final transcript
}

export interface STTCallbacks {
  sampleRate: number;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (err: Error) => void;
}

export interface STTProvider {
  /** Open a streaming recognition session. Write PCM as it arrives; call end() to finalize. */
  open(cb: STTCallbacks): STTStream;
}
