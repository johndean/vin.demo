/**
 * The Phase 0 centerpiece: a read-only-guarded, self-healing navigator.
 *
 *  - ReadOnlyGuard: in read-only mode, refuses to click anything that looks
 *    like a mutating control (Submit / Approve / Reject / Delete / Pay / Save…).
 *    This is the software embodiment of "never fire a mutating action".
 *  - SelfHealNavigator: tries a primary selector; when it breaks (the thing
 *    the spike must prove), it recovers through ordered fallback strategies
 *    and records the heal.
 */
import type { Locator, Page } from 'playwright';

export type ExecutionMode = 'read-only' | 'safe' | 'approval' | 'execution';

// Verbs that denote a state-changing action. Note "bypass(ed)" is deliberately
// absent: it's a navigation label (the Bypassed queue), not an action to block.
const MUTATING = /\b(submit|approve|reject|deny|delete|remove|pay|save|create|send|post|confirm|issue|cancel|void|archive|delegate|hold)\b/i;

export interface HealEvent {
  goal: string;
  primaryCss: string;
  healedVia: string | null; // null = primary worked
}

export class ReadOnlyGuard {
  readonly mode: ExecutionMode;
  readonly blocked: Array<{ goal: string; label: string }> = [];
  constructor(mode: ExecutionMode = 'read-only') {
    this.mode = mode;
  }

  /** Returns true if the candidate is safe to click in the current mode. */
  async permit(loc: Locator, goal: string): Promise<boolean> {
    if (this.mode !== 'read-only') return true; // safe/approval/execution handled elsewhere
    const label = ((await loc.textContent().catch(() => '')) || (await loc.getAttribute('aria-label').catch(() => '')) || '').trim();
    const type = (await loc.getAttribute('type').catch(() => '')) || '';
    const isMutating = MUTATING.test(label) || type === 'submit';
    if (isMutating) {
      this.blocked.push({ goal, label: label || `[type=${type}]` });
      return false;
    }
    return true;
  }
}

export interface NavStep {
  goal: string;
  /** A primary CSS selector — may be brittle or deliberately broken. */
  primaryCss: string;
  /** Ordered recovery strategies, tried in order when the primary fails. */
  fallbacks: Array<{ how: string; locate: (p: Page) => Locator }>;
}

export class SelfHealNavigator {
  readonly heals: HealEvent[] = [];
  constructor(private page: Page, private guard: ReadOnlyGuard) {}

  private async firstUsable(loc: Locator): Promise<Locator | null> {
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 5); i++) {
      const c = loc.nth(i);
      if (await c.isVisible().catch(() => false)) return c;
    }
    return null;
  }

  /** Navigate by clicking the target named in `step`, healing if the primary breaks. */
  async go(step: NavStep): Promise<boolean> {
    // 1) Try the primary selector.
    let target: Locator | null = null;
    let via: string | null = null;
    try {
      const prim = this.page.locator(step.primaryCss);
      if (await prim.count({ timeout: 2500 } as any).catch(() => 0)) {
        target = await this.firstUsable(prim);
      }
    } catch { /* primary broke */ }

    // 2) Heal through fallbacks.
    if (!target) {
      for (const fb of step.fallbacks) {
        const cand = await this.firstUsable(fb.locate(this.page));
        if (cand) { target = cand; via = fb.how; break; }
      }
    }

    this.heals.push({ goal: step.goal, primaryCss: step.primaryCss, healedVia: via });

    if (!target) {
      console.log(`  ✗ ${step.goal}: primary AND all fallbacks failed.`);
      return false;
    }
    if (via) console.log(`  ↻ HEAL ${step.goal}: primary "${step.primaryCss}" broke → recovered via ${via}`);
    else console.log(`  ✓ ${step.goal}: primary selector worked`);

    if (!(await this.guard.permit(target, step.goal))) {
      console.log(`  ⛔ BLOCKED (read-only): refused to click a mutating control for "${step.goal}"`);
      return false;
    }
    await target.click().catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await this.page.waitForTimeout(800);
    return true;
  }
}
