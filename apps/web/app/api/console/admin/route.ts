import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';
import { verifyToken } from '@/lib/session-token';
import { db } from '@/lib/db';

// Table-driven admin CRUD for the console. ONE endpoint serves create/update/delete for every
// registered entity: table + column names come from this server-side allowlist (never the request),
// values are parametrized — so it's injection-safe while we roll the same pattern across all entities.
// Writes require the admin role. Delete is per-entity: 'hard' (config rows) or soft (audit-trail rows).
export const dynamic = 'force-dynamic';

type FieldType = 'text' | 'json' | 'int' | 'bool';
interface Spec { table: string; workspaceScoped?: boolean; fields: Record<string, FieldType>; archivable: boolean; pk?: string; }

const SPECS: Record<string, Spec> = {
  // Config + records all SOFT-archive (archived_at/by) — no hard deletes, auditability preserved.
  persona: { table: 'personas', workspaceScoped: true, fields: { name: 'text', status: 'text', owner: 'text', approver: 'text', definition: 'json' }, archivable: true },
  // Environment belongs to a product (form supplies product_id).
  environment: { table: 'environments', fields: { product_id: 'text', name: 'text', connection_target: 'text', reset_mechanism: 'text', refresh_cadence: 'text', seed_dataset: 'json', is_production: 'bool', default_mode: 'text', certification_status: 'text', verification_state: 'text', seed_version: 'text', data_version: 'text', readiness_state: 'text', known_issues: 'json' }, archivable: true },
  // Customer (account) — workspace-scoped; metadata holds seg/stage/next/color.
  customer: { table: 'customers', workspaceScoped: true, fields: { name: 'text', metadata: 'json' }, archivable: true },
  // Scripted demo-room member — belongs to a product (form supplies product_id). Defines the named people
  // the reel/convo address; live interactive/voice sessions seed no room (see stakeholders.ts).
  product_stakeholder: { table: 'product_stakeholders', fields: { product_id: 'text', name: 'text', role: 'text', interests: 'json', influence: 'text', risk_level: 'text', decision_authority: 'text', sort_order: 'int' }, archivable: true },
  // Product (basic create/edit — a thin slice of self-service onboarding; KB/versions/env/graph stay
  // CLI/engine-onboarded). metadata holds presentation (tagline/mk/color). status = lifecycle stage.
  product: { table: 'products', workspaceScoped: true, fields: { name: 'text', status: 'text', metadata: 'json' }, archivable: true },
  // Plan a demo session (pre-staged). FK columns supplied by the form (resolved client-side from the picked
  // product/customer). status='planned' is honest — the demo hasn't run; the Control Room flips it live.
  demo_session: { table: 'demo_sessions', fields: { customer_id: 'text', product_version_id: 'text', environment_id: 'text', persona_id: 'text', execution_mode: 'text', status: 'text' }, archivable: true },
  // Session discovery (1:1 with a session, PK = demo_session_id) — captures the planned business objective.
  session_discovery: { table: 'session_discovery', pk: 'demo_session_id', fields: { demo_session_id: 'text', business_objective: 'text' }, archivable: false },
  // Guided demo TOUR (record-and-replay) — belongs to a product. `steps` is the recorded action list (jsonb).
  demo_tour: { table: 'demo_tours', fields: { product_id: 'text', name: 'text', description: 'text', steps: 'json' }, archivable: true },
};

function coerce(t: FieldType, v: any) {
  if (t === 'json') return JSON.stringify(v ?? {});
  if (t === 'int') return v === '' || v == null ? null : Number(v);
  if (t === 'bool') return !!v;
  return v == null ? null : String(v);
}

export async function POST(req: Request) {
  const session = await verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Privileged console roles. Single-tenant: admin + operator both manage; unauthenticated is rejected.
  if (session.role !== 'admin' && session.role !== 'operator') return NextResponse.json({ error: 'insufficient role' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const spec = SPECS[body?.entity];
  if (!spec) return NextResponse.json({ error: `unknown entity: ${body?.entity}` }, { status: 400 });
  const op = body?.op;
  const data = body?.data ?? {};

  try {
    if (op === 'create') {
      const cols: string[] = []; const vals: any[] = []; const ph: string[] = [];
      if (spec.workspaceScoped) {
        const ws = (await db().query<{ id: string }>('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')).rows[0];
        if (!ws) return NextResponse.json({ error: 'no workspace' }, { status: 500 });
        cols.push('workspace_id'); vals.push(ws.id); ph.push(`$${vals.length}`);
      }
      for (const [f, t] of Object.entries(spec.fields)) {
        if (data[f] === undefined) continue;
        vals.push(coerce(t, data[f])); cols.push(f); ph.push(`$${vals.length}${t === 'json' ? '::jsonb' : ''}`);
      }
      if (!cols.length) return NextResponse.json({ error: 'no fields to insert' }, { status: 400 });
      const pk = spec.pk ?? 'id';
      const r = await db().query(`INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING ${pk} AS id`, vals);
      return NextResponse.json({ ok: true, id: r.rows[0]?.id });
    }
    if (op === 'update') {
      if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const sets: string[] = []; const vals: any[] = [];
      for (const [f, t] of Object.entries(spec.fields)) {
        if (data[f] === undefined) continue;
        vals.push(coerce(t, data[f])); sets.push(`${f} = $${vals.length}${t === 'json' ? '::jsonb' : ''}`);
      }
      if (!sets.length) return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
      vals.push(body.id);
      await db().query(`UPDATE ${spec.table} SET ${sets.join(', ')} WHERE ${spec.pk ?? 'id'} = $${vals.length}`, vals);
      return NextResponse.json({ ok: true, id: body.id });
    }
    if (op === 'archive' || op === 'unarchive') {
      if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      if (!spec.archivable) return NextResponse.json({ error: 'entity is not archivable' }, { status: 400 });
      if (op === 'archive') await db().query(`UPDATE ${spec.table} SET archived_at = now(), archived_by = $2 WHERE id = $1`, [body.id, session.email]);
      else await db().query(`UPDATE ${spec.table} SET archived_at = NULL, archived_by = NULL WHERE id = $1`, [body.id]);
      return NextResponse.json({ ok: true, id: body.id });
    }
    return NextResponse.json({ error: `unknown op: ${op}` }, { status: 400 });
  } catch (e: any) {
    console.error('admin mutate failed:', e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
