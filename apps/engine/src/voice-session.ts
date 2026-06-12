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
import { bootSession, runTurn, runWalkStep as walkOneStep, LOOP, type SessionCtx, type SessionTarget } from '../../../src/core/live-session.js';
import { googleSTT } from './voice/stt-google.js';
import { googleTTS } from './voice/tts-google.js';
import { elevenLabsTTS } from './voice/tts-elevenlabs.js';
import { openElevenWs, type ElevenWsHandle } from './voice/tts-elevenlabs-ws.js'; // RC-31: word-level WS streaming (gated)
import { shouldReplayPendingBargein } from './voice/barge-in.js'; // #19/L-2: pure TTL guard (deterministically tested)
import { splitSentences } from './voice/segmenter.js';
import type { TTSProvider } from './voice/providers.js';
import { profileById, defaultProfile, voiceCatalog } from './voice/profiles.js';
import type { STTStream, VoiceProfile } from './voice/providers.js';
import { loadPersona } from '../../../src/core/persona.js';
import { beginCostSession, recordVoice } from '../../../src/core/cost.js';
import { journeyWalkPlan, startJourneyRun, completeJourneyRun } from '../../../src/core/journeys.js';

const SAMPLE_RATE = 16000;

// TTS routing per the SELECTED voice's provider: a Google voice → Google, an ElevenLabs voice → ElevenLabs.
// Evaluated per call so a mid-session voice switch (or toggling the env key) takes effect immediately. An
// ElevenLabs voice with no key configured falls back to Google (safe — never silent); a Google voice always
// uses Google. On any ElevenLabs error the caller's speak() catch already degrades gracefully.
function selectTTS(voice: VoiceProfile): TTSProvider {
  return (voice.provider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) ? elevenLabsTTS : googleTTS;
}

// RC-31: WORD/TOKEN-LEVEL WS streaming is used for a turn ONLY when ALL hold — (a) the selected voice is an
// ElevenLabs voice, (b) ELEVENLABS_API_KEY is set, AND (c) the ELEVENLABS_WS env flag is truthy. Evaluated per
// turn so toggling the flag/voice mid-session takes effect immediately. OFF by default → byte-identical to the
// per-sentence selectTTS().synthesize path. On any WS failure the turn degrades to that path (see runVoiceTurn).
function wsStreamEnabled(voice: VoiceProfile): boolean {
  const flag = process.env.ELEVENLABS_WS;
  const on = flag && flag !== '0' && flag.toLowerCase() !== 'false';
  return Boolean(on && voice.provider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY);
}

