/**
 * Prompt byte-identity harness (AI-4/5 safety net).
 *
 * The AI Prompts editor moves the 12 tuned system prompts out of inline string literals in llm.ts and into
 * an override-aware registry (prompts.ts). The ONE rule that cannot break: with NO override set, every
 * assembled system prompt must be byte-for-byte what it was before the refactor — otherwise we'd silently
 * detune the demo. This harness is the independent oracle that proves it.
 *
 * HOW: it monkeypatches the provider's Anthropic client so `messages.create` records `args.system` and throws
 * a sentinel (no network, no DB) — capturing the EXACT system string each function assembles, across a matrix
 * that exercises every dynamic branch (persona on/off, execution vs read-only, all four confidence bands,
 * grounded/ungrounded, cite/no-cite, recency hedge, nav hint). Two modes:
 *   capture → run against the CURRENT (pre-refactor) llm.ts and write src/core/eval-prompts.golden.json
 *   verify  → run against the refactored llm.ts and assert each captured system === the golden
 * It also proves an override actually changes the output (so the editor isn't a no-op).
 *
 *   npx tsx src/core/eval-prompts.ts capture   # do this BEFORE editing llm.ts
 *   npx tsx src/core/eval-prompts.ts           # verify (default) AFTER the refactor
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GOLDEN = fileURLToPath(new URL('./eval-prompts.golden.json', import.meta.url));

// We never hit the network: a dummy key lets getLlm() construct the client; the stub below throws before any
// request leaves the process. Set before getLlm() is called (it reads the key at call time).
process.env.ANTHROPIC_API_KEY ||= 'sk-ant-prompt-harness';

interface Case { label: string; run: (p: any) => Promise<any>; }

// Representative contexts. Values are arbitrary — only the STATIC guidance (not the interpolated ctx) is what
// the registry owns; the matrix exists to exercise each branch that selects WHICH static spans get assembled.
const PERSONA = 'You are Dr. Demo, the Procurement specialist.\nScope: purchasing workflows.\nHard limits: never quote pricing.';
const SOURCE = { content: 'Approvals route to the delegate when the owner is out of office.', source: 'Product Docs · Approvals', version: 'v2.1', confidence: 0.9, owner: 'PM Team', validatedBy: 'QA', validatedAt: '2026-01-15', sourceType: 'doc', recencyDays: 200 };
const SOURCE_FRESH = { ...SOURCE, recencyDays: 10, version: null, owner: null, validatedBy: null, validatedAt: null };

function cases(): Case[] {
  return [
    { label: 'interpret', run: (p) => p.interpret('how does delegation work?') },
    { label: 'pickNode', run: (p) => p.pickNode('delegation', ['Approvals', 'Bypassed list']) },

    { label: 'explainWhy.noPersona', run: (p) => p.explainWhy({ question: 'why that screen?', priorIntent: 'delegation', answer: 'a', navUrl: '/x', trace: ['t1', 't2'] }) },
    { label: 'explainWhy.persona', run: (p) => p.explainWhy({ question: 'why?', priorIntent: 'd', answer: 'a', navUrl: '/x', trace: ['t1'], personaPreamble: PERSONA }) },

    { label: 'agentStep.readonly.noPersona', run: (p) => p.agentStep({ goal: 'create a PO', url: '/po', title: 'PO', headings: ['New PO'], elements: [{ ref: 1, text: 'Submit', kind: 'button' }], history: [], role: 'admin', mode: 'read-only' }) },
    { label: 'agentStep.execution.noPersona', run: (p) => p.agentStep({ goal: 'create a PO', url: '/po', title: 'PO', headings: ['New PO'], elements: [{ ref: 1, text: 'Submit', kind: 'button' }], history: [], role: 'admin', mode: 'execution' }) },
    { label: 'agentStep.readonly.persona', run: (p) => p.agentStep({ goal: 'create a PO', url: '/po', title: 'PO', headings: ['New PO'], elements: [{ ref: 1, text: 'Submit', kind: 'button' }], history: [], role: 'admin', mode: 'read-only', personaPreamble: PERSONA }) },
    // 4th cell of the persona×mode 2×2 (review nit): execution + persona together.
    { label: 'agentStep.execution.persona', run: (p) => p.agentStep({ goal: 'create a PO', url: '/po', title: 'PO', headings: ['New PO'], elements: [{ ref: 1, text: 'Submit', kind: 'button' }], history: [], role: 'admin', mode: 'execution', personaPreamble: PERSONA }) },

    { label: 'answerAs.high.grounded.cite.screen.recency', run: (p) => p.answerAs({ personaPreamble: PERSONA, question: 'does it delegate?', intent: 'delegation', band: 'high', source: SOURCE, screen: 'Approvals', audience: 'CFO', priorContext: 'pricing earlier', cite: true }) },
    { label: 'answerAs.high.grounded.nocite.noscreen.fresh', run: (p) => p.answerAs({ personaPreamble: PERSONA, question: 'does it delegate?', intent: 'delegation', band: 'high', source: SOURCE_FRESH, cite: false }) },
    { label: 'answerAs.medium.grounded', run: (p) => p.answerAs({ personaPreamble: PERSONA, question: 'q', intent: 'i', band: 'medium', source: SOURCE_FRESH, cite: false }) },
    { label: 'answerAs.low.grounded', run: (p) => p.answerAs({ personaPreamble: PERSONA, question: 'q', intent: 'i', band: 'low', source: SOURCE_FRESH, cite: false }) },
    { label: 'answerAs.verylow.ungrounded', run: (p) => p.answerAs({ personaPreamble: PERSONA, question: 'q', intent: 'i', band: 'very_low', source: null, cite: false }) },
    // cite=ON decoupled from band=high + recency + navHint (review nit): cite at band=medium, fresh source, no screen.
    { label: 'answerAs.medium.grounded.cite.fresh', run: (p) => p.answerAs({ personaPreamble: PERSONA, question: 'q', intent: 'i', band: 'medium', source: SOURCE_FRESH, cite: true }) },
    // navHint present WITHOUT recencyHint (review nit): screen set, fresh source, cite OFF.
    { label: 'answerAs.high.grounded.nocite.screen.fresh', run: (p) => p.answerAs({ personaPreamble: PERSONA, question: 'q', intent: 'i', band: 'high', source: SOURCE_FRESH, screen: 'Approvals', cite: false }) },

    { label: 'narrate.persona', run: (p) => p.narrate({ personaPreamble: PERSONA, stepKind: 'workflow', caption: 'Submit the PO', screen: 'PO form', audience: 'CFO', outcome: 'faster approvals' }) },
    // empty-persona narrate seam (review nit): leading '\n\n— — —\n' wrapper with no specialist.
    { label: 'narrate.noPersona', run: (p) => p.narrate({ personaPreamble: '', stepKind: 'workflow', caption: 'Submit the PO', screen: 'PO form', audience: 'CFO', outcome: 'faster approvals' }) },

    { label: 'discover.noPersona', run: (p) => p.discover({ utterance: 'this is slow today', kind: 'objection', answer: 'the approvals screen' }) },
    { label: 'discover.persona', run: (p) => p.discover({ utterance: 'this is slow', kind: 'objection', answer: 'the approvals screen', personaPreamble: PERSONA }) },

    { label: 'harvestChunks', run: (p) => p.harvestChunks({ product: 'po.vin', screen: 'Approvals', capturedText: 'Approvals route to a delegate when the owner is out of office. Managers can bypass with a reason.' }) },
    { label: 'verifyFaithful', run: (p) => p.verifyFaithful({ statement: 'Approvals can be delegated.', source: 'Approvals route to a delegate when the owner is out of office.' }) },
    { label: 'deriveScreens', run: (p) => p.deriveScreens({ product: 'po.vin', knowledge: 'The product has an upload page, a review queue, and a settings panel where admins configure routing.' }) },
    { label: 'deriveWorkflows', run: (p) => p.deriveWorkflows({ product: 'po.vin', knowledge: 'Users upload, the system processes, then publishes.', screens: ['upload', 'review queue', 'settings'] }) },
    { label: 'deriveScreenElements', run: (p) => p.deriveScreenElements({ product: 'po.vin', screenName: 'Approvals', screenType: 'list', evidence: 'The approvals list shows pending items with an Approve button and a Delegate action.', knowledge: 'Approvals route to a delegate when the owner is out of office.' }) },
  ];
}

async function captureAll(): Promise<Record<string, string>> {
  const { getLlm } = await import('./llm.js');
  const provider: any = getLlm();
  let cap: string | undefined;
  // Overwrite the (already log-wrapped) create with a capturing stub: record system, then throw a sentinel so
  // no request is made and no DB write happens. answerAs/explainWhy rethrow it (we catch in grab); narrate
  // swallows it in its own try/catch and returns a fallback — either way `cap` is already set.
  provider.client.messages.create = async (args: any) => {
    cap = typeof args?.system === 'string' ? args.system : JSON.stringify(args?.system ?? '');
    const e: any = new Error('__CAP__'); e.__cap = true; throw e;
  };
  const grab = async (run: () => Promise<any>): Promise<string> => {
    cap = undefined;
    try { await run(); } catch (e: any) { if (!e?.__cap) throw e; }
    return cap ?? '<<NO SYSTEM CAPTURED>>';
  };
  const out: Record<string, string> = {};
  for (const c of cases()) out[c.label] = await grab(() => c.run(provider));
  return out;
}

async function main() {
  const mode = process.argv[2] === 'capture' ? 'capture' : 'verify';
  const captured = await captureAll();

  if (mode === 'capture') {
    writeFileSync(GOLDEN, JSON.stringify(captured, null, 2) + '\n', 'utf8');
    console.log(`[eval:prompts] CAPTURE — wrote ${Object.keys(captured).length} golden system prompts to ${GOLDEN}`);
    for (const k of Object.keys(captured)) console.log(`  · ${k} (${captured[k].length} chars)`);
    return;
  }

  if (!existsSync(GOLDEN)) { console.error(`[eval:prompts] FAIL — no golden file at ${GOLDEN}. Run \`tsx src/core/eval-prompts.ts capture\` against the pre-refactor llm.ts first.`); process.exit(1); }
  const golden: Record<string, string> = JSON.parse(readFileSync(GOLDEN, 'utf8'));

  let pass = 0; const fails: string[] = [];
  const keys = new Set([...Object.keys(golden), ...Object.keys(captured)]);
  for (const k of keys) {
    const g = golden[k]; const c = captured[k];
    if (g === undefined) { fails.push(`${k}: present now but NOT in golden (new case — recapture if intentional)`); continue; }
    if (c === undefined) { fails.push(`${k}: in golden but NOT produced now (missing case)`); continue; }
    if (g === c) { pass++; continue; }
    // First divergence, for a readable diff.
    let i = 0; while (i < g.length && i < c.length && g[i] === c[i]) i++;
    fails.push(`${k}: DIFFERS at char ${i}\n    golden: …${JSON.stringify(g.slice(Math.max(0, i - 30), i + 40))}\n    now:    …${JSON.stringify(c.slice(Math.max(0, i - 30), i + 40))}`);
  }

  // Prove an override actually changes output (editor is not a no-op) — set one in-memory and re-capture interpret.
  let overrideProof = 'skipped';
  try {
    const prompts: any = await import('./prompts.js');
    if (typeof prompts.setOverrides === 'function') {
      prompts.setOverrides([{ prompt_key: 'interpret', text: 'OVERRIDDEN INTERPRET PROMPT — test.' }]);
      const after = await captureAll();
      prompts.setOverrides([]); // restore defaults
      overrideProof = after['interpret']?.includes('OVERRIDDEN INTERPRET PROMPT') ? 'ok' : 'FAILED (override did not reach the assembled prompt)';
      if (overrideProof.startsWith('FAILED')) fails.push(`override-applies: ${overrideProof}`);
    }
  } catch { /* prompts.js not present yet (pre-refactor verify) — skip the override proof */ }

  console.log(`[eval:prompts] VERIFY — ${pass}/${keys.size} system prompts byte-identical to golden · override-applies: ${overrideProof}`);
  if (fails.length) { console.error(`\n[eval:prompts] ${fails.length} FAILURE(S):\n` + fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
  console.log('[eval:prompts] PASS — every default system prompt is byte-for-byte unchanged.');
}

main().catch((e) => { console.error('[eval:prompts] harness error:', e); process.exit(1); });
