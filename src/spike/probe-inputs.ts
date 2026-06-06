/**
 * READ-ONLY: enumerate form fields + buttons on a sign-in page (across all frames),
 * to discover login selectors for a custom-auth product. No input is filled.
 *   Run: tsx src/spike/probe-inputs.ts <ENV_PREFIX> [PATH]   e.g. CE_VIN /sign-in
 */
import { chromium } from 'playwright';
import { config as loadEnv } from 'dotenv';
loadEnv();

const PREFIX = (process.argv[2] ?? '').toUpperCase();
const PATH = process.argv[3] ?? '/sign-in';
const BASE = process.env[`${PREFIX}_URL`] ?? '';
if (!BASE) throw new Error(`Missing ${PREFIX}_URL in .env`);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(BASE + PATH, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.log('goto err:', e.message));
await page.waitForTimeout(4000);
console.log(`url: ${page.url()} | title: "${await page.title().catch(() => '?')}" | frames: ${page.frames().length}`);

for (const f of page.frames()) {
  const inputs = await f.locator('input, textarea, [contenteditable="true"]').all().catch(() => []);
  const btns = await f.locator('button, [role="button"], input[type="submit"], a[href]').all().catch(() => []);
  if (!inputs.length && !btns.length) continue;
  console.log(`\n[frame] ${f.url().slice(0, 70)}  — ${inputs.length} field(s), ${btns.length} control(s)`);
  for (const inp of inputs) {
    const a = await inp.evaluate((e) => ({ tag: e.tagName.toLowerCase(), type: e.getAttribute('type'), name: e.getAttribute('name'), id: (e as HTMLElement).id || null, placeholder: e.getAttribute('placeholder'), autocomplete: e.getAttribute('autocomplete'), aria: e.getAttribute('aria-label') })).catch(() => null);
    if (a) console.log('  INPUT', JSON.stringify(a));
  }
  for (const b of btns.slice(0, 14)) {
    const t = (await b.innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 40);
    const ty = await b.getAttribute('type').catch(() => null);
    const href = await b.getAttribute('href').catch(() => null);
    if (t || ty || href) console.log('  CTRL', JSON.stringify({ t, type: ty, href: href?.slice(0, 50) }));
  }
}
await browser.close();
process.exit(0);