export async function startVoiceSession(ws: WebSocket, target: SessionTarget = {}): Promise<void> {
  const send = (o: Record<string, unknown>) => { try { ws.send(JSON.stringify(o)); } catch { /* socket closing */ } };

  const ctx: SessionCtx | null = await bootSession('voice', target);
  if (!ctx) { send({ type: 'error', message: 'No product configured — pick a target or set PO_VIN_PRODUCT_ID.' }); try { ws.close(); } catch { /* */ } return; }
  beginCostSession(ctx.sessionId); // attribute this voice session's LLM + STT/TTS costs to it

  // If a specialist is active (hand-off), speak in its configured voice; else the default profile.
  const bootPersona = await loadPersona(ctx.personaId);
  let profile: VoiceProfile = bootPersona?.voiceProfileId ? profileById(bootPersona.voiceProfileId) : defaultProfile();
  let stt: STTStream | null = null;
  let answering = false;
  let pendingBargein: { text: string; at: number } | null = null; // #19/L-2: a barge-in transcript that arrived while a turn/walk-step was in flight → REPLAYED when it settles, instead of being dropped by the busy guard
  let interrupted = false;        // barge-in flag: stop emitting TTS for the current answer
  let streamedThisTurn = false;   // RC-03: did we already speak this turn's answer sentence-by-sentence (streamed)?
  let utterance = 0;              // RC-11: monotonic id, bumped on barge-in so stale TTS from a prior turn bails
  let ttsChain: Promise<void> = Promise.resolve();
  let sttBytes = 0;               // LINEAR16 @16kHz mono bytes for the current utterance → STT audio seconds
  let wsTts: ElevenWsHandle | null = null; // RC-31: the OPEN ElevenLabs WS for the current turn (null unless gated on + open)
  let wsTtsU = -1;                // RC-31: which utterance owns wsTts — a stale handle from a superseded turn is ignored/closed
  // Experience-audit #14: the per-turn WS open runs CONCURRENTLY with the brain turn (not awaited before it). This
  // promise resolves to whether the WS opened; the say_chunk handler awaits it before the FIRST feed, so the whole
  // turn commits to ONE transport (all-WS or all-per-sentence) in order — never interleaving the two.
  let wsReady: Promise<boolean> = Promise.resolve(false);
  const speaker = 'Procurement';

  send({ type: 'start', product: ctx.productName, scenario: 'Voice', mode: ctx.mode, loop: LOOP, sessionId: ctx.sessionId, interactive: true, voice: profile.id, profiles: voiceCatalog().map((p) => ({ id: p.id, label: p.label })) });
  send({ type: 'ready' });

  // Speak one answer: synthesize sentence-by-sentence so audio starts on the first sentence.
  const speak = async (text: string) => {
    const myU = utterance; // RC-11: bail the moment a newer utterance supersedes this one (barge-in)
    for (const sentence of splitSentences(text)) {
      if (interrupted || myU !== utterance) return;
      try {
        const { audio, mime } = await selectTTS(profile).synthesize(sentence, profile);
        void recordVoice('tts', sentence.length, { voice: profile.id }); // TTS billed by characters synthesized
        if (interrupted || myU !== utterance) return;
        if (audio.length) send({ type: 'audio', mime, data: audio.toString('base64') });
      } catch (e: any) {
        send({ type: 'tts_error', message: String(e?.message ?? e) }); // degrade gracefully — text was already sent
      }
    }
  };

  // RC-31: open ONE ElevenLabs WS for this turn (word-level streaming). Best-effort: resolves true if the
  // socket opened and audio will flow through it; false on any failure (open timeout/error/non-EL) so the
  // caller leaves wsTts null and the existing per-sentence speak() path runs UNCHANGED for the turn. Audio
  // frames are forwarded as the SAME {type:'audio',mime,data} the client already plays (mp3 → no client change).
  const openTurnWs = async (): Promise<boolean> => {
    if (!wsStreamEnabled(profile)) return false;
    const myU = utterance;
    try {
      const handle = await openElevenWs(profile, {
        onAudio: (audio, mime) => {
          if (interrupted || myU !== utterance) return; // barge-in / superseded turn → drop late audio
          // #33: tag word-level WS frames so the client routes these arbitrary mid-stream mp3 fragments to a
          // MediaSource (gapless) instead of decodeAudioData (which can't decode a standalone fragment). The
          // per-sentence Google path (speak(), below) sends NO source → the client's existing decode path, unchanged.
          if (audio.length) send({ type: 'audio', mime, data: audio.toString('base64'), source: 'ws' });
        },
        // Post-open transport error: stop using the WS for the rest of the turn. Already-fed sentences can't be
        // re-spoken, but no FURTHER say_chunk is lost — voiceEmit falls back to speak() once wsTts is cleared.
        onError: (e) => { if (interrupted || myU !== utterance) return; /* error after an intentional barge-in teardown — not a real failure, don't toast */ if (wsTtsU === myU) { try { wsTts?.abort(); } catch { /* */ } wsTts = null; } send({ type: 'tts_error', message: String(e?.message ?? e) }); },
      });
      if (interrupted || myU !== utterance) { try { handle.abort(); } catch { /* */ } return false; } // barge-in during open
      wsTts = handle; wsTtsU = myU;
      return true;
    } catch (e: any) {
      // Open failed → silent fallback to per-sentence for this turn (never crash, never silent).
      send({ type: 'tts_error', message: `WS unavailable, using per-sentence TTS: ${String(e?.message ?? e)}` });
      return false;
    }
  };

  // RC-31: flush + close this turn's WS (EOS), meter its characters best-effort, then null it. Awaited in the
  // turn's finally so queued WS audio finishes before turn_done — mirrors `await ttsChain` for the sentence path.
  const closeTurnWs = async () => {
    const h = wsTts; if (!h) return;
    wsTts = null;
    try {
      void recordVoice('tts', h.charCount(), { voice: profile.id, ws: true }); // best-effort, by characters fed
      await h.end();
    } catch { /* socket already gone */ }
  };

  // Forward every brain event to the client; when the consultant SAYS something, also speak it.
  const voiceEmit = (ev: Record<string, unknown>) => {
    // RC-03: a streamed sentence (say_chunk) is spoken IMMEDIATELY and NOT forwarded to the client — it's a
    // server-internal TTS signal (the full `message` still arrives for the chat panel). Speaking each sentence
    // as the answer streams is what lets audio start on sentence 1 instead of after the whole reply.
    if (ev.type === 'say_chunk' && typeof ev.text === 'string') {
      if (!interrupted) {
        streamedThisTurn = true;
        const text = ev.text;
        const myU = utterance;
        // #14: serialize EVERY chunk through ttsChain and gate the first on the concurrently-opening WS (wsReady),
        // so (a) the brain turn never blocks ~6s on the WS open, and (b) the turn commits to ONE transport in order
        // — all WS feeds (continuous word-level audio) OR all per-sentence speak(), never interleaved (which could
        // overlap WS audio with speak() audio). If the WS died mid-turn (onError cleared wsTts), it falls back to
        // speak() for the remaining sentences — never silent.
        ttsChain = ttsChain.then(async () => {
          if (interrupted || myU !== utterance) return;
          const open = await wsReady;
          if (interrupted || myU !== utterance) return;
          if (open && wsTts && wsTtsU === utterance) wsTts.feed(text);
          else await speak(text);
        });
      }
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
    wsReady = openTurnWs(); // #14: open the word-level WS CONCURRENTLY with the brain turn (don't block ~6s on it)
    try {
      await runTurn(ctx, { speaker, text: q, stream: true }, voiceEmit); // RC-03: stream the spoken answer to TTS
      await wsReady; // #14: ensure the concurrent open has settled (wsTts set or not) before we drain + close
      await ttsChain; // let queued TTS finish before signaling the turn is done
      await closeTurnWs(); // RC-31: EOS + drain the WS (no-op if it wasn't open) so its audio finishes too
    } catch (e: any) {
      send({ type: 'error', message: String(e?.message ?? e) });
    } finally {
      await wsReady.catch(() => {}); // #14: if runTurn rejected we skipped the success-path await — reconcile the in-flight WS open NOW so the abort below actually closes it (no leaked socket / post-turn audio)
      try { wsTts?.abort(); } catch { /* */ } wsTts = null; // RC-31: ensure no WS lingers past the turn (covers the catch path)
      answering = false;
      // #19/L-2: if a stashed barge-in is now being answered, DON'T emit this turn's turn_done — the replay's own
      // finally emits the real idle turn_done (M-1: keep turn_done ⟹ mutex-free so a journey_next can't be dropped).
      if (!replayPendingBargein()) send({ type: 'turn_done' });
    }
  };

  // #19/L-2: answer a stashed barge-in the instant we go idle (called from both finally blocks). Null-then-check
  // so it can NEVER double-fire across the two finallys (only one turn is ever in flight; pendingBargein is
  // cleared before the re-run). TTL-bounded (8s) so a question the buyer effectively abandoned during an unusually
  // slow in-flight turn isn't replayed into a stale context. Single-stash = answer the LATEST barged-in question.
  // Returns TRUE if it started a replay. The caller then SUPPRESSES its own turn_done: a replay re-acquires the
  // `answering` mutex synchronously (runVoiceTurn sets answering=true before its first await), so emitting the
  // original turn's turn_done here would tell the client "idle, ready for the next step" while the buyer's question
  // is still being answered — the client would fire journey_next, hit the busy guard, and silently lose the advance
  // (review M-1). Instead the replay's OWN finally emits the real idle turn_done once it settles, preserving the
  // operator-paced "turn_done ⟹ mutex free" contract.
  const replayPendingBargein = (): boolean => {
    const p = pendingBargein; pendingBargein = null;
    if (p && shouldReplayPendingBargein(p, Date.now())) { void runVoiceTurn(p.text); return true; }
    return false;
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
    wsReady = openTurnWs(); // #14: open the word-level WS CONCURRENTLY with the walk step (don't block ~6s on it)
    try {
      // #19: the journey_step emit + advance turn + RC-02 position sync now live in the SHARED stepper (so the
      // eval exercises this exact body). Voice keeps owning its TTS/WS lifecycle around it (stream:true).
      const res = await walkOneStep(ctx, walkPlan, idx, voiceEmit, { stream: true, speaker: 'Presenter' });
      await wsReady; // #14: ensure the concurrent open settled before draining + closing
      await ttsChain;
      await closeTurnWs(); // RC-31: EOS + drain the WS (no-op if it wasn't open)
      walkStep = res.journeyStep ?? idx + 1; // RC-02: mirror the graph-owned position the stepper returned
      if (res.isComplete) { if (walkRun) await completeJourneyRun(walkRun.runId, 'completed').catch(() => {}); send({ type: 'journey_complete', steps: walkPlan.length }); }
    } catch (e: any) {
      send({ type: 'error', message: String(e?.message ?? e) });
    } finally {
      await wsReady.catch(() => {}); // #14: if runTurn rejected we skipped the success-path await — reconcile the in-flight WS open NOW so the abort below actually closes it (no leaked socket / post-turn audio)
      try { wsTts?.abort(); } catch { /* */ } wsTts = null; // RC-31: never let a WS linger past the walk step
      answering = false;
      // #19/L-2: a question barged in DURING this walk step → answer it now; suppress THIS step's turn_done so the
      // client doesn't try to advance (journey_next) into the busy mutex — the replay's finally sends turn_done (M-1).
      if (!replayPendingBargein()) send({ type: 'turn_done' });
    }
  };

  // Experience-audit #15: COLD-START SPOKEN BRIDGE. The first walk step is several seconds of silence in front
  // of the buyer (DB boot + the first narration's LLM call + nav + TTS). Speak a cheap, cached, TEMPLATED opener
  // the instant the walk launches — no LLM, no extra latency — so the buyer hears a warm human voice immediately
  // while the real first beat is prepared. It's queued on ttsChain BEFORE runWalkStep, so it plays first and the
  // first narration follows in order (never overlapping); a barge-in bails it like any other utterance. Honest:
  // it only states what we're about to do + that it's loading — no product claims, no fabricated numbers.
  const speakColdStartBridge = () => {
    const jn = walk?.journey?.name?.trim();
    const who = bootPersona?.name ?? 'Consultant';
    const bridge = `Let me bring up ${ctx.productName}${jn ? ` and walk you through ${jn}` : ''} — give me just a moment while it loads.`;
    voiceEmit({ type: 'message', side: 'ai', who, role: 'VIN Demo', text: bridge });
  };

  // Open the demo: a pinned journey AUTO-plays its first step (voice-led); otherwise an operator-set
  // opening scenario is asked. Subsequent steps are driven by the client's {type:'journey_next'}.
  // #19/L-2 (now FIXED): a barge-in DURING step 0 (the cold-start bridge invites it) used to hit the busy guard and
  // be DROPPED; it is now stashed in pendingBargein and replayed the moment the step settles (replayPendingBargein).
  if (ctx.journeyId && walkPlan.length) { speakColdStartBridge(); void runWalkStep(); }
  else if (target.scenario?.trim()) void runVoiceTurn(target.scenario.trim());

  ws.on('message', (data: any, isBinary: boolean) => {
    if (isBinary) { if (stt) { const b = Buffer.isBuffer(data) ? data : Buffer.from(data); stt.write(b); sttBytes += b.length; } return; }
    let msg: any; try { msg = JSON.parse(data.toString()); } catch { return; }
    switch (msg?.type) {
      case 'mic_start':
        interrupted = true; utterance++; send({ type: 'flush' }); // RC-11: barge-in — cut current TTS + tell the client to drop queued audio
        try { wsTts?.abort(); } catch { /* */ } wsTts = null; // RC-31: barge-in also tears down the word-level WS so it stops emitting audio
        if (stt) { try { stt.end(); } catch { /* */ } }
        sttBytes = 0; // meter this utterance's audio for STT cost
        stt = googleSTT.open({
          sampleRate: SAMPLE_RATE,
          onInterim: (t) => send({ type: 'transcript', text: t, final: false }),
          onFinal: (t) => { send({ type: 'transcript', text: t, final: true }); stt = null; void recordVoice('stt', sttBytes / 32000, {}); sttBytes = 0; if (t) { if (answering) pendingBargein = { text: t, at: Date.now() }; else void runVoiceTurn(t); } }, // #19/L-2: if a turn/walk-step is still in flight, STASH (don't drop) — the finally replays it
          onError: (e) => { send({ type: 'stt_error', message: e.message }); stt = null; },
        });
        send({ type: 'listening' });
        break;
      case 'mic_end':
        if (stt) { try { stt.end(); } catch { /* */ } } // end-of-utterance → STT emits final → turn
        break;
      case 'interrupt':
        interrupted = true; utterance++; send({ type: 'flush' });
        try { wsTts?.abort(); } catch { /* */ } wsTts = null; // RC-31: barge-in — tear down the word-level WS too
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

  ws.on('close', () => { if (stt) { try { stt.end(); } catch { /* */ } stt = null; } try { wsTts?.abort(); } catch { /* */ } wsTts = null; }); // RC-31: also close any open TTS WS
}
