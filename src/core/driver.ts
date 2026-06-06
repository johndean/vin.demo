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
import { db } from './db.js';

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
export interface WalkthroughStep { n: number; heading: string; action: string; }
export interface WalkthroughResult { steps: WalkthroughStep[]; stopped: string; committed: boolean; }

/** Everything that varies per product. The machinery in WebAdapter is shared. */
export interface ProductWebConfig {
  baseUrl: string;
  credsEnvPrefix: string;            // 'PO_VIN' → PO_VIN_<ROLE>_USER/PASS
  loginPath: string;                 // '/login', or '' when the base redirects to login
  loginTriggerSelector?: string;     // click this first to REACH the login form (OAuth/OIDC redirect behind a "Sign In" button — e.g. defensive.software → Keycloak)
  emailSelector: string;
  passwordSelector: string;
  submitSelector: string;
  loginSuccessUrlIncludes?: string;  // success when the URL contains this (SPA dashboards)
  loginSuccessSelector?: string;     // …or when this element renders
  postLoginPath?: string;            // after auth, navigate here (when the auth-redirect target is a blank shell — e.g. ce.vin)
  noAuth?: boolean;                  // public surface (e.g. an embeddable widget) — open() skips login entirely
  recordRowSelector?: string;        // omit → screen-level product (no "open a record" step)
  recordRowFilterText?: string;      // regex SOURCE (string, so config is JSON/jsonb-serializable — P4.1)
  recordReadySelector?: string;
  recordUrlIncludes?: string;
}

