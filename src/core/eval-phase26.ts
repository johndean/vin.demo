/**
 * Phase 26 eval — the FACILITATOR state machine (P3). DETERMINISTIC: no DB/key/audio. Drives the pure transition
 * function over a synthetic assembler plan and asserts the executable arc + the ZERO-GAP guarantee:
 *   - OPEN→DISCOVER→SHOW→…→CLOSE phase ordering;
 *   - an objection interjects, surfaces a GROUNDED beat that answers it, and the walk RESUMES where it left off;
 *   - an objection with NO grounded answer → mustGround (answer trust-gated/declined, NEVER an invented beat);
 *   - an ungrounded beat is NEVER surfaced to answer a concern (even when its words match);
 *   - a buyer signal is captured without advancing; re-ranking prefers the grounded proof the buyer cares about.
 * Run: npm run eval:phase26
 */
import { initialFacilitatorState, transition, toFacilitationBeats, advanceWalk, noteConcern, type FacilitationBeat } from './facilitator.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
const ok = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

// A synthetic plan modeling a real arc. Beat 4 is UNGROUNDED on purpose (must never be surfaced for an objection).
const beats: FacilitationBeat[] = [
  { index: 0, phase: 'open', branchKey: null, grounded: true },
  { index: 1, phase: 'discover', branchKey: null, grounded: true },
  { index: 2, phase: 'show', branchKey: 'approval routing speed', grounded: true },
  { index: 3, phase: 'proof', branchKey: 'cfo cost control budget', grounded: true },
  { index: 4, phase: 'proof', branchKey: 'security access control', grounded: false },
  { index: 5, phase: 'close', branchKey: null, grounded: true },
];

// ── phase ordering open → discover → show ──
let s = initialFacilitatorState();
ok('initial phase is open at step 0', s.phase === 'open' && s.stepIndex === 0);
let r = transition(s, beats, { kind: 'advance' }); s = r.state;
ok('advance → discover (beat 1)', s.phase === 'discover' && r.beatIndex === 1);
r = transition(s, beats, { kind: 'advance' }); s = r.state;
ok('advance → show (beat 2)', s.phase === 'show' && r.beatIndex === 2);

// ── objection with a GROUNDED answer → interject, surface it, hold the resume position ──
r = transition(s, beats, { kind: 'objection', concern: 'How does this control budget and cost for the CFO?' });
ok('objection → phase objection', r.state.phase === 'objection');
ok('objection surfaces the GROUNDED beat that answers it (beat 3)', r.beatIndex === 3 && r.mustGround === false, `beat=${r.beatIndex}`);
ok('objection holds the resume position (step 2)', r.state.resumeIndex === 2, `resume=${r.state.resumeIndex}`);
ok('objection does NOT consume the forward walk position', r.state.stepIndex === 3 && r.state.resumeIndex === 2); // stepIndex moves to the proof; resume restores
// resume → back to show (beat 2)
const back = transition(r.state, beats, { kind: 'resume' });
ok('resume returns to the held position/phase (beat 2, show)', back.beatIndex === 2 && back.state.phase === 'show' && back.state.resumeIndex === null);

// ── ZERO-GAP: an objection whose only matching beat is UNGROUNDED → mustGround, NO beat surfaced ──
const sec = transition(back.state, beats, { kind: 'objection', concern: 'What about data security and access controls?' });
ok('objection with no GROUNDED answer → mustGround=true (answer trust-gated/declined)', sec.mustGround === true, `mustGround=${sec.mustGround}`);
ok('the UNGROUNDED matching beat (4) is NEVER surfaced', sec.beatIndex === null, `beat=${sec.beatIndex}`);

// ── signal captured without advancing ──
const sig = transition(back.state, beats, { kind: 'signal', signal: 'we close the books monthly' });
ok('signal is captured into buyerSignals', sig.state.buyerSignals.includes('we close the books monthly'));
ok('signal does NOT change phase or position', sig.state.phase === back.state.phase && sig.state.stepIndex === back.state.stepIndex);

// ── re-rank: with an open concern, advance prefers the grounded proof that answers it over the sequential next ──
const biased = { ...initialFacilitatorState(), phase: 'show' as const, stepIndex: 1, openConcerns: ['cfo cost control budget priorities'] };
const rr = transition(biased, beats, { kind: 'advance' });
ok('re-rank: advance prefers the grounded proof (beat 3) the buyer cares about over the sequential beat 2', rr.beatIndex === 3, `beat=${rr.beatIndex}`);
ok('re-rank stays within the grounded plan set (never out of range / never ungrounded)', rr.beatIndex !== null && beats[rr.beatIndex!]?.grounded === true);

// ── close at the end ──
let e = { ...initialFacilitatorState(), stepIndex: 5, phase: 'close' as const };
const end = transition(e, beats, { kind: 'advance' });
ok('advance past the last beat → close + done', end.state.phase === 'close' && end.state.done === true && end.beatIndex === null);

