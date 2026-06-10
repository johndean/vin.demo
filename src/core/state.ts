/** Session state for the single LangGraph loop. Survives interrupts; the
 *  stakeholder collection (F) and discovery fields (E) live here and persist
 *  onto the entity model. Increment 1 fills utterance → interpretation → retrieved. */
import { Annotation } from '@langchain/langgraph';
import type { Interpretation } from './llm.js';
import type { NavResult } from './driver.js';
import type { ExecutionMode } from './safety.js';
import type { Stakeholder } from './stakeholders.js';
import type { ConfidenceBand } from './retrieval.js';

/** A place in the demo we can return to after a detour (mid-flight pivot support). */
export interface Position {
  intent: string;
  url: string;
  answer: string | null;
}

export interface RetrievedChunk {
  content: string;
  category: string;
  confidence: number;
  source: string;
  last_verified: string | null;
  product_version: string | null;
  product_version_status: string | null; // active | deprecated | retired (Gap B lifecycle)
  validation_status: string;
  distance: number; // cosine distance (lower = closer)
  // Provenance (migration 0011; lifecycle_state from the chunk, source_* from LEFT JOIN knowledge_sources).
  // Optional so constructed/test chunks and older callers don't need to supply them.
  lifecycle_state?: string;       // draft | pending_review | validated | deprecated | archived
  source_owner?: string | null;   // who owns the source (provenance the AI can state)
  source_title?: string | null;   // the source's governed title
  source_type?: string | null;    // doc | faq | sop | release_note | competitor_positioning | recon | manual
  validated_by?: string | null;   // who validated this chunk (provenance the AI can state)
  validated_at?: string | null;   // when it was validated (ISO date string)
}

export const DemoState = Annotation.Root({
  // Inputs / config
  utterance: Annotation<string>(),
  productId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  sessionId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  role: Annotation<string>({ reducer: (_, b) => b, default: () => 'admin' }),
  mode: Annotation<ExecutionMode>({ reducer: (_, b) => b, default: () => 'read-only' }),
  // V5 Journey-driven runtime (mig 0026): when journeyId is set, the loop WALKS the pinned journey's
  // story_flow instead of free-roaming. journeyStep is the current step index — it PERSISTS across turns
  // via the thread checkpointer and must NOT be passed as a per-turn invoke input (so it advances, not
  // resets). null journeyId / absent = today's intent-driven default, unchanged.
  journeyId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  journeyStep: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  // Per-turn: TRUE only on an explicit journey WALK turn (set by walkJourney). An off-script question on a
  // journey-pinned session leaves this false → it's answered normally (free-roam) and consumes NO journey step.
  // Always passed explicitly per turn (never omitted) so it can't retain a stale `true` via the checkpointer.
  journeyAdvance: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  // Per-session URL override (operator picked a product but pointed its adapter at a different host,
  // e.g. a staging URL). null → use the product's configured baseUrl. The driver merges it over the
  // resolved ProductWebConfig; everything else (login, selectors, knowledge) is unchanged.
  baseUrl: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  // Client-driven navigation (desktop embedded browser): instead of driving a server-side Playwright
  // browser + screenshotting, the navigate node resolves the demo-graph node to a label/selectors and
  // emits a click instruction the embedded browser performs in the operator's OWN logged-in session.
  // No server creds, no screenshot latency, and the human can take over the same pane.
  clientNav: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  // Optional per-turn navigation HINT (Phase 4 REEL→node re-model): a node intent_label the turn declares it
  // targets. driveTo PREFERS this node when it's among the verified candidates (a deterministic scripted path);
  // it falls back to the LLM pickNode when absent or unmatched, so the intent-driven default is unchanged.
  navHint: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  // Per-turn output: the navigation instruction for the client to perform (clientNav only).
  navAction: Annotation<{ label?: string; selectors?: string[]; url?: string } | null>({ reducer: (_, b) => b, default: () => null }),
  // Active specialist persona (when handed off): its system-prompt overlay shapes the LLM-generated
  // text (explain / discovery) and its confidence threshold tightens the retrieval gate. Empty/undefined
  // = the lead consultant (no overlay) — the default behavior is unchanged.
  personaPreamble: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  minConfidence: Annotation<number | null>({ reducer: (_, b) => b, default: () => null }),
  // Persona knowledge hierarchy (re-ranks retrieval) + the graded confidence band the gate produced.
  knowledgePriority: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  band: Annotation<ConfidenceBand>({ reducer: (_, b) => b, default: () => 'high' }),

  // interpret node
  interpretation: Annotation<Interpretation | null>({ reducer: (_, b) => b, default: () => null }),

  // retrieve node
  retrieved: Annotation<RetrievedChunk[]>({ reducer: (_, b) => b, default: () => [] }),
  gated: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  // Gated answer but relevant enough to still navigate (show the real screen, soft on specifics).
  navigable: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),

  // navigate node
  navigation: Annotation<NavResult | null>({ reducer: (_, b) => b, default: () => null }),
  // (The raw page scan stays local to driveTo, which derives blockedMutations from it; it was never read
  // off state, so the dead `actionScan` channel was removed. scanActions()/ActionScan remain — they're live.)
  blockedMutations: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),

  // multi-turn: where we are, the breadcrumb stack for return-to-context, and explain output
  currentPosition: Annotation<Position | null>({ reducer: (_, b) => b, default: () => null }),
  contextStack: Annotation<Position[]>({ reducer: (_, b) => b, default: () => [] }),
  explanation: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),

  // active discovery (P2.2 / Gap E): the one discovery question offered after an answer (per-turn output).
  discoveryPrompt: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),

  // recovery / interrupt governance (P2.1): lifecycle status persists across turns
  // (deliberately NOT reset by interpret, unlike the per-turn outputs above).
  sessionStatus: Annotation<'active' | 'paused' | 'stopped' | 'done'>({ reducer: (_, b) => b, default: () => 'active' }),

  // multi-stakeholder (P2.3 / Gap F): `speaker` is a per-turn input naming who's talking;
  // `activeStakeholder` is resolved from the collection by the whoSpeaks node each turn.
  speaker: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  activeStakeholder: Annotation<Stakeholder | null>({ reducer: (_, b) => b, default: () => null }),

  // Trace — appends, so "why did you show this?" can replay the loop's decisions.
  trace: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

export type DemoStateT = typeof DemoState.State;