/** The contract every product's interaction layer must satisfy. */
export interface InteractionAdapter {
  open(role: string): Promise<void>;
  gotoNode(node: DemoNode, role: string): Promise<NavResult>;
  openRecord(): Promise<boolean>; // open a detail record if the product has one; else no-op → true
  scanActions(): Promise<ActionScan[]>;
  /** Step through a multi-step wizard in `safe` mode, never firing a commit (P3.4c). */
  walkthrough?(maxSteps: number): Promise<WalkthroughResult>;
  /** Render an on-screen caption of what VIN Demo says (SHOW_DEMO watch mode only). */
  narrate?(text: string, meta?: string): Promise<void>;
  /** Capture a still of the current screen (watch mode artifact). */
  screenshot?(file: string, fullPage?: boolean): Promise<void>;
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
    // SHOW_DEMO opens a VISIBLE browser the founder can watch (slowMo paces each step so it's
    // followable). RECORD_DEMO saves a replayable MP4. Both default OFF → headless (evals unaffected).
    const show = !!process.env.SHOW_DEMO;
    this.browser = await chromium.launch({ headless: !show, slowMo: show ? Number(process.env.DEMO_SLOWMO ?? 500) : 0 });
    const ctx = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...(process.env.RECORD_DEMO ? { recordVideo: { dir: 'tmp/demo-videos', size: { width: 1440, height: 900 } } } : {}),
    });
    this.page = await ctx.newPage();
    if (this.cfg.noAuth) {
      // Public surface (e.g. a no-login embed widget) — just land on it; no credentials.
      await this.page.goto(this.cfg.baseUrl + this.cfg.loginPath, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await this.page.waitForTimeout(2500);
      return;
    }
    const attempt = async (): Promise<boolean> => {
      await this.page.goto(this.cfg.baseUrl + this.cfg.loginPath, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (this.cfg.loginTriggerSelector) {
        // Login is behind a button that redirects to a hosted form (OAuth/OIDC, e.g. Keycloak) —
        // we can't navigate a static URL because it carries a per-session PKCE challenge. Click, then wait for the form.
        await this.page.locator(this.cfg.loginTriggerSelector).first().click({ timeout: 10000 }).catch(() => {});
        await this.page.locator(this.cfg.emailSelector).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      }
      await this.page.locator(this.cfg.emailSelector).first().fill(user);
      await this.page.locator(this.cfg.passwordSelector).first().fill(pass);
      await this.page.locator(this.cfg.submitSelector).first().click();
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await this.page.waitForTimeout(2500);
      if (this.cfg.postLoginPath) {
        // Auth succeeded but its redirect target is a blank shell — go to the real app home.
        await this.page.goto(this.cfg.baseUrl + this.cfg.postLoginPath, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(1500);
      }
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
    // Nav context: the element's OWN class, OR membership in a navigation landmark/sidebar.
    // SPA sidebars render nav items as <div>/<span> (no anchor/role), which would otherwise
    // fail closed to `mutating`; a confirmed mutating verb still blocks first (classifier step 1).
    const inNavClass = /sidebar|(^|[\s_-])nav([\s_-]|$)/i.test(className || '');
    const inNavAncestor = await loc
      .evaluate((e) => !!(e.closest && e.closest('nav, aside, [role="navigation"], [class*="sidebar" i], [class*="side-nav" i]')))
      .catch(() => false);
    const inNav = inNavClass || inNavAncestor;
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
    if (this.cfg.recordRowFilterText) row = row.filter({ hasText: new RegExp(this.cfg.recordRowFilterText, 'i') });
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
      // Skip stat cards / counters (e.g. "0", "$1,240", "TEAM MEMBERS 0 Direct + delegated") —
      // they're dashboard tiles, not action controls, and would be false-positive "mutating" (P3.5).
      if (/^[$\d]/.test(label) || (/\d/.test(label) && label.split(/\s+/).length > 3)) continue;
      const { cls, reason, confident } = classifyAction(cand);
      out.push({ label: label || `[${cand.tag}]`, cls, permitted: permits(cls, this.mode).permitted, confident, reason });
    }
    return out;
  }

  /** Step through a multi-step wizard, narrating each step. The hard guarantee: only
   *  advance via a control the mode PERMITS — a commit (Generate/Submit/Create/Sign…)
   *  classifies as mutating and is never clicked. Never fabricates free-text input. */
  async walkthrough(maxSteps: number): Promise<WalkthroughResult> {
    const steps: WalkthroughStep[] = [];
    const FWD = 'button:has-text("Next"), button:has-text("Continue"), button:has-text("Generate"), button:has-text("Create"), button:has-text("Submit"), button:has-text("Finish"), button:has-text("Sign")';
    for (let n = 1; n <= maxSteps; n++) {
      const heading = (await this.page.locator('h1, h2').first().innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 80);
      // The real advance button — exclude the "Next missing" jump-to-field chip.
      const fwd = this.page.locator(FWD).filter({ hasNotText: /missing/i }).first();
      if (!(await fwd.count().catch(() => 0))) { steps.push({ n, heading, action: 'no forward control' }); return { steps, stopped: 'no forward control', committed: false }; }
      const cand = await this.candidate(fwd, 'button');
      const { cls } = classifyAction(cand);
      if (!permits(cls, this.mode).permitted) {
        // SAFETY: advancing here would fire a commit — stop, never click it.
        steps.push({ n, heading, action: `STOP — "${cand.text}" is ${cls}, blocked in ${this.mode}` });
        return { steps, stopped: `reached commit "${cand.text}" (${cls}); not firing in ${this.mode} mode`, committed: false };
      }
      // If Next is gated on a required choice, pick the first unselected option (form-fill, safe).
      if (await fwd.isDisabled().catch(() => false)) {
        const opt = this.page.locator('input[type="radio"]:not(:checked), [role="radio"][aria-checked="false"]').first();
        if (await opt.count().catch(() => 0)) { await opt.click().catch(() => {}); await this.page.waitForTimeout(400); }
      }
      if (await fwd.isDisabled().catch(() => false)) {
        steps.push({ n, heading, action: "Next disabled — step needs input the demo won't fabricate; pausing" });
        return { steps, stopped: `step ${n} needs input the demo won't fabricate — paused`, committed: false };
      }
      await fwd.click().catch(() => {});
      await this.page.waitForTimeout(1300);
      steps.push({ n, heading, action: `advanced via "${cand.text}"` });
    }
    return { steps, stopped: `walked ${maxSteps} steps (cap)`, committed: false };
  }

  async screenshot(file: string, fullPage = true): Promise<void> {
    await this.page.screenshot({ path: file, fullPage }).catch(() => {});
  }
  async close(): Promise<void> {
    // In live-watch mode (SHOW_DEMO without RECORD_DEMO), leave the window open so the founder
    // can look around — the runner waits for Enter, then process exit tears it down. When
    // RECORD_DEMO is set we DO close, so Playwright flushes the video to disk.
    if (process.env.SHOW_DEMO && !process.env.RECORD_DEMO) return;
    await this.browser?.close();
  }

  /** Render what VIN Demo "says" as an on-screen caption over the real product (SHOW_DEMO only),
   *  so the watched window is a self-contained demo — product + consultant + trust metadata — not
   *  a silently-driven browser. No-op headless. */
  async narrate(text: string, meta = ''): Promise<void> {
    if (!process.env.SHOW_DEMO || !this.page) return;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const body = esc(text), sub = esc(meta);
    await this.page.evaluate(({ body, sub }) => {
      let bar = document.getElementById('vin-demo-narration');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'vin-demo-narration';
        bar.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(10,12,20,.93);color:#fff;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;padding:14px 22px;border-top:3px solid #4f8cff;box-shadow:0 -6px 28px rgba(0,0,0,.45)');
        document.body.appendChild(bar);
      }
      bar.innerHTML = '<div style="font-weight:700;color:#7fb0ff;letter-spacing:.04em;margin-bottom:3px">VIN&nbsp;DEMO</div><div>' + body + '</div>' + (sub ? '<div style="opacity:.62;font-size:12px;margin-top:5px">' + sub + '</div>' : '');
    }, { body, sub }).catch(() => {});
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
    recordRowFilterText: 'PO-|REQ-|\\$',
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
  'ce.vin': {
    baseUrl: process.env.CE_VIN_URL ?? 'https://ce.vin',
    credsEnvPrefix: 'CE_VIN',
    loginPath: '/sign-in',
    emailSelector: '#login-email, input[type="email"]',
    passwordSelector: '#login-pw, input[type="password"]',
    submitSelector: 'button:has-text("Authenticate"), button[type="submit"]',
    postLoginPath: '/#/dashboard', // /sign-in redirect target is a blank Vue shell; the app is here
    loginSuccessUrlIncludes: '#/dashboard',
    // screen-level: the course-review walkthrough proves read-only at the needs-review/sessions screens
  },
  'modelcontract.software': {
    baseUrl: process.env.MODELCONTRACT_WIDGET_URL ?? 'https://modelcontract.software/embed/wizard?role=employer&environment=vet',
    credsEnvPrefix: 'MODELCONTRACT',
    loginPath: '',
    emailSelector: '', passwordSelector: '', submitSelector: '', // unused — noAuth
    noAuth: true, // public no-login VIN Foundation model-employment-agreement wizard; driven via walkthrough() in `safe` mode
  },
};

export async function getAdapter(productName: string, mode: ExecutionMode): Promise<InteractionAdapter> {
  const key = (productName || '').toLowerCase();
  // Config-as-data (P4.1): prefer the product's environment.adapter_config (set by self-service
  // onboarding); fall back to the code registry so the originally hand-configured products keep working.
  let cfg: ProductWebConfig | undefined;
  try {
    const { rows } = await db().query<{ adapter_config: ProductWebConfig | null }>(
      `SELECT e.adapter_config FROM environments e JOIN products p ON p.id = e.product_id
        WHERE lower(p.name) = $1 AND e.adapter_config IS NOT NULL ORDER BY e.created_at LIMIT 1`,
      [key],
    );
    if (rows[0]?.adapter_config) cfg = rows[0].adapter_config;
  } catch { /* DB unreachable → fall back to the code registry */ }
  cfg = cfg ?? CONFIGS[key];
  if (!cfg) throw new Error(`No interaction adapter (DB config or code registry) for product "${productName}"`);
  return new WebAdapter(cfg, mode);
}
