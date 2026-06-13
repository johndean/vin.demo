/**
 * Phase 27 eval — P4 LIVE DISCOVERY ROUTER (off-script proof interjection). When a buyer raises an objection
 * mid-demo on a journey-pinned session, the AI navigates to the GROUNDED PROOF screen that answers it (the
 * facilitator selects it from the journey's own beats), instead of a free-roam guess — "buyer signals re-rank
 * the next grounded proof". This is an off-script interjection: it consumes NO journey step and never fabricates
 * (a knowledge-only or off-topic concern degrades to honest free-roam). Behind the FACILITATOR flag (OFF default).
 *
 * Layers: (A) selectProof is a pure, zero-gap selector (synthetic beats; airtight); (B) the node-vs-beat mapping
 * proofNodeFor uses (synthetic plan; airtight — only a real 'node' proof is navigable, a knowledge 'beat' is not);
 * (C) the REAL proofNodeFor against a freshly-assembled journey (DB, no interpreter/LLM — never returns a fabricated
 * label); (D) a TOLERANT live check that an off-script objection consumes no step + is answered + any navigation
 * targets a real plan node (the interpreter classification is non-deterministic, so this asserts the CONTRACT, not a
 * fixed screen). Run: npm run eval:phase27   (and FACILITATOR=1 npm run eval:phase27 to exercise the ON path)
 */
import { db } from './db.js';
import { recordEvalRun } from './eval-record.js';
import { assembleJourney } from './journey-assembler.js';
import { journeyWalkPlan } from './journeys.js';
import { selectProof, toFacilitationBeats, facilitatorEnabled } from './facilitator.js';
import { proofNodeFor, buildGraph } from './graph.js';
import { bootSession, runTurn } from './live-session.js';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error('PO_VIN_PRODUCT_ID not set — run `npm run seed`.');

const checks: { name: string; pass: boolean; detail: string }[] = [];
const ok = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

// ── (A) selectProof — pure, zero-gap (synthetic beats; no DB/LLM) ──
// Beat 2 is GROUNDED + answers "approval delegation routing"; beat 4 is UNGROUNDED but its words match — it must
// NEVER be selected (the zero-gap invariant: a proof shown to answer a concern is always trust-gated).
const beats = [
  { index: 0, phase: 'open' as const, branchKey: null, grounded: true },
  { index: 1, phase: 'discover' as const, branchKey: null, grounded: true },
  { index: 2, phase: 'show' as const, branchKey: 'approval delegation routing controls', grounded: true },
  { index: 3, phase: 'proof' as const, branchKey: 'cfo budget cost reporting', grounded: true },
  { index: 4, phase: 'proof' as const, branchKey: 'security access control policy', grounded: false }, // ungrounded on purpose
  { index: 5, phase: 'close' as const, branchKey: null, grounded: true },
];
const p1 = selectProof(beats, 'How does approval delegation routing work for our team?');
ok('A: selectProof returns the GROUNDED proof beat that answers the concern (beat 2)', p1.beatIndex === 2 && p1.mustGround === false, `beat=${p1.beatIndex}`);
const p2 = selectProof(beats, 'What about data security access control?');
ok('A: a concern whose only match is UNGROUNDED → beatIndex null + mustGround (never the ungrounded beat)', p2.beatIndex === null && p2.mustGround === true, `beat=${p2.beatIndex}, mustGround=${p2.mustGround}`);
const p3 = selectProof(beats, 'capital of france weather today');
ok('A: an off-topic concern (no overlap) → null + mustGround (honest degrade, never forced)', p3.beatIndex === null && p3.mustGround === true, `beat=${p3.beatIndex}`);
ok('A: empty concern → null + mustGround (no spurious proof)', selectProof(beats, '   ').beatIndex === null && selectProof(beats, '').mustGround === true);
const p4 = selectProof(beats, 'cfo budget cost questions');
ok('A: selectProof matches the RIGHT grounded proof by token overlap (beat 3, not beat 2)', p4.beatIndex === 3, `beat=${p4.beatIndex}`);
// Determinism of the tie-break: two grounded beats both answer → the LOWEST index wins (.find is index-ordered).
const tieBeats = [
  { index: 0, phase: 'show' as const, branchKey: 'budget cost control alpha', grounded: true, navigable: true },
  { index: 1, phase: 'show' as const, branchKey: 'budget cost control beta', grounded: true, navigable: true },
];
ok('A: multiple grounded matches → the LOWEST index wins (deterministic tie-break)', selectProof(tieBeats, 'budget cost control review').beatIndex === 0, `beat=${selectProof(tieBeats, 'budget cost control review').beatIndex}`);

