/**
 * Interactive session — the SAME dynamic brain as the reel, but driven by LIVE utterances (typed
 * now; spoken in Phase 2) instead of the 3 canned questions. The engine holds one of these at a time:
 *   • GET /session/interactive opens the SSE and creates the session (emits `start` then `ready`),
 *   • POST /session/utterance feeds a question → one `runTurn` → events stream on the open SSE.
 * Zero new reasoning: it reuses bootSession + runTurn from the core loop.
 */
import { bootSession, runTurn, LOOP, type Emit, type SessionCtx, type SessionTarget } from '../../../src/core/live-session.js';

export interface InteractiveSession {
  ctx: SessionCtx;
  answering: boolean;
  ask(text: string, speaker?: string): Promise<void>;
}

/** Open an interactive session against the operator-chosen target, streaming its lifecycle events
 *  through `emit`. Returns null if no product is configured (pick a target or set PO_VIN_PRODUCT_ID)
 *  — the caller should close the stream. If the target carries an opening scenario, it's asked first. */
export async function startInteractive(emit: Emit, target: SessionTarget = {}): Promise<InteractiveSession | null> {
  const ctx = await bootSession('chat', target);
  if (!ctx) { emit({ type: 'error', message: 'No product configured — pick a target or set PO_VIN_PRODUCT_ID.' }); return null; }

  emit({ type: 'start', product: ctx.productName, scenario: 'Interactive', mode: ctx.mode, loop: LOOP, sessionId: ctx.sessionId, interactive: true });
  emit({ type: 'ready' }); // the client may now send utterances

  const session: InteractiveSession = {
    ctx,
    answering: false,
    async ask(text, speaker) {
      const q = (text ?? '').trim();
      if (!q) return;
      if (this.answering) { emit({ type: 'busy', message: 'Still answering the previous question — one moment.' }); return; }
      this.answering = true;
      try {
        await runTurn(ctx, { speaker: speaker?.trim() || 'Procurement', text: q }, emit);
      } catch (e: any) {
        emit({ type: 'error', message: String(e?.message ?? e) });
      } finally {
        this.answering = false;
        emit({ type: 'turn_done' });
      }
    },
  };
  // Opening scenario (operator-set): ask it automatically as the first turn, so the demo opens on the
  // operator's framing instead of waiting for input. Fire-and-forget — the answer streams on the SSE.
  if (target.scenario?.trim()) void session.ask(target.scenario.trim());
  return session;
}
