/**
 * PO.vin interaction adapter (Playwright/web only — plan §4). The production
 * version of the Phase 0 spike's session + navigator: robust per-persona login,
 * DemoGraph-driven self-healing navigation, and classifier-enforced clicks so a
 * read-only session can never fire a mutating action.
 */
import { chromium, type Browser, type Page, type Locator } from 'playwright';
import { config as loadEnv } from 'dotenv';
import { classifyAction, permits, type ExecutionMode, type ActionClass } from './safety.js';

loadEnv();

const URL = process.env.PO_VIN_URL ?? 'https://po.vin';

export interface LocatorStrategy {
  how: string;   // human label, e.g. 'css' | 'text'
  value: string; // may contain {label}, resolved from persona label
}
export interface DemoNode {
  intent_label: string;
  screen_route: string | null;
  locator_strategies: LocatorStrategy[];
  persona_labels: Record<string, string>;
}

export interface NavResult {
  ok: boolean;
  healedVia: string | null; // null = first strategy worked
  url: string;
}
export interface ActionScan {
  label: string;
  cls: ActionClass;
  permitted: boolean;
  reason: string;
}

function creds(role: string): { user: string; pass: string } {
  const R = role.toUpperCase();
  return {
    user: process.env[`PO_VIN_${R}_USER`] ?? process.env.PO_VIN_USERNAME ?? '',
    pass: process.env[`PO_VIN_${R}_PASS`] ?? process.env.PO_VIN_PASSWORD ?? '',
  };
}

export class PoVinDriver {
  private browser!: Browser;
  page!: Page;
  constructor(private mode: ExecutionMode) {}

  async open(role: string): Promise<void> {
    const { user, pass } = creds(role);
    this.browser = await chromium.launch({ headless: true });
    const ctx = await this.browser.newContext({ viewport: { width: 1440, height: 900 } });
    this.page = await ctx.newPage();
    const attempt = async (): Promise<boolean> => {
      await this.page.goto(URL + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.locator('#email, input[type="email"]').first().fill(user);
      await this.page.locator('#password, input[type="password"]').first().fill(pass);
      const resp = this.page.waitForResponse((r) => /hub-auth\/login/.test(r.url()), { timeout: 15000 }).catch(() => null);
      await this.page.locator('button[type="submit"]').first().click();
      await resp;
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await this.page.waitForTimeout(2500);
      return !this.page.url().includes('/login');
    };
    if (!(await attempt()) && !(await attempt())) throw new Error(`PO.vin login failed for role ${role}`);
  }

  private resolveLabel(node: DemoNode, role: string): string {
    return node.persona_labels?.[role] ?? node.persona_labels?.['default'] ?? node.intent_label;
  }

  private build(strategy: LocatorStrategy, label: string): Locator {
    const value = strategy.value.replaceAll('{label}', label);
    return this.page.locator(value);
  }

  /** Read the attributes the classifier needs via Playwright getters (no DOM
   *  eval — avoids the esbuild __name issue and string-expression ambiguity). */
  private async candidate(loc: Locator, tag = 'button') {
    const [text, type, role, ariaLabel, href, className] = await Promise.all([
      loc.innerText().catch(() => ''),
      loc.getAttribute('type').catch(() => null),
      loc.getAttribute('role').catch(() => null),
      loc.getAttribute('aria-label').catch(() => null),
      loc.getAttribute('href').catch(() => null),
      loc.getAttribute('class').catch(() => null),
    ]);
    const inNav = /sidebar|(^|[\s_-])nav([\s_-]|$)/i.test(className || '');
    return { tag, type, role, ariaLabel, text: (text || '').trim().slice(0, 80), href, className, inNav };
  }

  /** Navigate to a DemoGraph node, healing across its ordered locator strategies. */
  async gotoNode(node: DemoNode, role: string): Promise<NavResult> {
    const label = this.resolveLabel(node, role);
    let healedVia: string | null = null;
    for (let i = 0; i < node.locator_strategies.length; i++) {
      const s = node.locator_strategies[i];
      const loc = this.build(s, label).first();
      if (!(await loc.count().catch(() => 0)) || !(await loc.isVisible().catch(() => false))) continue;
      // Enforce the execution mode even for navigation (it should classify as read).
      const cand = await this.candidate(loc);
      const { cls } = cand ? classifyAction(cand) : { cls: 'read' as ActionClass };
      const perm = permits(cls, this.mode);
      if (!perm.permitted) return { ok: false, healedVia: `BLOCKED (${cls})`, url: this.page.url() };
      await loc.click().catch(() => {});
      await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await this.page.waitForTimeout(800);
      return { ok: true, healedVia: i === 0 ? null : `${s.how}:"${s.value}"`, url: this.page.url() };
    }
    // Final recovery: direct route navigation.
    if (node.screen_route) {
      await this.page.goto(URL + node.screen_route, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      healedVia = `route:${node.screen_route}`;
      return { ok: this.page.url().includes(node.screen_route), healedVia, url: this.page.url() };
    }
    return { ok: false, healedVia: null, url: this.page.url() };
  }

  /** Open the first PO row from the current queue (read navigation → /po/:id). */
  async openFirstPo(): Promise<boolean> {
    const row = this.page.locator('tbody tr').filter({ hasText: /PO-|REQ-|\$/ }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (!(await row.count().catch(() => 0))) return false;
    await row.click().catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await this.page.waitForTimeout(1200);
    // Wait for the action panel to render before any scan.
    await this.page.locator('button:has-text("Delegate"), button:has-text("Approve")').first()
      .waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    return this.page.url().includes('/po/');
  }

  /** Classify every action-like button on the current page and apply the mode policy. */
  async scanActions(): Promise<ActionScan[]> {
    const els = await this.page.locator('button').all();
    const out: ActionScan[] = [];
    for (const el of els.slice(0, 60)) {
      const cand = await this.candidate(el);
      if (!cand) continue;
      const label = (cand.text || cand.ariaLabel || '').trim();
      if (!label) continue;
      const { cls, reason } = classifyAction(cand);
      const perm = permits(cls, this.mode);
      out.push({ label, cls, permitted: perm.permitted, reason });
    }
    return out;
  }

  async screenshot(file: string): Promise<void> {
    await this.page.screenshot({ path: file, fullPage: true }).catch(() => {});
  }
  async close(): Promise<void> {
    await this.browser?.close();
  }
}
