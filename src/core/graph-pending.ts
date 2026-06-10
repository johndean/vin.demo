/**
 * Read-only diagnostic: for a product's ACTIVE graph, report node verification status and bucket every
 * pending_review node by WHY it can/can't be promoted to 'verified' (ready). Recon-verify (graph-verify)
 * promotes a node only when its route/selector resolves on the REAL DOM in a live session, and marks
 * non-resolving nodes 'broken' — so it can only safely auto-promote CONCRETE, role-reachable routes. This
 * names, per node, the trigger or data still needed. Mutates nothing.
 * Run: railway run npx tsx src/core/graph-pending.ts "<product>"
 */
import 'dotenv/config';
import { db } from './db.js';

type Bucket = 'concrete' | 'role-dispatched' | 'parameterized' | 'non-route';
function bucket(route: string | null): Bucket {
  const r = (route ?? '').trim();
  if (!r || r.toLowerCase() === 'global overlay') return 'non-route';
  if (r.includes(':') || r.includes('*')) return 'parameterized';
  if (r === '/' || r === '/dashboard') return 'role-dispatched';
  return 'concrete';
}
const TRIGGER: Record<Bucket, string> = {
  concrete: 'RECON-VERIFIABLE NOW → run graph:verify under a role in permissions_required (admin reaches most). NEEDS: a live recon login session for the product (creds in .env).',
  'role-dispatched': 'Route is role-multiplexed (one URL renders a different screen per role). NEEDS: per-role recon — one adapter session per role so each variant verifies under the role that sees it.',
  parameterized: 'Route needs a concrete record id. NEEDS: a representative instance in the demo env (a real PO / asset / inventory / report id) to navigate to; template URLs cannot be resolved.',
  'non-route': 'Not an independently navigable URL (global overlay / catch-all 404). NEEDS: verify via its host surface, or mark N/A — there is no standalone DOM route to recon.',
};

async function report(product: string): Promise<void> {
  const g = (await db().query<{ id: string; name: string }>(`
    SELECT g.id, g.name FROM demo_graphs g JOIN products p ON p.id=g.product_id
     WHERE lower(p.name)=lower($1) AND g.status='active' AND g.archived_at IS NULL ORDER BY g.graph_version DESC LIMIT 1`, [product])).rows[0];
  if (!g) { console.log(`\n${product}: no active graph`); return; }
  const nodes = (await db().query<{ intent_label: string; screen_route: string | null; verification_status: string; permissions_required: any }>(`
    SELECT intent_label, screen_route, verification_status, permissions_required
      FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL ORDER BY intent_label`, [g.id])).rows;
  const by = (s: string) => nodes.filter((n) => n.verification_status === s).length;
  console.log(`\n══ ${product} — active graph "${g.name}" (${nodes.length} nodes) ══`);
  console.log(`   verified=${by('verified')} · pending_review=${by('pending_review')} · draft=${by('draft')} · broken=${by('broken')}`);

  const pending = nodes.filter((n) => n.verification_status === 'pending_review');
  const groups: Record<Bucket, typeof pending> = { concrete: [], 'role-dispatched': [], parameterized: [], 'non-route': [] };
  for (const n of pending) groups[bucket(n.screen_route)].push(n);
  for (const b of ['concrete', 'role-dispatched', 'parameterized', 'non-route'] as Bucket[]) {
    const list = groups[b];
    if (!list.length) continue;
    console.log(`\n  [${b}] ${list.length} pending — ${TRIGGER[b]}`);
    for (const n of list) {
      const roles = Array.isArray(n.permissions_required) ? n.permissions_required.join('/') : '';
      console.log(`     · ${n.intent_label}  (${n.screen_route ?? 'no route'})${roles ? `  roles=${roles}` : ''}`);
    }
  }
}

for (const p of process.argv.slice(2)) await report(p);
if (process.argv.length <= 2) { console.error('usage: graph-pending.ts <product> [product...]'); process.exit(1); }
process.exit(0);
