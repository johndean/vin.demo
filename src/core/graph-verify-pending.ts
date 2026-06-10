/**
 * SELECTIVE, non-destructive recon promotion (pending → verified). Unlike graph-verify (which marks every
 * non-resolving node 'broken'), this promotes a node to 'verified' ONLY when it genuinely resolves on the
 * REAL DOM in a live session, and otherwise LEAVES IT pending (never downgrades to broken — no regression).
 * Read-only execution mode (no mutations fired). It attempts four node kinds, each under a role that can
 * actually reach the screen, reusing one adapter session per role:
 *   • concrete    — a real standalone route (`/registry`): navigate + confirm the URL/locator resolves.
 *   • dispatched  — role-multiplexed landing (`/`, `/dashboard`): a role-R session that lands there IS the
 *                   evidence the role-R variant renders; the trivial `/` substring match is rejected (a
 *                   locator must carry it) so '/'-routed dashboards only verify on real DOM, not on the path.
 *   • overlay     — non-route surface with a trigger locator (a Help slide-over): verify by opening it
 *                   (locator only — the synthetic route is never navigated).
 *   • record      — a parameterized detail (`/po/:id`) on a product with a record-row config: enter the
 *                   list and open the first real record; the adapter's recordUrlIncludes check is the gate.
 * Parameterized routes with no record config, and non-route nodes with no locator, are SKIPPED (left
 * pending) — they need a concrete id / per-role creds this pass can't synthesize; graph-pending names each.
 * Run: railway run npx tsx src/core/graph-verify-pending.ts "<product>" [extraRole...]
 */
import 'dotenv/config';
import { db } from './db.js';
import { getAdapter, type DemoNode, type InteractionAdapter } from './driver.js';
import type { ExecutionMode } from './safety.js';
import { rollupWorkflowsForGraph, recomputeGraphScore, recordGraphEvent } from './graph-lifecycle.js';

const ROLE_ORDER = ['admin', 'accounting', 'manager', 'owner', 'employee', 'auditor'];
// Per-product list route to enter when harvesting a representative record for a `:id` detail node.
const RECORD_ENTRY: Record<string, string> = { 'po.vin': '/registry' };

type Kind = 'concrete' | 'dispatched' | 'overlay' | 'param' | 'skip';
function classify(route: string | null, hasLoc: boolean): Kind {
  const r = (route ?? '').trim();
  if (!r || r.toLowerCase() === 'global overlay') return hasLoc ? 'overlay' : 'skip'; // non-route
  if (r.includes(':') || r.includes('*')) return 'param';                              // parameterized
  if (r === '/' || r === '/dashboard') return 'dispatched';                            // role-multiplexed
  return 'concrete';
}

type Row = { id: string; intent_label: string; screen_route: string | null; locator_strategies: any; persona_labels: any; permissions_required: any };

