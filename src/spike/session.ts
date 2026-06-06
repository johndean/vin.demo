/** Shared PO.vin session: launch a browser and authenticate.
 *  PO.vin is a Supabase-backed SPA. Login is flaky — the app can route to the
 *  dashboard before the auth token persists and then bounce back to /login. So
 *  we wait for the hub-auth/login response, let the hub-api burst settle, and
 *  retry once if we get bounced. */
import { chromium, type Browser, type Page } from 'playwright';
import { config as loadEnv } from 'dotenv';

loadEnv();

export interface Session {
  browser: Browser;
  page: Page;
}

const URL = process.env.PO_VIN_URL ?? 'https://po.vin';

async function attemptLogin(page: Page, user: string, pass: string): Promise<boolean> {
  await page.goto(URL + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#email, input[type="email"]').first().fill(user);
  await page.locator('#password, input[type="password"]').first().fill(pass);
  const loginResp = page
    .waitForResponse((r) => /hub-auth\/login/.test(r.url()), { timeout: 15000 })
    .catch(() => null);
  await page.locator('button[type="submit"]').first().click();
  await loginResp;
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return !page.url().includes('/login');
}

/** Resolve credentials for the active role/persona, falling back to the default account. */
function credsForRole(role: string): { user: string; pass: string } {
  const R = role.toUpperCase();
  const user = process.env[`PO_VIN_${R}_USER`] ?? process.env.PO_VIN_USERNAME ?? '';
  const pass = process.env[`PO_VIN_${R}_PASS`] ?? process.env.PO_VIN_PASSWORD ?? '';
  return { user, pass };
}

export async function openSession(opts: { headless?: boolean; role?: string } = {}): Promise<Session> {
  const role = opts.role ?? process.env.PO_VIN_ROLE ?? 'owner';
  const { user, pass } = credsForRole(role);
  console.log(`  (session: logging in as ${role} — ${user})`);
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  let ok = await attemptLogin(page, user, pass);
  if (!ok) ok = await attemptLogin(page, user, pass); // retry once on bounce
  if (!ok) {
    const err = (await page.locator('body').innerText().catch(() => '')).slice(0, 200);
    await browser.close();
    throw new Error(`Login failed after retry. Page said: ${err}`);
  }
  // Ensure the dashboard is actually rendered before returning.
  await page.locator('button:has-text("New Purchase Request")').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  return { browser, page };
}
