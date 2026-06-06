/** READ-ONLY deep diagnostic for ce.vin (P3.4b): log in, then probe session cookies,
 *  DOM shape, and alternate post-login routes to find a navigable surface. No mutations. */
import { chromium } from 'playwright';
import { config as loadEnv } from 'dotenv';
loadEnv();

const BASE = process.env.CE_VIN_URL ?? 'https://ce.vin';
const user = process.env.CE_VIN_USERNAME ?? '';
const pass = process.env.CE_VIN_PASSWORD ?? '';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 140)));

await page.goto(BASE + '/sign-in', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.locator('#login-email, input[type="email"]').first().fill(user).catch(() => {});
await page.locator('#login-pw, input[type="password"]').first().fill(pass).catch(() => {});
await page.locator('input[type="checkbox"]').first().check().catch(() => {});
// Capture the auth response status.
const authResp = page.waitForResponse((r) => /login|auth|signin|session|token/i.test(r.url()) && r.request().method() === 'POST', { timeout: 12000 }).catch(() => null);
await page.locator('button:has-text("Authenticate"), button[type="submit"]').first().click().catch(() => {});
const ar = await authResp;
if (ar) console.log(`auth POST: ${ar.status()} ${ar.url().slice(0, 70)}`);
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);

// The auth-redirect target (/sign-in) is a blank shell; the app lives at /#/dashboard.
await page.goto(BASE + '/#/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(3500);
console.log(`\napp home: ${page.url()} — "${await page.title().catch(() => '?')}"`);

async function dump(label: string, sel: string, attr?: string, cap = 40) {
  const els = await page.locator(sel).all();
  const seen = new Set<string>();
  console.log(`\n── ${label} (${els.length}) ──`);
  for (const el of els.slice(0, cap)) {
    const t = (await el.innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 60);
    const a = attr ? await el.getAttribute(attr).catch(() => '') : '';
    if ((t || a) && !seen.has(`${t}|${a}`)) { seen.add(`${t}|${a}`); console.log(`  • ${t}${a ? `  → ${a}` : ''}`); }
  }
}
await dump('nav links', 'a[href]', 'href');
await dump('headings', 'h1, h2, h3', undefined, 15);
await dump('buttons', 'button', undefined, 30);

await page.screenshot({ path: '/tmp/ce-recon.png', fullPage: true }).catch(() => {});
await browser.close();
process.exit(0);
