/* VoiceClient — browser side of the voice channel. Captures mic audio, downsamples to 16 kHz
   LINEAR16 PCM, streams it over a WebSocket to the engine's /voice gateway, and plays back the
   MP3 audio the engine streams (the consultant speaking), sentence by sentence. Barge-in: starting
   the mic stops any in-progress playback. Pure Web APIs — identical copy in apps/desktop/src. */
export type VoiceState = 'connecting' | 'ready' | 'listening' | 'speaking' | 'error' | 'closed';

export class VoiceClient {
  private ws: WebSocket | null = null;
  private ac: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mute: GainNode | null = null;
  private queue: AudioBufferSourceNode[] = [];
  private nextAt = 0;
  private listening = false;
  private audioFailed = false; // L-3: surface a dead audio path ONCE per session, not per dropped chunk

  constructor(private url: string, private onEvent: (ev: any) => void, private onState: (s: VoiceState) => void) {}

  // #15 warm the AudioContext early (and keep it RUNNING): created + resumed on connect so the FIRST audio frame
  // plays without the suspended-context cold start, and so a voice WALK (no mic → startMic never runs) is never
  // left stuck in 'suspended'. Idempotent; tolerant of a browser that defers resume() to a user gesture.
  private ensureAc(): AudioContext | null {
    try { this.ac ??= new AudioContext(); } catch { return null; }
    if (this.ac.state === 'suspended') void this.ac.resume().catch(() => {});
    return this.ac;
  }

  connect() {
    this.onState('connecting');
    this.ensureAc(); // #15: warm the audio path now so the cold-start bridge / first narration plays instantly
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let ev: any; try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.type === 'ready') this.onState('ready');
      else if (ev.type === 'listening') this.onState('listening');
      else if (ev.type === 'audio') { this.onState('speaking'); void this.play(ev.data); }
      else if (ev.type === 'flush') { this.stopPlayback(); return; } // RC-11: barge-in — drop queued/playing audio now (don't forward)
      else if (ev.type === 'turn_done') this.onState('ready');
      this.onEvent(ev);
    };
    ws.onerror = () => this.onState('error');
    ws.onclose = () => this.onState('closed');
  }

  async startMic() {
    this.stopPlayback(); // barge-in
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch { this.onEvent({ type: 'error', message: 'Microphone blocked or unavailable — allow mic access and try again.' }); this.onState('error'); return; }
    this.ac ??= new AudioContext();
    const ac = this.ac;
    await ac.resume().catch(() => {});
    const inRate = ac.sampleRate;
    this.source = ac.createMediaStreamSource(this.micStream);
    this.node = ac.createScriptProcessor(4096, 1, 1);
    this.mute = ac.createGain(); this.mute.gain.value = 0; // route through silent gain so we don't echo the mic
    this.listening = true;
    this.ws.send(JSON.stringify({ type: 'mic_start' }));
    this.node.onaudioprocess = (ev) => {
      if (!this.listening || this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(downsampleTo16kInt16(ev.inputBuffer.getChannelData(0), inRate));
    };
    this.source.connect(this.node);
    this.node.connect(this.mute);
    this.mute.connect(ac.destination);
  }

  stopMic() {
    if (!this.listening) return;
    this.listening = false;
    try { this.ws?.send(JSON.stringify({ type: 'mic_end' })); } catch { /* */ }
    try { this.node?.disconnect(); } catch { /* */ }
    try { this.source?.disconnect(); } catch { /* */ }
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.node = null; this.source = null; this.micStream = null;
  }

  setVoice(id: string) { try { this.ws?.send(JSON.stringify({ type: 'voice', id })); } catch { /* */ } }
  sendText(text: string) { try { this.ws?.send(JSON.stringify({ type: 'text', text })); } catch { /* */ } }
  close() { this.stopMic(); this.stopPlayback(); try { this.ws?.close(); } catch { /* */ } try { void this.ac?.close(); } catch { /* */ } this.ac = null; }

  private async play(b64: string) {
    if (!b64) return;
    const ac = this.ensureAc(); // #15: guarantees a RUNNING context (resumes if suspended) before scheduling
    // L-3: if the context can't even be CREATED (constructor threw), every frame would be silently dropped and the
    // consultant goes mute with no signal. Surface it once so the operator knows why — but don't kill the session.
    if (!ac) { if (!this.audioFailed) { this.audioFailed = true; this.onEvent({ type: 'error', message: 'Audio is unavailable in this environment — the consultant can’t be heard.' }); } return; }
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buf = await ac.decodeAudioData(bytes.buffer);
      const src = ac.createBufferSource();
      src.buffer = buf; src.connect(ac.destination);
      const start = Math.max(ac.currentTime, this.nextAt);
      src.start(start);
      this.nextAt = start + buf.duration;
      this.queue.push(src);
      src.onended = () => { this.queue = this.queue.filter((s) => s !== src); };
    } catch { /* undecodable chunk */ }
  }

  private stopPlayback() {
    for (const s of this.queue) { try { s.stop(); } catch { /* */ } }
    this.queue = []; this.nextAt = 0;
  }
}

function downsampleTo16kInt16(input: Float32Array, inRate: number): ArrayBuffer {
  const outRate = 16000;
  const ratio = inRate / outRate;
  if (ratio <= 1) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
    return out.buffer;
  }
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0, n = 0;
    for (let j = start; j < end; j++) { sum += input[j]; n++; }
    out[i] = Math.max(-1, Math.min(1, n ? sum / n : 0)) * 0x7fff;
  }
  return out.buffer;
}