// ── (B) node-vs-beat mapping (the post-DB body of proofNodeFor; synthetic plan; airtight) ──
// Only a real 'node' proof is navigable; a knowledge 'beat' proof is NOT (nothing to drive to → null → free-roam).
type SynthEntry = { arcRole: 'open' | 'show' | 'transit' | 'close'; kind: 'node' | 'beat'; stepKind: string; sourceText: string | null; caption: string | null; nodeLabel?: string };
const synthPlan: SynthEntry[] = [
  { arcRole: 'open', kind: 'beat', stepKind: 'note', sourceText: null, caption: 'Welcome and framing' },
  { arcRole: 'show', kind: 'node', stepKind: 'workflow', sourceText: null, caption: 'approval delegation routing controls', nodeLabel: 'delegation settings' },
  { arcRole: 'transit', kind: 'node', stepKind: 'workflow', sourceText: null, caption: null, nodeLabel: 'approvals queue' }, // interior node: no branchKey
  { arcRole: 'show', kind: 'beat', stepKind: 'knowledge', sourceText: 'Delegation routes to a backup approver within SLA.', caption: 'security access control policy' },
  { arcRole: 'close', kind: 'beat', stepKind: 'note', sourceText: null, caption: 'The measurable result' },
];
// Faithful replica of the real proofNodeFor body (graph.ts): the leading `if (!concern) return null` is subsumed by
// selectProof's own empty-concern guard; navigableOnly restricts to a real-screen proof; map the beat → nodeLabel.
const proofNodeForPlan = (plan: SynthEntry[], concern: string): string | null => {
  if (!concern) return null;
  const { beatIndex } = selectProof(toFacilitationBeats(plan), concern, { navigableOnly: true });
  return beatIndex == null ? null : (plan[beatIndex].nodeLabel ?? null);
};
ok('B: a concern matching a NODE proof → the node label (navigable)', proofNodeForPlan(synthPlan, 'approval delegation routing please') === 'delegation settings', proofNodeForPlan(synthPlan, 'approval delegation routing please') ?? 'null');
ok('B: a concern matching only a KNOWLEDGE proof → null (not navigable → free-roam fallback)', proofNodeForPlan(synthPlan, 'security access control concern') === null);
ok('B: an off-topic concern → null (never a fabricated screen)', proofNodeForPlan(synthPlan, 'unrelated gibberish topic xyzzy') === null);
// LOW-2 fix: an earlier grounded KNOWLEDGE proof must NOT shadow a later NODE proof for the SAME concern — the
// router exists to SHOW the screen, so navigableOnly skips the knowledge beat and routes to the navigable node.
const shadowPlan: SynthEntry[] = [
  { arcRole: 'open', kind: 'beat', stepKind: 'note', sourceText: null, caption: null },
  { arcRole: 'show', kind: 'beat', stepKind: 'knowledge', sourceText: 'Budget controls are enforced per approval tier.', caption: 'budget cost control tiers' }, // knowledge proof, EARLIER
  { arcRole: 'show', kind: 'node', stepKind: 'workflow', sourceText: null, caption: 'budget cost control settings', nodeLabel: 'budget controls screen' }, // node proof, LATER, same concern
];
ok('B: an earlier KNOWLEDGE proof does NOT shadow a later NODE proof (navigableOnly → the screen wins)', proofNodeForPlan(shadowPlan, 'budget cost control review') === 'budget controls screen', proofNodeForPlan(shadowPlan, 'budget cost control review') ?? 'null');

// ── (C) the REAL proofNodeFor against a freshly-assembled journey (DB; no interpreter/LLM) ──
const prod = (await db().query<{ name: string }>(`SELECT name FROM products WHERE id=$1`, [productId])).rows[0];
const outcome = (await db().query<{ id: string }>(
  `SELECT id FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`, [productId])).rows[0];
