import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';
import { verifyToken, signToken } from '@/lib/session-token';

/**
 * In-console knowledge mutations (Phase C) — a thin RBAC PROXY to the engine's /knowledge endpoint.
 * The engine owns the work (it holds the DB + Voyage embedding + the lifecycle/audit logic); this route
 * only (1) enforces the privileged console role and (2) mints a short-lived signed token so the engine
 * (same SESSION_SECRET) accepts the call. We never embed or write knowledge from the web app — that keeps
 * the Voyage key engine-only and the Next standalone build decoupled from src/core (same posture as the
 * voice-token route + the web/engine session-token split).
 */
export const dynamic = 'force-dynamic';
const ENGINE_URL = process.env.VIN_DEMO_ENGINE_URL || 'https://vin-demo-engine-production.up.railway.app';

export async function POST(req: Request) {
  const session = await verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'operator') return NextResponse.json({ error: 'insufficient role' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!['add', 'edit', 'validate', 'archive'].includes(body?.action)) return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const token = await signToken({ email: session.email, role: session.role }, 120);
  try {
    const r = await fetch(`${ENGINE_URL}/knowledge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    return NextResponse.json(json, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ error: `engine unreachable: ${String(e?.message ?? e)}` }, { status: 502 });
  }
}
