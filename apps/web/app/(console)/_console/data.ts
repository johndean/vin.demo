/* Console data CONTRACT (client-safe). Real values come from the DB via lib/console-data.ts
   (server) and are provided through DataProvider/useData. EMPTY_VD is the fallback so a DB
   outage renders honest empty states — never fabricated data. */

export interface ProductRow {
  id: string; name: string; domain: string; tagline: string;
  version: string; versions: string[]; mk: string; color: string; status: string;
  coverage: number; chunks: number; demos: number;
  kbValidated: number; kbReview: number; kbStale: number;
  env: string; envStatus: string; lastReset: string; graphNodes: number; graphFlows: number;
}
export interface KnowledgeRow { id: string; title: string; content: string; type: string; conf: number; source: string; verified: string; ver: string; status: string }
export interface PersonaRow { id: string; name: string; scope: string; limits: string; calls: number; brand: string; color: string }
export interface StakeholderRow { id: string; name: string; role: string; initials: string; color: string; active: boolean; interest: string; open: number; asked: number }
export interface CustomerRow { id: string; name: string; seg: string; stage: string; product: string; sessions: number; stakeholders: number; next: string; color: string; hot: boolean }
export interface SessionRow { id: string; customer: string; product: string; scenario: string; when: string; mode: string; status: string; dur: string; cost: number; llm: number; conf: number | null; stakeholders: number }
export interface EvalRow { id: string; name: string; score: number; target: number; runs: number; trend: string; invert?: boolean; fmt?: string }
export interface CostRow { k: string; v: number; color: string; pct: number }
export interface EvalRunRow { id: string; suite: string; passed: number; total: number; when: string }

export interface VDType {
  workspace: { name: string; sub: string };
  products: ProductRow[];
  knowledge: KnowledgeRow[];
  kbTypes: Record<string, { label: string; cls: string }>;
  personas: PersonaRow[];
  stakeholders: StakeholderRow[];
  customers: CustomerRow[];
  sessions: SessionRow[];
  evals: EvalRow[];
  costBreakdown: CostRow[];
  evalRuns: EvalRunRow[];
}

export const EMPTY_VD: VDType = {
  workspace: { name: 'VIN Demo', sub: 'workspace' },
  products: [], knowledge: [], kbTypes: {}, personas: [], stakeholders: [],
  customers: [], sessions: [], evals: [], costBreakdown: [], evalRuns: [],
};
