/**
 * Interactive session — the SAME dynamic brain as the reel, but driven by LIVE utterances (typed
 * now; spoken in Phase 2) instead of the 3 canned questions. The engine holds one of these at a time:
 *   • GET /session/interactive opens the SSE and creates the session (emits `start` then `ready`),
 *   • POST /session/utterance feeds a question → one `runTurn` → events stream on the open SSE.
 * Zero new reasoning: it reuses bootSession + runTurn from the core loop.
 */
import { bootSession, runTurn, LOOP, type Emit, type SessionCtx } from '../../../src/core/live-session.js';

export interface InteractiveSession {
  ctx: SessionCtx;
  answering: boolean;
  ask(text: string, speaker?: string): Promise<void>;
}

/** Open an interactive session, streaming its lifecycle events through `emit`. Returns null if the
 *  engine isn't seeded (PO_VIN_PRODUCT_ID missing) — the caller should close the stream. */
export async function startInteractive(emit: Emit): Promise<InteractiveSession | null> {
  const ctx = await bootSession('chat');
  if (!ctx) { emit({ type: 'error', message: 'PO_VIN_PRODUCT_ID not set — run `npm run seed`.' }); return null; }

  emit({ type: 'start', product: 'po.vin', scenario: 'Interactive', mode: ctx.mode, loop: LOOP, sessionId: ctx.sessionId, interactive: true });
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
  return session;
}
