import { createContext, useContext } from 'react';

/* Real console data fetched from the web SSOT (/api/console/data). Subset the control room
   uses; null until the fetch resolves (components fall back to scripted defaults). */
export interface RealProduct {
  id: string; name: string; domain: string; tagline: string; version: string; mk: string; color: string;
  chunks: number; coverage: number; demos: number; kbValidated: number; env: string; envStatus: string;
  graphNodes: number; graphFlows: number; status: string;
}
export interface RealKnowledge { id: string; title: string; content: string; type: string; conf: number; source: string; verified: string; ver: string; status: string }
export interface RealCost { k: string; v: number; color: string; pct: number }
export interface RealData {
  workspace?: { name: string; sub: string };
  products: RealProduct[];
  knowledge: RealKnowledge[];
  kbTypes: Record<string, { label: string; cls: string }>;
  costBreakdown: RealCost[];
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
