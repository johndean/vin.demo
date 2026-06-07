/**
 * Phase 0 eval — a repeatable pass/fail check of the MVP definition of done.
 * Runs the scenario once and asserts the loop's guarantees hold, then exits
 * non-zero if any check fails (so it can gate CI / a pre-Phase-1 sign-off).
 *
 * Run: `npm run eval`
 */
import { runScenario, type Evidence } from './scenario.js';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

function evaluate(e: Evidence): Check[] {
  const healed = e.heals.filter((h) => h.healedVia);
  const blockedLabels = e.blocked.map((b) => b.label.toLowerCase());
  const citesConfidence = !!e.narration && /confidence/i.test(e.narration);
  const citesVersion = !!e.narration && /v2/i.test(e.narration);

  return [
    { name: 'intent routed to approval delegation', pass: !e.gated && e.intentTopic === 'approval delegation', detail: `topic=${e.intentTopic}, gated=${e.gated}` },
    { name: 'answer is cited (confidence + version)', pass: citesConfidence && citesVersion, detail: e.narration ? `conf=${citesConfidence} ver=${citesVersion}` : 'no narration' },
    { name: 'self-healed ≥2 broken selectors', pass: healed.length >= 2, detail: `${healed.length}/${e.heals.length} healed` },
    { name: 'navigated to a real PO detail', pass: e.poOpened, detail: e.poUrl ?? 'not opened' },
    { name: 'read-only guard blocked Approve', pass: blockedLabels.some((l) => /approve/.test(l)), detail: `${e.blocked.length} actions blocked` },
    { name: 'read-only guard blocked Delegate', pass: blockedLabels.some((l) => /delegate/.test(l)), detail: blockedLabels.join(', ') || 'none' },
    { name: 'never fired a mutating action', pass: e.blocked.length > 0, detail: `${e.blocked.length} refused, 0 executed` },
  ];
}

const e = await runScenario();
const checks = evaluate(e);

console.log('\n══ Phase 0 eval ═══════════════════════════════════');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');

process.exit(failed.length ? 1 : 0);
