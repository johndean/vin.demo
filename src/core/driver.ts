/**
 * Interaction adapter (Playwright/web only — plan §4), product-agnostic (P3.1).
 * One generalized `WebAdapter` drives any web product from a `ProductWebConfig`
 * (base URL, login flow, success signal, and an optional "open a record" step);
 * the generalizable machinery — DemoGraph-driven self-healing navigation + the
 * fail-closed action classifier + scanActions — is shared. PO.vin and expense.vin
 * are two configs in the registry; `getAdapter(productName, mode)` picks one.
 */
import { chromium, type Browser, type Page, type Locator } from 'playwright';
import { config as loadEnv } from 'dotenv';
import { classifyAction, permits, type ExecutionMode, type ActionClass } from './safety.js';

loadEnv();

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
  confident: boolean; // false = blocked by fail-closed default, not a confirmed mutation
  reason: string;
}

/** Everything that varies per product. The machinery in WebAdapter is shared. */
export interface ProductWebConfig {
  baseUrl: string;
  credsEnvPrefix: string;            // 'PO_VIN' → PO_VIN_<ROLE>_USER/PASS
  loginPath: string;                 // '/login', or '' when the base redirects to login
  emailSelector: string;
  passwordSelector: string;
  submitSelector: string;
  loginSuccessUrlIncludes?: string;  // success when the URL contains this (SPA dashboards)
  loginSuccessSelector?: string;     // …or when this element renders
  recordRowSelector?: string;        // omit → screen-level product (no "open a record" step)
  recordRowFilterText?: RegExp;
  recordReadySelector?: string;
  recordUrlIncludes?: string;
}

/** The contract every product's interaction layer must satisfy. */
export interface InteractionAdapter {
  open(role: string): Promise<void>;
  gotoNode(node: DemoNode, role: string): Promise<NavResult>;
  openRecord(): Promise<boolean>; // open a detail record if the product has one; else no-op → true
  scanActions(): Promise<ActionScan[]>;
  close(): Promise<void>;
}

function creds(prefix: string, role: string): { user: string; pass: string } {
  const R = role.toUpperCase();
  return {
    user: process.env[`${prefix}_${R}_USER`] ?? process.env[`${prefix}_USERNAME`] ?? '',
    pass: process.env[`${prefix}_${R}_PASS`] ?? process.env[`${prefix}_PASSWORD`] ?? '',
  };
}

export class WebAdapter implements InteractionAdapter {
  private browser!: Browser;
  page!: Page;
  constructor(private cfg: ProductWebConfig, private mode: ExecutionMode) {}