if (!outcome) throw new Error('No business outcome for PO.vin — run `npm run seed:outcomes-committee`.');
const res = await assembleJourney({ productId, outcomeId: outcome.id }, 'eval-phase27');
const wp = await journeyWalkPlan(res.journeyId);
const plan = wp?.plan ?? [];
const nodeLabels = new Set(plan.filter((e) => e.kind === 'node' && e.nodeLabel).map((e) => e.nodeLabel as string));
// A grounded NODE beat with a caption (the first node of a workflow step carries step.caption → a real branchKey).
const captionedNode = plan.find((e) => e.kind === 'node' && e.nodeLabel && e.caption);
ok('C: gibberish concern → proofNodeFor returns null (no fabricated screen, real DB)', (await proofNodeFor(res.journeyId, 'capital of france xyzzy unrelated')) === null);
if (captionedNode) {
  const cap = String(captionedNode.caption);
  const label = await proofNodeFor(res.journeyId, cap);
  // A node's own caption overlaps itself by all its significant tokens, so IF the caption has ≥2 significant
  // tokens, proofNodeFor MUST route to a REAL navigable node in THIS plan (navigableOnly means no knowledge beat
  // can shadow it) — a DETERMINISTIC ON-path assertion (the real DB fn the dispatcher calls actually routes, not a
  // no-op), not interpreter-dependent. With <2 significant tokens the overlap gate can't fire → null is correct.
  const sigTokens = new Set(cap.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  if (sigTokens.size >= 2) {
    ok('C: a captioned node concern (≥2 sig tokens) → proofNodeFor ROUTES to a REAL in-plan node (no no-op, no shadow)', !!label && nodeLabels.has(label), `label=${label ?? 'null'} (in-plan=${label ? nodeLabels.has(label) : 'n/a'})`);
  } else {
    ok('C: a captioned node concern (<2 sig tokens — overlap gate can’t fire) → null or in-plan (never fabricated)', label === null || nodeLabels.has(label), `label=${label ?? 'null'} (caption "${cap}" has <2 sig tokens)`);
  }
} else {
  ok('C: (no captioned node beat in this plan — node-mapping covered by (B))', true, 'skipped — assembled plan had no captioned node');
}

// ── (D) LIVE interjection contract (TOLERANT — the interpreter classification is non-deterministic) ──
// On a journey-pinned session, an off-script objection: consumes NO journey step (the walk cursor is untouched),
// is ANSWERED, and any navigation targets a REAL node from the plan (the grounded proof) — never a fabricated
// screen. Holds whether FACILITATOR is on (interjects to the proof) or off (free-roam) — the CONTRACT is the same.
if (plan.length >= 2) {
  const evs: any[] = []; const sink = (ev: any) => evs.push(ev);
  const ctx = await bootSession('eval-27-interject', { productId, journeyId: res.journeyId, clientNav: true, seedRoom: false });
  if (ctx) {
    const r0 = await runTurn(ctx, { speaker: 'Presenter', text: plan[0].caption ?? 'next', advance: true }, sink);
    const off = await runTurn(ctx, { speaker: 'CFO', text: "I'm worried about cost — how do you justify the budget for approval delegation?", advance: false }, sink);
    ok('D: an off-script objection consumes NO journey step (walk cursor untouched)', off.journeyStep === r0.journeyStep, `r0=${r0.journeyStep}, off=${off.journeyStep}`);
    const ans = evs.filter((e) => e.type === 'message' && e.side === 'ai').slice(-1)[0];
    ok('D: the off-script objection was ANSWERED', !!ans && typeof ans.text === 'string' && ans.text.trim().length > 0, ans ? `"${String(ans.text).slice(0, 50)}"` : 'no answer');
    const navs = evs.filter((e) => e.type === 'nav');
    const lastNav = navs.slice(-1)[0];
    // Non-fabrication is structural: driveTo only ever drives a VERIFIED graph node (resolved to ordered locators
    // and/or a screen route) — never an invented screen. A FACILITATOR interjection targets a grounded proof node;
    // a no-grounded-proof concern degrades to free-roam, which may land on any REAL product node (existing, correct
    // off-script behavior — NOT necessarily inside this journey's plan). So we assert the realness guarantee, not
    // plan-membership: any nav carries a non-empty resolved label + verified locators or a route.
    const navOk = !lastNav || (typeof lastNav.label === 'string' && lastNav.label.length > 0 && (((lastNav.selectors?.length ?? 0) > 0) || !!lastNav.url));
    ok('D: any navigation is a RESOLVED verified node (label + locators/route) — never a fabricated screen', navOk, lastNav ? `navigated "${lastNav.label}" · ${lastNav.selectors?.length ?? 0} locator(s)${lastNav.url ? ' + route' : ''}` : 'no navigation (honest degrade)');
    ok('D: FACILITATOR flag state recorded for this run', true, facilitatorEnabled() ? 'FACILITATOR=ON (interjection path)' : 'FACILITATOR=OFF (free-roam baseline)');
  }
}

// ── CLEANUP ──
await db().query(`DELETE FROM gap_records WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journey_runs WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journey_events WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`UPDATE demo_sessions SET journey_id = NULL WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journeys WHERE id = $1`, [res.journeyId]).catch(() => {});

console.log('\n══ P4 live discovery router — off-script proof interjection (phase27) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase27', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name), product: prod?.name, facilitator: facilitatorEnabled() }, productId);
process.exit(failed.length ? 1 : 0);
