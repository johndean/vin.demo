/**
 * Interactive onboarding wizard (P4.2, the "both" option) — prompts for a product's
 * details, AUTHORS a manifest (manifests/<name>.json), then optionally runs the onboarder.
 * The manifest is the canonical artifact (reviewable/versioned); the wizard is a friendly
 * way to write one.   Run: npm run onboard:wizard
 */
import { createInterface } from 'node:readline/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { onboard, type Manifest } from './onboard.js';
import type { ProductWebConfig } from './driver.js';

// Works interactively (TTY readline) AND with piped input (a pre-drained line queue, for
// scripting/CI — readline/promises mishandles a fully-buffered pipe).
let queue: string[] | null = null;
if (!stdin.isTTY) {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(c as Buffer);
  queue = Buffer.concat(chunks).toString('utf8').split('\n');
}
const rl = stdin.isTTY ? createInterface({ input: stdin, output: stdout }) : null;
const ask = async (q: string, def = ''): Promise<string> => {
  const label = `${q}${def ? ` [${def}]` : ''}: `;
  if (queue) { const a = (queue.shift() ?? '').trim(); stdout.write(label + a + '\n'); return a || def; }
  const a = (await rl!.question(label)).trim();
  return a || def;
};
const yes = async (q: string): Promise<boolean> => /^y/i.test(await ask(`${q} (y/N)`));

console.log('\n── VIN Demo onboarding wizard ──  (authors a manifest, then optionally onboards)\n');
const name = await ask('Product name (e.g. acme.vin)');
const version = await ask('Version label', 'v1');
const baseUrl = await ask('Base URL', name.includes('.') ? `https://${name}` : '');

const adapter: ProductWebConfig = { baseUrl, credsEnvPrefix: '', loginPath: '', emailSelector: '', passwordSelector: '', submitSelector: '' };
if (await yes('Public, no-login surface (e.g. an embed widget)?')) {
  adapter.noAuth = true;
} else {
  adapter.credsEnvPrefix = await ask('Creds env prefix (read from .env)', name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
  adapter.loginPath = await ask('Login path', '/login');
  adapter.emailSelector = await ask('Email field selector', 'input[type="email"], #email');
  adapter.passwordSelector = await ask('Password field selector', 'input[type="password"], #password');
  adapter.submitSelector = await ask('Submit button selector', 'button[type="submit"]');
  const succ = await ask('Login success: URL contains (blank to skip)');
  if (succ) adapter.loginSuccessUrlIncludes = succ;
}

const navLabel = await ask('Primary demo screen — its nav label (button/link text)', 'Dashboard');
const intentLabel = await ask('…a short intent name for that screen', navLabel.toLowerCase());

const knowledge: Manifest['knowledge'] = [];
const k = await ask('One knowledge sentence about the product (blank to skip)');
if (k) knowledge.push({ content: k, confidence: 0.8, source: `${name} (wizard)`, lastVerified: new Date('2026-06-07').toISOString().slice(0, 10), validationStatus: 'validated' });
const reconUrl = await ask('…or a PUBLIC docs URL to auto-ingest (blank to skip)');
const expected = await ask('One question a stakeholder might ask', `how does ${name} work`);

const manifest: Manifest = {
  name, version,
  environment: { connectionTarget: baseUrl },
  adapter,
  knowledge,
  ...(reconUrl ? { knowledgeRecon: { url: reconUrl } } : {}),
  demoGraph: [{
    intentLabel, screenRoute: null,
    locatorStrategies: [{ how: 'css', value: 'a:has-text("{label}"), button:has-text("{label}")' }, { how: 'text', value: 'text={label}' }],
    personaLabels: { default: navLabel },
  }],
  expectedIntents: [expected],
};

await mkdir('manifests', { recursive: true });
const path = `manifests/${name}.json`;
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n✅ wrote ${path}`);

if (await yes('Onboard it now?')) {
  const pid = await onboard(manifest);
  console.log(`✅ onboarded "${name}" (no code). PRODUCT_ID=${pid}`);
} else {
  console.log(`(review ${path}, then: npm run onboard ${path})`);
}
rl?.close();
process.exit(0);