  async open(role: string): Promise<void> {
    const { user, pass } = creds(this.cfg.credsEnvPrefix, role);
    this.browser = await chromium.launch({ headless: true });
    const ctx = await this.browser.newContext({ viewport: { width: 1440, height: 900 } });
    this.page = await ctx.newPage();
    const attempt = async (): Promise<boolean> => {
      await this.page.goto(this.cfg.baseUrl + this.cfg.loginPath, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.locator(this.cfg.emailSelector).first().fill(user);
      await this.page.locator(this.cfg.passwordSelector).first().fill(pass);
      await this.page.locator(this.cfg.submitSelector).first().click();
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await this.page.waitForTimeout(2500);
      if (this.cfg.loginSuccessUrlIncludes) return this.page.url().includes(this.cfg.loginSuccessUrlIncludes);
      if (/\/login\b/.test(this.page.url())) return false;
      if (this.cfg.loginSuccessSelector) {
        return this.page.locator(this.cfg.loginSuccessSelector).first()
          .waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
      }
      return !/login|signin/i.test(this.page.url());
    };
    if (!(await attempt()) && !(await attempt())) throw new Error(`${this.cfg.baseUrl} login failed for role ${role}`);
  }

  private resolveLabel(node: DemoNode, role: string): string {
    return node.persona_labels?.[role] ?? node.persona_labels?.['default'] ?? node.intent_label;
  }
  private build(strategy: LocatorStrategy, label: string): Locator {
    return this.page.locator(strategy.value.replaceAll('{label}', label));
  }
  /** Read attributes the classifier needs via Playwright getters (no DOM eval). */
  private async candidate(loc: Locator, tag = 'button') {
    const [text, type, role, ariaLabel, title, href, className] = await Promise.all([
      loc.innerText().catch(() => ''),
      loc.getAttribute('type').catch(() => null),
      loc.getAttribute('role').catch(() => null),
      loc.getAttribute('aria-label').catch(() => null),
      loc.getAttribute('title').catch(() => null),
      loc.getAttribute('href').catch(() => null),
      loc.getAttribute('class').catch(() => null),
    ]);
    const inNav = /sidebar|(^|[\s_-])nav([\s_-]|$)/i.test(className || '');
    return { tag, type, role, ariaLabel, title, text: (text || '').trim().slice(0, 80), href, className, inNav };
  }

  /** Navigate to a DemoGraph node, healing across its ordered locator strategies. */
  async gotoNode(node: DemoNode, role: string): Promise<NavResult> {
    const label = this.resolveLabel(node, role);
    let healedVia: string | null = null;
    for (let i = 0; i < node.locator_strategies.length; i++) {
      const s = node.locator_strategies[i];
      const loc = this.build(s, label).first();
      if (!(await loc.count().catch(() => 0)) || !(await loc.isVisible().catch(() => false))) continue;
      const isAnchor = !!(await loc.getAttribute('href').catch(() => null));
      const { cls } = classifyAction(await this.candidate(loc, isAnchor ? 'a' : 'button'));
      if (!permits(cls, this.mode).permitted) return { ok: false, healedVia: `BLOCKED (${cls})`, url: this.page.url() };
      await loc.click().catch(() => {});
      await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await this.page.waitForTimeout(800);
      return { ok: true, healedVia: i === 0 ? null : `${s.how}:"${s.value}"`, url: this.page.url() };
    }
    if (node.screen_route) {
      const { cls } = classifyAction({ tag: 'a', href: node.screen_route, text: node.intent_label });
      if (!permits(cls, this.mode).permitted) return { ok: false, healedVia: `BLOCKED route (${cls})`, url: this.page.url() };
      await this.page.goto(this.cfg.baseUrl + node.screen_route, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      healedVia = `route:${node.screen_route}`;
      return { ok: this.page.url().includes(node.screen_route), healedVia, url: this.page.url() };
    }
    return { ok: false, healedVia: null, url: this.page.url() };
  }

  /** Open the first detail record (e.g. a PO row). Screen-level products: no-op → true. */
  async openRecord(): Promise<boolean> {
    if (!this.cfg.recordRowSelector) return true;
    let row = this.page.locator(this.cfg.recordRowSelector);
    if (this.cfg.recordRowFilterText) row = row.filter({ hasText: this.cfg.recordRowFilterText });
    const first = row.first();
    await first.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (!(await first.count().catch(() => 0))) return false;
    const { cls } = classifyAction(await this.candidate(first, 'tr'));
    if (!permits(cls, this.mode).permitted) return false;
    await first.click().catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await this.page.waitForTimeout(1200);
    if (this.cfg.recordReadySelector) {
      await this.page.locator(this.cfg.recordReadySelector).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }
    return this.cfg.recordUrlIncludes ? this.page.url().includes(this.cfg.recordUrlIncludes) : true;
  }

  /** Classify every action-like element on the page and apply the mode policy. */
  async scanActions(): Promise<ActionScan[]> {
    const CAP = 250;
    const els = await this.page
      .locator('button, a[href], input[type="submit"], input[type="button"], [role="button"], [role="menuitem"]')
      .all();
    if (els.length > CAP) console.error(`  (scanActions: ${els.length} candidates, scanning first ${CAP})`);
    const out: ActionScan[] = [];
    for (const el of els.slice(0, CAP)) {
      const isAnchor = !!(await el.getAttribute('href').catch(() => null));
      const cand = await this.candidate(el, isAnchor ? 'a' : 'button');
      const label = (cand.text || cand.ariaLabel || cand.title || '').trim();
      if (!label && cand.tag !== 'a') continue;
      const { cls, reason, confident } = classifyAction(cand);
      out.push({ label: label || `[${cand.tag}]`, cls, permitted: permits(cls, this.mode).permitted, confident, reason });
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

/** Per-product adapter configs (the registry). Onboarding a product adds a config. */
const CONFIGS: Record<string, ProductWebConfig> = {
  'po.vin': {
    baseUrl: process.env.PO_VIN_URL ?? 'https://po.vin',
    credsEnvPrefix: 'PO_VIN',
    loginPath: '/login',
    emailSelector: '#email, input[type="email"]',
    passwordSelector: '#password, input[type="password"]',
    submitSelector: 'button[type="submit"]',
    loginSuccessSelector: 'button:has-text("New Purchase Request")',
    recordRowSelector: 'tbody tr',
    recordRowFilterText: /PO-|REQ-|\$/,
    recordReadySelector: 'button:has-text("Delegate"), button:has-text("Approve")',
    recordUrlIncludes: '/po/',
  },
  'expense.vin': {
    baseUrl: process.env.EXPENSE_VIN_URL ?? 'https://www.expense.vin',
    credsEnvPrefix: 'EXPENSE_VIN',
    loginPath: '', // base redirects to /#/login
    emailSelector: 'input[type="email"], #email, input[name="email"]',
    passwordSelector: 'input[type="password"], #password',
    submitSelector: 'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
    loginSuccessUrlIncludes: '/#/dashboard',
    // screen-level: no record to open (the demo proves read-only at the queue screen)
  },
  'rounds.vin': {
    baseUrl: process.env.ROUNDS_VIN_URL ?? 'https://rounds.vin',
    credsEnvPrefix: 'ROUNDS_VIN',
    loginPath: '/signin',
    emailSelector: 'input[type="email"], input[name="email"], input[name="username"], input[type="text"]',
    passwordSelector: 'input[type="password"], #password',
    submitSelector: 'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
    loginSuccessUrlIncludes: '#/dashboard',
    // screen-level: the pipeline walkthrough proves read-only at the dashboard/sessions screens
  },
};

export function getAdapter(productName: string, mode: ExecutionMode): InteractionAdapter {
  const cfg = CONFIGS[(productName || '').toLowerCase()];
  if (!cfg) throw new Error(`No interaction adapter registered for product "${productName}"`);
  return new WebAdapter(cfg, mode);
}
