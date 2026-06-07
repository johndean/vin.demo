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
interface Spec { table: string; workspaceScoped?: boolean; fields: Record<string, FieldType>; del: 'hard' | { col: string; val: string }; }

const SPECS: Record<string, Spec> = {
  // First entity (template). The presentation fields (scope/limits/brand/color/calls) live in the
  // definition jsonb, so they become real + editable here. More entities register below as we roll out.
  persona: { table: 'personas', workspaceScoped: true, fields: { name: 'text', definition: 'json' }, del: 'hard' },
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
      const r = await db().query(`INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING id`, vals);
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
      await db().query(`UPDATE ${spec.table} SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      return NextResponse.json({ ok: true, id: body.id });
    }
    if (op === 'delete') {
      if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      if (spec.del === 'hard') await db().query(`DELETE FROM ${spec.table} WHERE id = $1`, [body.id]);
      else await db().query(`UPDATE ${spec.table} SET ${spec.del.col} = $2 WHERE id = $1`, [body.id, spec.del.val]);
      return NextResponse.json({ ok: true, id: body.id });
    }
    return NextResponse.json({ error: `unknown op: ${op}` }, { status: 400 });
  } catch (e: any) {
    console.error('admin mutate failed:', e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
