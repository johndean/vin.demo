import { createContext, useContext } from 'react';

/* Real console data fetched from the web SSOT (/api/console/data). Subset the control room
   uses; null until the fetch resolves (components fall back to scripted defaults). */
// A demo journey (approved workflow) the scripted runner can present — ordered screens + per-screen captions.
export interface RealWorkflow {
  id: string; name: string; purpose: string; stakeholderType: string; personaType: string;
  sequence: string[]; stepScript: Record<string, string>; status: string; approved: boolean;
}
// V5 Phase 4 — the orchestration objects the Start Experience pre-flight reads (already in the SSOT payload).
export interface RealJourney { id: string; name: string; businessGoal: string; outcomeTitle: string; status: string; stakeholderNames: string[]; specialistRules: { personaName?: string | null }[]; missingCount: number }
export interface RealOutcome { id: string; title: string; status: string }
export interface RealCommitteeMember { id: string; name: string; role: string }
export interface RealProduct {
  id: string; name: string; domain: string; tagline: string; version: string; mk: string; color: string;
  chunks: number; coverage: number; demos: number; kbValidated: number; env: string; envStatus: string;
  graphNodes: number; graphFlows: number; status: string;
  defaultMode?: string; // per-site default execution mode (read-only|safe|approval|execution), set in the web console
  workflows?: RealWorkflow[]; // approved demo journeys (for the scripted ▶ Present runner)
  // V5 Phase 4 — Start Experience pre-flight inputs (optional; present from the web SSOT once authored).
  journeys?: RealJourney[]; outcomes?: RealOutcome[]; committee?: RealCommitteeMember[];
}
export interface RealKnowledge { id: string; title: string; content: string; type: string; conf: number; source: string; verified: string; ver: string; status: string }
export interface RealCost { k: string; v: number; color: string; pct: number }
/* A specialist the consultant can hand off to (from the console persona roster). */
export interface RealPersona { id: string; name: string; role: string; color: string; status: string; lead: boolean; productIds: string[]; archived: boolean }
// A recorded guided demo tour — ordered real-product actions + captions, played back in the embedded browser.
export interface RealTourStep { kind: string; url: string; selector: string; label: string; value: string; caption: string }
export interface RealTour { id: string; productId: string; name: string; description: string; steps: RealTourStep[] }
export interface RealData {
  workspace?: { name: string; sub: string };
  products: RealProduct[];
  knowledge: RealKnowledge[];
  kbTypes: Record<string, { label: string; cls: string }>;
  costBreakdown: RealCost[];
  personas?: RealPersona[];
  tours?: RealTour[]; // guided demo tours (record-and-replay), per product
}

const Ctx = createContext<RealData | null>(null);

export function RealDataProvider({ value, children }: { value: RealData | null; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The real demo dataset from the SSOT, or null while loading / unavailable. */
export function useReal(): RealData | null {
  return useContext(Ctx);
}

/** The product the control room demos (po.vin) from real data, if present. */
export function useDemoProduct(): RealProduct | null {
  const real = useReal();
  if (!real?.products?.length) return null;
  return real.products.find((p) => /po\.vin|^demo/i.test(p.name)) ?? real.products[0];
}
