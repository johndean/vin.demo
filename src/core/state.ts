/** Session state for the single LangGraph loop. Survives interrupts; the
 *  stakeholder collection (F) and discovery fields (E) live here and persist
 *  onto the entity model. Increment 1 fills utterance → interpretation → retrieved. */
import { Annotation } from '@langchain/langgraph';
import type { Interpretation } from './llm.js';
import type { NavResult, ActionScan } from './driver.js';
import type { ExecutionMode } from './safety.js';
import type { Stakeholder } from './stakeholders.js';

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
}

export const DemoState = Annotation.Root({
  // Inputs / config
  utterance: Annotation<string>(),
  productId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  sessionId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  role: Annotation<string>({ reducer: (_, b) => b, default: () => 'admin' }),
  mode: Annotation<ExecutionMode>({ reducer: (_, b) => b, default: () => 'read-only' }),
  // Per-session URL override (operator picked a product but pointed its adapter at a different host,
  // e.g. a staging URL). null → use the product's configured baseUrl. The driver merges it over the
  // resolved ProductWebConfig; everything else (login, selectors, knowledge) is unchanged.
  baseUrl: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),

  // interpret node
  interpretation: Annotation<Interpretation | null>({ reducer: (_, b) => b, default: () => null }),

  // retrieve node
  retrieved: Annotation<RetrievedChunk[]>({ reducer: (_, b) => b, default: () => [] }),
  gated: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),

  // navigate node
  navigation: Annotation<NavResult | null>({ reducer: (_, b) => b, default: () => null }),
  actionScan: Annotation<ActionScan[]>({ reducer: (_, b) => b, default: () => [] }),
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
