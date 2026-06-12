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
import { bootSession, runTurn, LOOP, type SessionCtx, type SessionTarget } from '../../../src/core/live-session.js';
import { googleSTT } from './voice/stt-google.js';
import { googleTTS } from './voice/tts-google.js';
import { splitSentences } from './voice/segmenter.js';
import { profileById, DEFAULT_PROFILE, VOICE_PROFILES } from './voice/profiles.js';
import type { STTStream, VoiceProfile } from './voice/providers.js';
import { loadPersona } from '../../../src/core/persona.js';
import { beginCostSession, recordVoice } from '../../../src/core/cost.js';
import { journeyWalkPlan, startJourneyRun, completeJourneyRun } from '../../../src/core/journeys.js';

const SAMPLE_RATE = 16000;

export async function startVoiceSession(ws: WebSocket, target: SessionTarget = {}): Promise<void> {
  const send = (o: Record<string, unknown>) => { try { ws.send(JSON.stringify(o)); } catch { /* socket closing */ } };

  const ctx: SessionCtx | null = await bootSession('voice', target);
  if (!ctx) { send({ type: 'error', message: 'No product configured — pick a target or set PO_VIN_PRODUCT_ID.' }); try { ws.close(); } catch { /* */ } return; }
  beginCostSession(ctx.sessionId); // attribute this voice session's LLM + STT/TTS costs to it

  // If a specialist is active (hand-off), speak in its configured voice; else the default profile.
  const bootPersona = await loadPersona(ctx.personaId);
  let profile: VoiceProfile = bootPersona?.voiceProfileId ? profileById(bootPersona.voiceProfileId) : DEFAULT_PROFILE;
  let stt: STTStream | null = null;
  let answering = false;
  let interrupted = false;        // barge-in flag: stop emitting TTS for the current answer
  let streamedThisTurn = false;   // RC-03: did we already speak this turn's answer sentence-by-sentence (streamed)?
  let utterance = 0;              // RC-11: monotonic id, bumped on barge-in so stale TTS from a prior turn bails
  let ttsChain: Promise<void> = Promise.resolve();
  let sttBytes = 0;               // LINEAR16 @16kHz mono bytes for the current utterance → STT audio seconds
  const speaker = 'Procurement';

  send({ type: 'start', product: ctx.productName, scenario: 'Voice', mode: ctx.mode, loop: LOOP, sessionId: ctx.sessionId, interactive: true, voice: profile.id, profiles: VOICE_PROFILES.map((p) => ({ id: p.id, label: p.label })) });
  send({ type: 'ready' });

  // Speak one answer: synthesize sentence-by-sentence so audio starts on the first sentence.
  const speak = async (text: string) => {
    const myU = utterance; // RC-11: bail the moment a newer utterance supersedes this one (barge-in)
    for (const sentence of splitSentences(text)) {
      if (interrupted || myU !== utterance) return;
      try {
        const { audio, mime } = await googleTTS.synthesize(sentence, profile);
        void recordVoice('tts', sentence.length, { voice: profile.id }); // TTS billed by characters synthesized
        if (interrupted || myU !== utterance) return;
        if (audio.length) send({ type: 'audio', mime, data: audio.toString('base64') });
      } catch (e: any) {
        send({ type: 'tts_error', message: String(e?.message ?? e) }); // degrade gracefully — text was already sent
      }
    }
  };

  // Forward every brain event to the client; when the consultant SAYS something, also speak it.
  const voiceEmit = (ev: Record<string, unknown>) => {
    // RC-03: a streamed sentence (say_chunk) is spoken IMMEDIATELY and NOT forwarded to the client — it's a
    // server-internal TTS signal (the full `message` still arrives for the chat panel). Speaking each sentence
    // as the answer streams is what lets audio start on sentence 1 instead of after the whole reply.
    if (ev.type === 'say_chunk' && typeof ev.text === 'string') {
      if (!interrupted) { streamedThisTurn = true; ttsChain = ttsChain.then(() => speak(ev.text as string)); }
      return;
    }
    send(ev);
    // Speak a full AI message ONLY if it was not already streamed sentence-by-sentence this turn (no double
    // speech). Non-streamed lines — walk narration, explanations, compliance — are still spoken; and a
    // non-streaming provider (Gemini) emits no say_chunk → streamedThisTurn stays false → spoken here.
    if (ev.type === 'message' && ev.side === 'ai' && typeof ev.text === 'string' && !interrupted && !streamedThisTurn) {
      ttsChain = ttsChain.then(() => speak(ev.text as string)); // serialize so audio stays in order
    }
  };

  const runVoiceTurn = async (text: string) => {
    const q = (text || '').trim();
    if (!q) return;
    if (answering) { send({ type: 'busy', message: 'One moment — still answering.' }); return; }
    answering = true; interrupted = false; streamedThisTurn = false;
    try {
      await runTurn(ctx, { speaker, text: q, stream: true }, voiceEmit); // RC-03: stream the spoken answer to TTS
      await ttsChain; // let queued TTS finish before signaling the turn is done
    } catch (e: any) {
      send({ type: 'error', message: String(e?.message ?? e) });
    } finally {
      answering = false;
      send({ type: 'turn_done' });
    }
  };

  // ── Journey WALK (voice-led, operator-paced) — the desktop sends {type:'journey_next'} to advance one
  // step; the engine drives the live product to that screen and SPEAKS the step's warm narration. A mic
  // question is an off-script turn (runVoiceTurn → consumes NO journey step, the graph gates on
  // journeyAdvance), after which the desktop resumes with journey_next. The engine owns completion so the
  // client knows when to stop advancing. Operator-paced (one step per control) avoids racing two invokes
  // on the same thread — walk steps and questions are serialized by `answering`.
  const walk = ctx.journeyId ? await journeyWalkPlan(ctx.journeyId).catch(() => null) : null;
  const walkPlan = walk?.plan ?? [];
  let walkStep = 0;               // RC-02: a MIRROR of the graph's authoritative journeyStep (re-synced from runTurn each walk turn), not an independent counter that can desync
  let walkRun: { runId: string } | null = null;
  if (ctx.journeyId && walkPlan.length) {
    send({ type: 'journey_start', journey: walk!.journey.name, goal: walk!.journey.businessGoal ?? '', steps: walkPlan.length, sessionId: ctx.sessionId });
    walkRun = await startJourneyRun(ctx.journeyId, ctx.sessionId).catch(() => null);
  } else if (ctx.journeyId) {
    send({ type: 'journey_unwalkable', message: 'This journey has no walkable steps yet — author its workflow(s) first.' });
  }
  const runWalkStep = async () => {
    if (!walkPlan.length) return;
    if (answering) { send({ type: 'busy', message: 'One moment — finishing this step.' }); return; }
    if (walkStep >= walkPlan.length) { send({ type: 'journey_complete', steps: walkPlan.length }); return; }
    const idx = walkStep;
    answering = true; interrupted = false; streamedThisTurn = false;
    try {
      send({ type: 'journey_step', index: idx, total: walkPlan.length, kind: walkPlan[idx].stepKind, node: walkPlan[idx].nodeLabel ?? null });
      const r = await runTurn(ctx, { speaker: 'Presenter', text: walkPlan[idx].caption ?? 'next', advance: true, stream: true }, voiceEmit); // RC-03: stream the walk narration to TTS
      await ttsChain;
      // RC-02: SYNC the walk position to the GRAPH's authoritative journeyStep (the single owner) rather than
      // incrementing our own counter — so the spoken caption and the driven screen can never drift apart after
      // an off-script question or a mid-turn error. Fall back to idx+1 only if the graph didn't report a step.
      walkStep = (r && typeof r.journeyStep === 'number') ? r.journeyStep : idx + 1;
      if (walkStep >= walkPlan.length) { if (walkRun) await completeJourneyRun(walkRun.runId, 'completed').catch(() => {}); send({ type: 'journey_complete', steps: walkPlan.length }); }
    } catch (e: any) {
      send({ type: 'error', message: String(e?.message ?? e) });
    } finally {
      answering = false; send({ type: 'turn_done' });
    }
  };

  // Open the demo: a pinned journey AUTO-plays its first step (voice-led); otherwise an operator-set
  // opening scenario is asked. Subsequent steps are driven by the client's {type:'journey_next'}.
  if (ctx.journeyId && walkPlan.length) void runWalkStep();
  else if (target.scenario?.trim()) void runVoiceTurn(target.scenario.trim());

  ws.on('message', (data: any, isBinary: boolean) => {
    if (isBinary) { if (stt) { const b = Buffer.isBuffer(data) ? data : Buffer.from(data); stt.write(b); sttBytes += b.length; } return; }
    let msg: any; try { msg = JSON.parse(data.toString()); } catch { return; }
    switch (msg?.type) {
      case 'mic_start':
        interrupted = true; utterance++; send({ type: 'flush' }); // RC-11: barge-in — cut current TTS + tell the client to drop queued audio
        if (stt) { try { stt.end(); } catch { /* */ } }
        sttBytes = 0; // meter this utterance's audio for STT cost
        stt = googleSTT.open({
          sampleRate: SAMPLE_RATE,
          onInterim: (t) => send({ type: 'transcript', text: t, final: false }),
          onFinal: (t) => { send({ type: 'transcript', text: t, final: true }); stt = null; void recordVoice('stt', sttBytes / 32000, {}); sttBytes = 0; if (t) void runVoiceTurn(t); },
          onError: (e) => { send({ type: 'stt_error', message: e.message }); stt = null; },
        });
        send({ type: 'listening' });
        break;
      case 'mic_end':
        if (stt) { try { stt.end(); } catch { /* */ } } // end-of-utterance → STT emits final → turn
        break;
      case 'interrupt':
        interrupted = true; utterance++; send({ type: 'flush' });
        break;
      case 'voice':
        profile = profileById(msg.id);
        send({ type: 'voice', id: profile.id, label: profile.label });
        break;
      case 'text': // typing is allowed in the voice panel too
        void runVoiceTurn(String(msg.text ?? ''));
        break;
      case 'journey_next': // advance the pinned journey one step (voice-led walk; operator-paced)
        void runWalkStep();
        break;
    }
  });

  ws.on('close', () => { if (stt) { try { stt.end(); } catch { /* */ } stt = null; } });
}
