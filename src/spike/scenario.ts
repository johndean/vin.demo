/**
 * Phase 0 scenario: "How does approval delegation work?" against PO.vin,
 * in read-only mode. Proves the core loop end-to-end:
 *   intent → cited answer (trust metadata + confidence gate) → navigate real UI
 *   → demonstrate (screenshot) → self-heal a broken selector → never mutate.
 *
 * Intent parsing and explanation go through Claude (claude-opus-4-8) when
 * ANTHROPIC_API_KEY is set, and fall back to deterministic behaviour otherwise.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openSession } from './session.js';
import { ReadOnlyGuard, SelfHealNavigator, type NavStep } from './navigator.js';
import { parseIntent, narrate, hasLLM } from './llm.js';

const OUT = path.resolve('tmp/demo');
const CONFIDENCE_THRESHOLD = 0.6;

/** Knowledge chunk with the mandatory trust metadata (Gap C). */
interface Knowledge {
  answer: string;
  confidence: number;
  source: string;
  last_verified: string;
  product_version: string;
  validation_status: 'validated' | 'unverified' | 'stale';
}

// A tiny stand-in knowledge base (pgvector retrieval is deferred to P1).
const KB: Record<string, Knowledge> = {
  'approval delegation': {
    answer:
      'In Purchase Hub, a purchase request routes through Manager → Owner approval stages. ' +
      'Delegation lets an approver hand their authority to another user (or auto-route) so a request ' +
      'is not blocked when they are unavailable; delegated/auto-routed approvals appear under "Bypassed". ' +
      'Routing rules are configured in Workflow Settings.',
    confidence: 0.82,
    source: 'po.vin docs · purchase-order-workflow.ts',
    last_verified: '2026-06-05',
    product_version: 'v2 · Flowint SSOT',
    validation_status: 'validated',
  },
};

