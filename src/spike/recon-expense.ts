/**
 * Ad-hoc READ-ONLY recon of expense.vin (P3.3 onboarding). Logs in with a role's
 * creds (from .env), then maps the login flow + main screens so we can author the
 * adapter config, DemoGraph, and a demo scenario. No mutations — navigation + reads
 * + a screenshot only.  Run: tsx src/spike/recon-expense.ts [ROLE]
 */
import { chromium } from 'playwright';
import { config as loadEnv } from 'dotenv';
loadEnv();

const ROLE = (process.argv[2] ?? 'ADMIN').toUpperCase();
const BASE = process.env.EXPENSE_VIN_URL ?? 'https://www.expense.vin';
const user = process.env[`EXPENSE_VIN_${ROLE}_USER`] ?? '';
const pass = process.env[`EXPENSE_VIN_${ROLE}_PASS`] ?? '';
if (!user || !pass) throw new Error(`No creds for role ${ROLE} (set EXPENSE_VIN_${ROLE}_USER/PASS in .env)`);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

console.log(`→ ${BASE}  (role ${ROLE}: ${user})`);
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('  goto err:', e.message));
console.log(`  landed: ${page.url()} — "${await page.title().catch(() => '?')}"`);

const emailSel = 'input[type="email"], #email, input[name="email"], input[name="username"]';
const passSel = 'input[type="password"], #password, input[name="password"]';
async function hasLogin() {
  const e = page.locator(emailSel).first();
  return (await e.count().catch(() => 0)) > 0 && (await e.isVisible().catch(() => false));
}
let loginAt: string | null = null;
for (const path of ['', '/login', '/signin', '/auth/login', '/sign-in']) {
  if (path) await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  if (await hasLogin()) { loginAt = path || '(landing)'; break; }
}
console.log(`  login form: ${loginAt ?? 'NOT FOUND'} @ ${page.url()}`);

if (loginAt) {
  await page.locator(emailSel).first().fill(user).catch(() => {});
  await page.locator(passSel).first().fill(pass).catch(() => {});
  const submit = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login"), button:has-text("Continue")').first();
  await submit.click().catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500);
}
const loggedIn = !/login|signin|sign-in/i.test(page.url());
console.log(`  after submit: ${page.url()} — "${await page.title().catch(() => '?')}"  loggedIn≈${loggedIn}`);

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

await page.screenshot({ path: '/tmp/expense-recon.png', fullPage: true }).catch(() => {});
console.log('\n  screenshot → /tmp/expense-recon.png');
await browser.close();
process.exit(0);
