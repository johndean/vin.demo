/**
 * Generic READ-ONLY recon for onboarding a web product (P3.x). Logs in with a role's
 * creds (from .env, by prefix), then maps the login flow + main screens so we can author
 * the adapter config, DemoGraph, and a demo scenario. No mutations.
 *   Run: tsx src/spike/recon-site.ts <ENV_PREFIX> [ROLE]
 *   e.g. tsx src/spike/recon-site.ts ROUNDS_VIN        (uses <PREFIX>_USERNAME/PASSWORD)
 *        tsx src/spike/recon-site.ts EXPENSE_VIN MANAGER
 */
import { chromium } from 'playwright';
import { config as loadEnv } from 'dotenv';
loadEnv();

const PREFIX = (process.argv[2] ?? '').toUpperCase();
const ROLE = (process.argv[3] ?? '').toUpperCase();
if (!PREFIX) throw new Error('usage: recon-site.ts <ENV_PREFIX> [ROLE]');
const BASE = process.env[`${PREFIX}_URL`] ?? '';
const user = process.env[`${PREFIX}_${ROLE}_USER`] ?? process.env[`${PREFIX}_USERNAME`] ?? '';
const pass = process.env[`${PREFIX}_${ROLE}_PASS`] ?? process.env[`${PREFIX}_PASSWORD`] ?? '';
if (!BASE || !user || !pass) throw new Error(`Missing ${PREFIX}_URL / creds in .env (role "${ROLE || '(default)'}")`);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

console.log(`→ ${BASE}  (${PREFIX} ${ROLE || '(default)'}: ${user})`);
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('  goto err:', e.message));
console.log(`  landed: ${page.url()} — "${await page.title().catch(() => '?')}"`);

const emailSel = 'input[type="email"], #email, input[name="email"], input[name="username"], input[type="text"]';
const passSel = 'input[type="password"], #password, input[name="password"]';
const hasLogin = async () => (await page.locator(emailSel).first().count().catch(() => 0)) > 0 && (await page.locator(passSel).first().count().catch(() => 0)) > 0;
let loginAt: string | null = null;
for (const path of ['', '/login', '/signin', '/auth/login', '/sign-in']) {
  if (path) await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  if (await hasLogin()) { loginAt = path || '(landing)'; break; }
}
console.log(`  login form: ${loginAt ?? 'NOT FOUND'} @ ${page.url()}`);

if (loginAt) {
  await page.locator(emailSel).first().fill(user).catch(() => {});
  await page.locator(passSel).first().fill(pass).catch(() => {});
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login"), button:has-text("Continue")').first().click().catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500);
}
console.log(`  after submit: ${page.url()} — "${await page.title().catch(() => '?')}"  loggedIn≈${!/login|signin|sign-in/i.test(page.url())}`);

async function dump(label: string, sel: string, attr?: string, cap = 40) {
  const els = await page.locator(sel).all();
  const seen = new Set<string>();
  console.log(`\n── ${label} (${els.length}) ──`);
  for (const el of els.slice(0, cap)) {
    const t = (await el.innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 60);
    const a = attr ? await el.getAttribute(attr).catch(() => '') : '';
    const key = `${t}|${a}`;
    if ((t || a) && !seen.has(key)) { seen.add(key); console.log(`  • ${t}${a ? `  → ${a}` : ''}`); }
  }
}
await dump('nav / sidebar links', 'nav a[href], aside a[href], [class*="sidebar"] a[href], [class*="menu"] a[href]', 'href');
await dump('headings', 'h1, h2', undefined, 15);
await dump('buttons', 'button', undefined, 40);

await page.screenshot({ path: '/tmp/recon-site.png', fullPage: true }).catch(() => {});
console.log('\n  screenshot → /tmp/recon-site.png');
await browser.close();
process.exit(0);