async function run() {
  await mkdir(OUT, { recursive: true });
  const question = 'How does approval delegation work?';
  console.log(`\nStakeholder: "${question}"`);
  console.log(`  (intent + explanation via ${hasLLM ? 'Claude claude-opus-4-8' : 'deterministic fallback — no API key'})\n`);

  // 1) Parse intent → retrieve the cited answer, with confidence gating.
  const { topic, reasoning } = await parseIntent(question, Object.keys(KB));
  const k = topic ? KB[topic] : null;
  if (!k || k.confidence < CONFIDENCE_THRESHOLD || k.validation_status === 'stale') {
    console.log(`VIN Demo: I'm not certain about that — let me show you the source rather than guess. (${reasoning})`);
    return;
  }
  const spoken = await narrate(question, k, 'procurement stakeholder');
  console.log('VIN Demo: ' + spoken + '\n');
  console.log('VIN Demo: Let me walk you through it in the product…\n');

  // 2) Drive the real UI, read-only, as an approver persona who can delegate.
  //    Manager has pending items (Review Queue 3); Owner's queue is empty right now.
  const role = process.env.PO_VIN_ROLE ?? 'admin';
  const { browser, page } = await openSession({ headless: true, role });
  const guard = new ReadOnlyGuard('read-only');
  const nav = new SelfHealNavigator(page, guard);
  let shot = 0;
  const snap = (label: string) => page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-${label}.png`), fullPage: true }).catch(() => {});

  // PO.vin nav items are <button class="sidebar__item"> with an icon span + a
  // label span (+ a badge), so their accessible name is unreliable. has-text /
  // text matching works; these are the recovery strategies the navigator heals to.
  const byName = (name: string) => [
    { how: `button:has-text("${name}")`, locate: (p: typeof page) => p.locator(`button:has-text("${name}")`) },
    { how: `.sidebar__item:has-text("${name}")`, locate: (p: typeof page) => p.locator(`.sidebar__item:has-text("${name}")`) },
    { how: `text "${name}"`, locate: (p: typeof page) => p.getByText(name, { exact: false }) },
  ];

  // Nav steps. primaryCss values are intentionally STALE (as if a UI redesign
  // moved them) to exercise self-heal — the Phase 0 centerpiece.
  // The approvals queue is labelled per-persona (Manager→"Review Queue",
  // Owner→"Approval Queue"), so the recovery strategies span all of them — the
  // navigator heals to whichever this persona actually shows.
  const queueLabels = ['Review Queue', 'Approval Queue', 'Manager Queue', 'Owner Queue'];
  await nav.go({
    goal: 'the approvals queue',
    primaryCss: '#sidebar-approval-queue-v1',
    fallbacks: queueLabels.flatMap(byName),
  });
  await snap('approvals-queue');

  // Open the pending PO (read-only navigation into a detail view). Rows are
  // <tbody tr>, not anchors — clicking one routes to /po/:id.
  console.log('  → opening the pending purchase order…');
  // The queue list loads via a slower hub-api call (shows "Loading…" first).
  // Wait for an actual PO row to render, not just the table shell.
  const row = page.locator('tbody tr').filter({ hasText: /PO-|REQ-|\$/ }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  let opened = false;
  if (await row.count()) {
    await row.click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    opened = page.url().includes('/po/');
  }
  if (opened) console.log(`  ✓ on PO detail: ${page.url()}`);
  else console.log('  ! could not open a PO detail');

  // 3) Demonstrate delegation + prove the read-only guard blocks EVERY action.
  console.log('\nStakeholder: "Show me how delegation works — go ahead and approve or delegate this one."');
  // The detail loads PO data via hub-api before rendering its action panel —
  // wait for an action control to appear before scanning.
  await page.locator('button:has-text("Delegate"), button:has-text("Approve")').first()
    .waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (opened) await snap('po-detail');
  const buttons = page.locator('button');
  const texts = (await buttons.allInnerTexts().catch(() => [] as string[]));
  // Help-panel questions ("How do I use Approve with Conditions?") contain action
  // words but aren't actions — exclude anything phrased as a question.
  const isHelp = (t: string) => /\?$/.test(t.trim()) || /^(how|why|what|where|when|can i)\b/i.test(t.trim());
  if (texts.some((t) => /^delegate/i.test(t.trim()))) {
    console.log('  VIN Demo: This is the delegation control — it hands your approval authority to');
    console.log('            another user so the PO is not blocked when you are away.');
  }
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i].trim();
    if (t && !isHelp(t)) await guard.permit(buttons.nth(i), 'act on the pending PO');
  }
  console.log("  ⛔ VIN Demo: I can show you each of these, but I won't actually click them — this is a read-only demo, so nothing is submitted.");

  // Show the result of delegation: the Bypassed queue (delegated / auto-routed
  // approvals). This view is Owner/Admin-only, so attempt it only if present.
  if (await page.locator('button:has-text("Bypassed")').count()) {
    await nav.go({ goal: 'Bypassed (delegated approvals)', primaryCss: '.legacy-bypassed-link', fallbacks: byName('Bypassed') });
    await snap('bypassed');
  } else {
    console.log('  (Bypassed view is Owner/Admin-only — not shown for this persona)');
  }

  // 4) Summary — the Phase 0 evidence.
  console.log('\n── Phase 0 evidence ─────────────────────────────');
  const healed = nav.heals.filter((h) => h.healedVia);
  console.log(`  Self-heals: ${healed.length}/${nav.heals.length} navigation steps recovered after the primary selector broke`);
  for (const h of healed) console.log(`    ↻ ${h.goal}: "${h.primaryCss}" → ${h.healedVia}`);
  console.log(`  Mutating actions blocked by read-only guard: ${guard.blocked.length}`);
  for (const b of guard.blocked) console.log(`    ⛔ "${b.label}" (during: ${b.goal})`);
  console.log(`  Screenshots: tmp/demo/`);
  console.log('─────────────────────────────────────────────────\n');

  await browser.close();
}

run().catch((e) => {
  console.error('Scenario failed:', e?.message ?? e);
  process.exit(1);
});