// ── toFacilitationBeats: adapt the existing walk plan → facilitator input (arc→phase, grounded, branchKey) ──
const fb = toFacilitationBeats([
  { arcRole: 'open', kind: 'beat', stepKind: 'note', sourceText: null, caption: 'The gap behind faster approvals' },
  { arcRole: 'show', kind: 'node', stepKind: 'workflow', sourceText: null, caption: 'Approvals queue' },
  { arcRole: 'transit', kind: 'node', stepKind: 'workflow', sourceText: null, caption: null },
  { arcRole: 'show', kind: 'beat', stepKind: 'knowledge', sourceText: 'Delegation routes to a backup approver within SLA.', caption: 'answers the CFO control concern' },
  { arcRole: 'show', kind: 'beat', stepKind: 'note', sourceText: null, caption: 'an unsourced aside' },
  { arcRole: 'close', kind: 'beat', stepKind: 'note', sourceText: null, caption: 'The measurable result' },
]);
ok('adapt: open beat → open phase', fb[0].phase === 'open');
ok('adapt: a verified SCREEN node → show + grounded', fb[1].phase === 'show' && fb[1].grounded === true);
ok('adapt: a knowledge beat WITH sourceText → proof + grounded', fb[3].phase === 'proof' && fb[3].grounded === true);
ok('adapt: an unsourced note → show + NOT grounded (cannot answer an objection)', fb[4].phase === 'show' && fb[4].grounded === false);
ok('adapt: close beat → close phase', fb[5].phase === 'close');
ok('adapt: branchKey carries the caption keywords (for overlap re-rank)', fb[3].branchKey === 'answers the CFO control concern' && fb[2].branchKey === null);

// ── P3 WIRE helpers (graph.ts ↔ facilitator): advanceWalk bridges the graph's journeyStep (NEXT beat to surface)
// onto a facilitator ADVANCE; noteConcern records an off-script concern. These are the EXACT functions graph.ts calls
// behind the FACILITATOR flag — the off-by-one seam, tested with no I/O. KEY P3 SCOPE: advanceWalk drives the walk
// SEQUENTIALLY (it CAPTURES concerns/signals as persistent context but does NOT re-order the forward cursor — the
// re-rank is P4, which needs a visited/resume cursor so a late proof can't collapse the linear walk). ──
const a0 = advanceWalk(null, beats, 0);
ok('wire: advanceWalk(null, …, journeyStep=0) surfaces beat 0 (no off-by-one skip of the open beat)', a0.beatIndex === 0, `beat=${a0.beatIndex}`);
const a1 = advanceWalk(a0.state, beats, 1);
ok('wire: advanceWalk(…, journeyStep=1) surfaces beat 1 (sequential — == today’s index walk)', a1.beatIndex === 1, `beat=${a1.beatIndex}`);
// advanceWalk returns exactly journeyStep for EVERY step → FACILITATOR-on is byte-identical to the index walk.
ok('wire: advanceWalk == the index walk for every step', [0,1,2,3,4,5].every((js) => advanceWalk(initialFacilitatorState(), beats, js).beatIndex === js), 'all steps sequential');
// CRITICAL P3 GUARANTEE: even WITH an open concern, advanceWalk stays SEQUENTIAL (beat 2, not the proof at 3) — it
// does NOT jump the cursor (that's the walk-collapse failure mode P4 avoids), but it CARRIES the concern forward.
const withConcern = advanceWalk({ ...initialFacilitatorState(), openConcerns: ['cfo cost control budget priorities'] }, beats, 2);
ok('wire: with an open concern, advanceWalk stays SEQUENTIAL (beat 2 — no cursor jump; re-rank is P4)', withConcern.beatIndex === 2, `beat=${withConcern.beatIndex}`);
ok('wire: advanceWalk CARRIES the recorded concern forward on the persisted state (captured for P4)', withConcern.state.openConcerns.includes('cfo cost control budget priorities'));
ok('wire: advanceWalk past the last beat (journeyStep=total) → complete (beatIndex null)', advanceWalk(initialFacilitatorState(), beats, beats.length).beatIndex === null);
// done-hygiene: a successful advance resets done:false, so a rewound walk (journeyStep→0 with the same channel) is consistent.
ok('wire: advanceWalk resets done:false on a successful advance (rewind-safe)', advanceWalk({ ...initialFacilitatorState(), done: true }, beats, 0).state.done === false);
// noteConcern: append (dedup, no-op on empty/duplicate — returns the SAME ref so the graph can cheaply detect a no-op).
const nc1 = noteConcern(null, 'cfo budget cost control');
ok('wire: noteConcern(null, concern) records the concern (captured; advanceWalk then carries it, still sequential)', nc1.openConcerns.includes('cfo budget cost control') && advanceWalk(nc1, beats, 2).beatIndex === 2 && advanceWalk(nc1, beats, 2).state.openConcerns.includes('cfo budget cost control'), `concerns=${JSON.stringify(nc1.openConcerns)}`);
ok('wire: noteConcern is a NO-OP on a duplicate concern (same ref returned)', noteConcern(nc1, 'cfo budget cost control') === nc1);
ok('wire: noteConcern is a NO-OP on empty text (same ref returned)', noteConcern(nc1, '   ') === nc1);

console.log('\n══ Phase 26 — facilitator state machine (P3; deterministic) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
process.exit(failed.length ? 1 : 0);
