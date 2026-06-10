/**
 * Environment readiness gate (V5 Guided Experience Platform, Phase 3). A PURE computation over an
 * environment's REAL execution-context fields (migration 0022) — mirrors the shipped graph authorityReadiness
 * shape so the console renders it the same way. Never manual. Turns "is this environment fit to demo against?"
 * into an explainable, gated answer (the constitution's "Which environment is compatible? / What is broken?").
 */
export interface EnvReadinessInput {
  connectionTarget?: string | null;
  certificationStatus?: string | null;  // uncertified | in_review | certified
  verificationState?: string | null;    // unverified | verified | stale
  lastVerifiedDays?: number | null;      // age of last_verified in days (null = never)
  knownIssues?: number;                  // count of known_issues entries
  isProduction?: boolean;
}
export interface ReadinessGate { name: string; ok: boolean; detail: string }
export interface EnvReadiness { gates: ReadinessGate[]; passed: number; total: number; ready: boolean }

export function computeEnvironmentReadiness(i: EnvReadinessInput): EnvReadiness {
  const g = (name: string, ok: boolean, detail: string): ReadinessGate => ({ name, ok, detail });
  const gates: ReadinessGate[] = [
    g('Endpoint configured', !!i.connectionTarget, i.connectionTarget ? 'endpoint set' : 'no connection target'),
    g('Certified', i.certificationStatus === 'certified', i.certificationStatus || 'uncertified'),
    g('Verified', i.verificationState === 'verified', i.verificationState || 'unverified'),
    g('Verification fresh', i.lastVerifiedDays != null && i.lastVerifiedDays <= 90, i.lastVerifiedDays == null ? 'never verified' : `${Math.round(i.lastVerifiedDays)}d ago`),
    g('No known issues', (i.knownIssues ?? 0) === 0, `${i.knownIssues ?? 0} known issue(s)`),
    g('Demo (non-prod) target', !i.isProduction, i.isProduction ? 'points at PRODUCTION' : 'non-production'),
  ];
  const passed = gates.filter((x) => x.ok).length;
  return { gates, passed, total: gates.length, ready: passed === gates.length };
}
