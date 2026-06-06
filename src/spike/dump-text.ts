/**
 * READ-ONLY: log in by env prefix, navigate to a path, and dump its readable text
 * (headings + paragraphs + list items) so we can author accurate knowledge chunks.
 *   Run: tsx src/spike/dump-text.ts <ENV_PREFIX> [PATH]   e.g. ROUNDS_VIN /docs
 */
import { chromium } from 'playwright';
import { config as loadEnv } from 'dotenv';
loadEnv();

const PREFIX = (process.argv[2] ?? '').toUpperCase();
const PATH = process.argv[3] ?? '/docs';
const BASE = process.env[`${PREFIX}_URL`] ?? '';
const user = process.env[`${PREFIX}_USERNAME`] ?? '';
const pass = process.env[`${PREFIX}_PASSWORD`] ?? '';
if (!BASE || !user || !pass) throw new Error(`Missing ${PREFIX}_URL / USERNAME / PASSWORD in .env`);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
const emailSel = 'input[type="email"], #email, input[name="email"], input[name="username"], input[type="text"]';
const passSel = 'input[type="password"], #password, input[name="password"]';
if ((await page.locator(passSel).first().count().catch(() => 0)) > 0) {
  await page.locator(emailSel).first().fill(user).catch(() => {});
  await page.locator(passSel).first().fill(pass).catch(() => {});
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")').first().click().catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

await page.goto(BASE + PATH, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log(`# ${PATH} @ ${page.url()} — "${await page.title().catch(() => '?')}"\n`);

const blocks = await page.locator('main h1, main h2, main h3, main h4, main p, main li, article h1, article h2, article h3, article p, article li').all();
const src = blocks.length ? blocks : await page.locator('h1, h2, h3, h4, p, li').all();
const seen = new Set<string>();
let n = 0;
for (const el of src) {
  if (n > 200) break;
  const tag = await el.evaluate((e) => e.tagName.toLowerCase()).catch(() => 'p');
  const t = (await el.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
  if (!t || t.length < 3 || seen.has(t)) continue;
  seen.add(t);
  n++;
  console.log(/^h/.test(tag) ? `\n## ${t}` : `${t}`);
}
await browser.close();
process.exit(0);
