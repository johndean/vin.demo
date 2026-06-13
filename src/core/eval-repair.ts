/**
 * Runtime P1 — LIVE brain verification (REAL Anthropic API + DB, like phase1/phase24). Proves the speech driver's
 * BRAIN layer here (no audio/mic/staging needed):
 *   (1) repairStreaming() composes a real, short, natural continuation for a cut-off spoken line.
 *   (2) onComplete fires with a CompletionStatus — on the BLOCKING path (Complete) AND when a stream FAILS (the
 *       narrate catch reports Failed so the driver can repair instead of going silent).
 * NOTE on this environment: the Anthropic SDK `.stream()` transport crashes on local Node 26 (an uncatchable
 * socket error — NOT a prod bug; the deployed engine pins an older Node). So the live SENTENCE-STREAMING transport
 * can't run here; we verify the brain via the blocking path + the stream-failure catch (which Node 26 conveniently
 * triggers). Run: npm run eval:repair
 */
import { getLlm } from './llm.js';
import { CompletionStatus } from './speech-driver.js';
import { beginCostSession } from './cost.js';
import { createDemoSession } from './session.js';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (productId) { const s = await createDemoSession(productId, 'read-only'); beginCostSession(s.id); }

const llm = getLlm();
const checks: { name: string; pass: boolean; detail: string }[] = [];
const ok = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

// (1) repairStreaming (blocking .create() → runs everywhere): a cut-off narration is continued in ONE short, clean line.
const cont = await llm.repairStreaming('So once the PO is submitted, it routes to the manager for approval, and then', 'narration');
ok('repairStreaming returns a non-empty continuation', cont.trim().length > 0, `"${cont.slice(0, 70)}"`);
ok('repairStreaming continuation is short (a single spoken sentence)', cont.length > 0 && cont.length < 260, `${cont.length} chars`);
ok('repairStreaming is clean — no markdown/labels', !/[*_`#]/.test(cont) && !/^\s*(note|continue)\s*:/i.test(cont), cont.slice(0, 50));

// (2a) onComplete fires Complete on a BLOCKING answerAs (no onDelta → .create() path, runs everywhere).
let aStatus: CompletionStatus | null = null;
const ans = await llm.answerAs({ personaPreamble: '', question: 'How does approval delegation work?', intent: 'capability', band: 'high', onComplete: (st) => { aStatus = st; } });
ok('answerAs(blocking) fired onComplete', aStatus !== null, String(aStatus));
ok('a normal answer completes (status=complete)', aStatus === CompletionStatus.Complete, String(aStatus));
ok('answerAs(blocking) returned a non-empty line', ans.trim().length > 0, `"${ans.slice(0, 50)}"`);

// (2b) onComplete ALWAYS fires for a narrate beat — even when the stream FAILS, the catch reports Failed (the gap the
// live eval caught). Env-agnostic: prod Node → stream succeeds → Complete + generated text; local Node 26 → stream
// crashes → catch → Failed + clean fallback. Either way: onComplete fired AND a non-empty line was returned.
let nStatus: CompletionStatus | null = null;
const nText = await llm.narrate({ personaPreamble: '', stepKind: 'note', caption: 'Frame the demo for the buyer in one warm sentence', onDelta: () => {}, onComplete: (st) => { nStatus = st; } });
ok('narrate fired onComplete (even on a failed stream — no silent swallow)', nStatus !== null, String(nStatus));
ok('narrate returned a non-empty line (generated OR clean fallback)', nText.trim().length > 0, `"${nText.slice(0, 50)}"`);

console.log('\n══ Runtime P1 — live brain verification (real LLM; repair + onComplete) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
process.exit(failed.length ? 1 : 0);
