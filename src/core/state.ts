/** Session state for the single LangGraph loop. Survives interrupts; the
 *  stakeholder collection (F) and discovery fields (E) live here and persist
 *  onto the entity model. Increment 1 fills utterance → interpretation → retrieved. */
import { Annotation } from '@langchain/langgraph';
import type { Interpretation } from './llm.js';

export interface RetrievedChunk {
  content: string;
  category: string;
  confidence: number;
  source: string;
  last_verified: string | null;
  product_version: string | null;
  validation_status: string;
  distance: number; // cosine distance (lower = closer)
}

export const DemoState = Annotation.Root({
  // Inputs / config
  utterance: Annotation<string>(),
  productId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),

  // interpret node
  interpretation: Annotation<Interpretation | null>({ reducer: (_, b) => b, default: () => null }),

  // retrieve node
  retrieved: Annotation<RetrievedChunk[]>({ reducer: (_, b) => b, default: () => [] }),
  gated: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),

  // Trace — appends, so "why did you show this?" can replay the loop's decisions.
  trace: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

export type DemoStateT = typeof DemoState.State;