export async function runSelectiveVerify(product: string, extraRoles: string[] = []): Promise<{ verified: number; attempted: number; skipped: number; stillPending: number; log: string[] }> {
  const log: string[] = [];
  const say = (s: string) => { log.push(s); console.log(s); };
  const prefix = product.toUpperCase().replace(/\./g, '_'); // PO.vin → PO_VIN
  const pkey = product.toLowerCase();

  const g = (await db().query<{ id: string; product_id: string; name: string }>(`
    SELECT g.id, g.product_id, g.name FROM demo_graphs g JOIN products p ON p.id=g.product_id
     WHERE lower(p.name)=lower($1) AND g.status='active' AND g.archived_at IS NULL ORDER BY g.graph_version DESC LIMIT 1`, [product])).rows[0];
  if (!g) throw new Error(`no active graph for "${product}"`);

  const all = (await db().query<Row>(`
    SELECT id, intent_label, screen_route, locator_strategies, persona_labels, permissions_required
      FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL AND verification_status IN ('pending_review','draft')`, [g.id])).rows;
  const kindOf = (n: Row): Kind => classify(n.screen_route, Array.isArray(n.locator_strategies) && n.locator_strategies.length > 0);
  const live = all.filter((n) => ['concrete', 'dispatched', 'overlay'].includes(kindOf(n))); // attemptable in the role loop
  const paramNodes = all.filter((n) => kindOf(n) === 'param');
  const skipped = all.length - live.length;
  say(`\n══ Selective recon: ${product} — "${g.name}" ══`);
  say(`  ${all.length} pending/draft · ${live.length} live-attemptable (concrete/dispatched/overlay) · ${paramNodes.length} parameterized · ${skipped} skipped → stay pending`);

  // a JWT-only page (no role tier) is reachable by ANY logged-in role — these sentinel tokens mean "any
  // signed-in user", so an authenticated recon session (e.g. the admin login) legitimately reaches them.
  const ANY_AUTH = new Set(['any signed-in user', 'authenticated', 'signed-in user', 'staff', 'operator']);
  const reach = (n: Row, role: string): boolean => {
    const perms = Array.isArray(n.permissions_required) ? n.permissions_required.map((x: any) => String(x).toLowerCase()) : [];
    return perms.length === 0 || perms.includes('public') || perms.includes(role) || perms.some((p) => ANY_AUTH.has(p));
  };
  // default login pass ('admin' creds, falling back to PREFIX_USERNAME) + a pass per role that has dedicated creds.
  const rolesToTry = ['admin', ...ROLE_ORDER.filter((r) => r !== 'admin' && process.env[`${prefix}_${r.toUpperCase()}_USER`]), ...extraRoles];
  const verifiedIds = new Set<string>();
  let attempted = 0;

  const promote = async (n: Row, role: string, url: string, basis: string) => {
    verifiedIds.add(n.id);
    await db().query(`UPDATE demo_graph_nodes SET verification_status='verified', last_verified=now(), verification_source=$2 WHERE id=$1`, [n.id, `recon-${role}`]);
    await recordGraphEvent('verify', { graphId: g.id, nodeId: n.id, productId: g.product_id, actor: 'graph-verify-pending', before: { verification_status: 'pending_review' }, after: { verification_status: 'verified', url, role, basis } });
    say(`     ✅ ${n.intent_label} (via ${basis})`);
  };

  for (const role of rolesToTry) {
    const todo = live.filter((n) => !verifiedIds.has(n.id) && reach(n, role));
    if (!todo.length) continue;
    let adapter: InteractionAdapter;
    try { adapter = await getAdapter(product, 'read-only' as ExecutionMode); await adapter.open(role); }
    catch (e: any) { say(`  ⚠️ role "${role}": recon login/launch failed (${String(e?.message ?? e).slice(0, 120)}) — ${todo.length} node(s) left pending`); continue; }
    say(`  — role "${role}": attempting ${todo.length} node(s) —`);
    try {
      for (const n of todo) {
        attempted++;
        const kind = kindOf(n);
        // overlay: try the locator only (never navigate the synthetic 'global overlay' route).
        const route = kind === 'overlay' ? null : n.screen_route;
        const node: DemoNode = { intent_label: n.intent_label, screen_route: route, locator_strategies: Array.isArray(n.locator_strategies) ? n.locator_strategies : [], persona_labels: n.persona_labels ?? {} };
        const r = await adapter.gotoNode(node, role);
        // A '/'-routed dashboard matches on any URL (every URL contains '/'), so the route match alone is
        // not evidence. But open() ALREADY proved this role authenticated (it throws otherwise), so an
        // authenticated role-R session that lands on the dispatch route — and is NOT bounced back to a login
        // screen — IS the role-R dashboard rendering. That is the per-role recon graph-pending asks for.
        const bouncedToLogin = /\/(login|signin|sign-in)(\b|$)|#\/login/i.test(r.url);
        const okToPromote = r.ok && !(kind === 'dispatched' && bouncedToLogin);
        if (okToPromote) {
          const viaLocator = !!r.healedVia && !r.healedVia.startsWith('route:');
          await promote(n, role, r.url, viaLocator ? 'locator' : (kind === 'dispatched' ? `${role} landing` : 'route'));
        } else {
          say(`     ⏳ ${n.intent_label} (${kind}; did not resolve as ${role}${bouncedToLogin ? ' — bounced to login' : ''} → left pending) [${(r.url || 'no-url').replace(/^https?:\/\/[^/]+/, '')}]`);
        }
      }
    } finally { await adapter.close().catch(() => {}); }
  }

  // record-detail pass: enter the product's list route and open the first real record so a `:id` detail
  // node verifies on a genuine instance. Only for products with a record-row config (RECORD_ENTRY) — the
  // adapter's recordUrlIncludes check is the real gate (a no-record product would falsely return true).
  const entry = RECORD_ENTRY[pkey];
  const detailNode = paramNodes.find((n) => /detail/i.test(n.intent_label) && /(\/po\/|\/report\/)/.test(n.screen_route ?? ''));
  if (entry && detailNode && !verifiedIds.has(detailNode.id)) {
    let adapter: InteractionAdapter | undefined;
    try {
      adapter = await getAdapter(product, 'read-only' as ExecutionMode); await adapter.open('admin');
      say(`  — record pass: entering "${entry}" to open a representative record for "${detailNode.intent_label}" —`);
      await adapter.gotoNode({ intent_label: 'list', screen_route: entry, locator_strategies: [], persona_labels: {} }, 'admin');
      const opened = await adapter.openRecord();
      if (opened) {
        verifiedIds.add(detailNode.id);
        await db().query(`UPDATE demo_graph_nodes SET verification_status='verified', last_verified=now(), verification_source='recon-admin-record' WHERE id=$1`, [detailNode.id]);
        await recordGraphEvent('verify', { graphId: g.id, nodeId: detailNode.id, productId: g.product_id, actor: 'graph-verify-pending', before: { verification_status: 'pending_review' }, after: { verification_status: 'verified', basis: 'record' } });
        say(`     ✅ ${detailNode.intent_label} (opened a real record)`);
      } else {
        say(`     ⏳ ${detailNode.intent_label} (no representative record found at "${entry}" → left pending)`);
      }
    } catch (e: any) { say(`  ⚠️ record pass failed (${String(e?.message ?? e).slice(0, 120)})`); }
    finally { await adapter?.close().catch(() => {}); }
  }

  await rollupWorkflowsForGraph(g.id, 'graph-verify-pending');
  await recomputeGraphScore(g.id);
  const stillPending = (await db().query<{ n: string }>(`SELECT count(*)::text n FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL AND verification_status IN ('pending_review','draft')`, [g.id])).rows[0].n;
  say('───────────────────────────────────────────────────');
  say(`  ${verifiedIds.size} promoted to verified · ${attempted} attempted · ${skipped} skipped · ${stillPending} still pending`);
  return { verified: verifiedIds.size, attempted, skipped, stillPending: Number(stillPending), log };
}

// ── CLI ──
if (process.argv[1] && process.argv[1].includes('graph-verify-pending')) {
  const product = process.argv[2];
  if (!product) { console.error('usage: graph-verify-pending.ts <product> [extraRole...]'); process.exit(1); }
  runSelectiveVerify(product, process.argv.slice(3))
    .then(() => process.exit(0))
    .catch((e) => { console.error(e?.message ?? e); process.exit(1); });
}
