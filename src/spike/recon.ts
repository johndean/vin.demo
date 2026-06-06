/**
 * Phase 0 recon — OBSERVE-ONLY.
 *
 * Logs in to po.vin and maps the app so we can find the approval-delegation
 * feature and capture selectors for the core loop. It does NOT click any
 * business control (Submit / Approve / Delete / Save). The only action it
 * performs is authentication (filling the login form), per ADR-0003's
 * observe-first posture.
 *
 * Output: tmp/recon/  (screenshots + map.json + page HTML) — gitignored.
 */
import { chromium, type Page } from 'playwright';
import { config as loadEnv } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

loadEnv();

const URL = process.env.PO_VIN_URL ?? 'https://po.vin';
const USER = process.env.PO_VIN_USERNAME ?? '';
const PASS = process.env.PO_VIN_PASSWORD ?? '';
const OUT = path.resolve('tmp/recon');

const KEYWORDS = ['approv', 'deleg', 'purchase order', 'workflow', 'po ', 'requisition'];

async function snapshot(page: Page, label: string) {
  await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  await writeFile(path.join(OUT, `${label}.html`), html).catch(() => {});
}

/** Best-effort interactive-element map: text + role + a stable-ish selector.
 *  Passed as a string so esbuild/tsx doesn't inject its `__name` helper. */
async function mapInteractive(page: Page): Promise<Array<Record<string, string>>> {
  return page.evaluate(`(function () {
    function sel(el) {
      if (el.id) return '#' + CSS.escape(el.id);
      var t = el.getAttribute('data-testid'); if (t) return '[data-testid="' + t + '"]';
      var aria = el.getAttribute('aria-label'); if (aria) return '[aria-label="' + aria + '"]';
      var name = el.getAttribute('name'); if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
      return el.tagName.toLowerCase();
    }
    var out = [];
    document.querySelectorAll('a, button, [role="button"], input, [role="menuitem"], nav *').forEach(function (el) {
      var text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
      var href = el.getAttribute('href') || '';
      if (!text && !href) return;
      out.push({ tag: el.tagName.toLowerCase(), text: text, href: href, selector: sel(el) });
    });
    var seen = {};
    return out.filter(function (o) {
      var k = o.tag + '|' + o.text + '|' + o.href;
      if (seen[k]) return false; seen[k] = true; return true;
    });
  })()`) as Promise<Array<Record<string, string>>>;
}

async function tryLogin(page: Page) {
  // Defensive: po.vin's login DOM is unknown. Try common patterns.
  const emailSel = ['input[type="email"]', 'input[name*="email" i]', 'input[name*="user" i]', 'input[id*="email" i]'];
  const passSel = ['input[type="password"]', 'input[name*="pass" i]'];
  const submitSel = ['button[type="submit"]', 'button:has-text("Sign in")', 'button:has-text("Log in")', 'button:has-text("Login")', '[type="submit"]'];

  const firstVisible = async (sels: string[]) => {
    for (const s of sels) {
      const loc = page.locator(s).first();
      if (await loc.count() && await loc.isVisible().catch(() => false)) return loc;
    }
    return null;
  };

  const email = await firstVisible(emailSel);
  const pass = await firstVisible(passSel);
  if (!email || !pass) {
    console.log('  ! No obvious login form on landing page — may already be public or use SSO. Skipping login.');
    return false;
  }
  await email.fill(USER);
  await pass.fill(PASS);
  console.log('  Filled credentials, submitting…');
  const submit = await firstVisible(submitSel);
  if (submit) await submit.click().catch(() => {});
  else await pass.press('Enter').catch(() => {});
  // Wait for the SPA to route away from /login, then let it hydrate.
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const ok = !page.url().includes('/login');
  console.log(ok ? '  Login OK.' : '  ! Still on /login — check credentials or for a 2FA/error state.');
  return ok;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Recon → ${URL}  (observe-only)`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } } as any);

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  console.log(`  Landing title: "${await page.title()}"  url: ${page.url()}`);
  await snapshot(page, '01-landing');

  const loggedIn = await tryLogin(page);
  if (loggedIn) {
    console.log(`  Post-login title: "${await page.title()}"  url: ${page.url()}`);
    await snapshot(page, '02-after-login');
  }

  const map = await mapInteractive(page);
  await writeFile(path.join(OUT, 'map.json'), JSON.stringify(map, null, 2));

  const hits = map.filter((m) =>
    KEYWORDS.some((k) => (m.text + ' ' + m.href).toLowerCase().includes(k))
  );

  console.log(`\n  ${map.length} interactive elements mapped → tmp/recon/map.json`);
  console.log(`  ${hits.length} candidate approval/delegation/PO elements:`);
  for (const h of hits.slice(0, 25)) {
    console.log(`    • [${h.tag}] "${h.text}" ${h.href ? `→ ${h.href}` : ''}  (${h.selector})`);
  }
  await writeFile(path.join(OUT, 'candidates.json'), JSON.stringify(hits, null, 2));

  await browser.close();
  console.log('\nDone. Review tmp/recon/{01-landing.png,02-after-login.png,map.json,candidates.json}');
}

main().catch((e) => {
  console.error('Recon failed:', e?.message ?? e);
  process.exit(1);
});
