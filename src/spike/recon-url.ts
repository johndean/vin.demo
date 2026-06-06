/** READ-ONLY: dump a public page's structure (no login) — for reconning a public
 *  widget/embed. Run: tsx src/spike/recon-url.ts "<full-url>" */
import { chromium } from 'playwright';
const URL = process.argv[2];
if (!URL) throw new Error('usage: recon-url.ts "<full-url>"');

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.log('goto err:', e.message));
await page.waitForTimeout(3500);
console.log(`url: ${page.url()} — "${await page.title().catch(() => '?')}"  frames: ${page.frames().length}`);

async function dump(label: string, sel: string, attr?: string, cap = 40) {
  // search main + all frames (a widget may render in an iframe)
  let items: string[] = [];
  for (const f of page.frames()) {
    const els = await f.locator(sel).all().catch(() => []);
    for (const el of els.slice(0, cap)) {
      const t = (await el.innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 70);
      const a = attr ? await el.getAttribute(attr).catch(() => '') : '';
      if (t || a) items.push(`${t}${a ? `  → ${a}` : ''}`);
    }
  }
  items = [...new Set(items)];
  console.log(`\n── ${label} (${items.length}) ──`);
  for (const it of items.slice(0, cap)) console.log(`  • ${it}`);
}
await dump('headings', 'h1, h2, h3', undefined, 15);
await dump('inputs', 'input, textarea, select', 'placeholder', 20);
await dump('buttons / links', 'button, a[href], [role="button"]', undefined, 30);
const bodyText = (await page.locator('body').innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
console.log(`\nbody text (${bodyText.length}c): ${bodyText.slice(0, 500)}`);

await page.screenshot({ path: '/tmp/widget-recon.png', fullPage: true }).catch(() => {});
console.log('\n  screenshot → /tmp/widget-recon.png');
await browser.close();
process.exit(0);
