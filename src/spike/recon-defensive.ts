/**
 * READ-ONLY recon for defensive.software — a SPA whose login is behind a "Sign In"
 * button (no /login route; client-side fallback). Clicks Sign In, then enumerates the
 * revealed fields/controls so we can author an adapter config.   No input is submitted.
 *   Run: tsx src/spike/recon-defensive.ts
 */
import { chromium } from 'playwright';
import { config as loadEnv } from 'dotenv';
loadEnv();

const BASE = process.env.DEFENSIVE_URL ?? 'https://defensive.software';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.log('goto err:', e.message));
await page.waitForTimeout(2500);
console.log(`landing url: ${page.url()}`);

// Click "Sign In" (button or link).
const signIn = page.locator('button:has-text("Sign In"), a:has-text("Sign In")').first();
await signIn.click({ timeout: 8000 }).catch((e) => console.log('Sign In click err:', e.message));
await page.waitForTimeout(2500);
console.log(`after Sign In: url=${page.url()} | frames=${page.frames().length}`);

// Fill the Keycloak form and submit (authentication — not a business mutation).
const U = process.env.DEFENSIVE_USERNAME ?? '', P = process.env.DEFENSIVE_PASSWORD ?? '';
await page.locator('#username').fill(U).catch((e) => console.log('user fill err:', e.message));
await page.locator('#password').fill(P).catch((e) => console.log('pass fill err:', e.message));
await page.locator('#kc-login').click().catch((e) => console.log('submit err:', e.message));
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);
console.log(`\nafter login: url=${page.url()}`);

await page.waitForTimeout(3000); // let the app canvas settle
await page.screenshot({ path: '/tmp/defensive-postlogin.png', fullPage: false }).catch(() => {});

// Enumerate the post-login app — nav labels / links / buttons (candidate demo screens).
const btns = await page.locator('button, a[href], [role="button"], [role="menuitem"], [role="tab"]').all().catch(() => []);
console.log(`post-login controls (${btns.length}):`);
const seen = new Set<string>();
for (const b of btns) {
  const t = (await b.innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 40);
  const href = await b.getAttribute('href').catch(() => null);
  const key = t || href || '';
  if (!key || seen.has(key) || /^[$\d☾‹?]/.test(key)) continue;
  seen.add(key);
  console.log('   •', JSON.stringify({ t, href: href?.slice(0, 40) }));
}
// Visible text blocks (what a stakeholder would actually read on screen).
const texts = await page.locator('h1, h2, h3, [class*="title" i], [class*="heading" i]').allInnerTexts().catch(() => []);
const uniqTexts = [...new Set(texts.map((t) => t.trim().replace(/\s+/g, ' ')).filter((t) => t.length > 1))].slice(0, 20);
console.log('headings/labels:', JSON.stringify(uniqTexts));
const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 400);
console.log('body excerpt:', body);
console.log('screenshot: /tmp/defensive-postlogin.png');
await browser.close();
process.exit(0);
