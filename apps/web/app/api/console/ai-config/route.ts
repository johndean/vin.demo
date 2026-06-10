import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';
import { verifyToken, signToken } from '@/lib/session-token';

/**
 * AI Control — a thin RBAC PROXY to the engine's /ai-config endpoint (mirrors the /experience + /graph proxies).
 * The engine owns the work (the prompt registry + model setting + their live caches live with the LLM); this
 * route only (1) enforces the privileged console role and (2) mints a short-lived signed token the engine
 * accepts. GET returns the editor catalog (default + override per prompt, current model + options); POST saves
 * a prompt override, resets one, or switches the model — each applies LIVE on the engine's next turn.
 */
export const dynamic = 'force-dynamic';
const ENGINE_URL = process.env.VIN_DEMO_ENGINE_URL || 'https://vin-demo-engine-production.up.railway.app';
const ACTIONS = ['prompt.save', 'prompt.reset', 'model.set', 'model.reset'];

export async function GET() {
  const session = await verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'operator') return NextResponse.json({ error: 'insufficient role' }, { status: 403 });

  const token = await signToken({ email: session.email, role: session.role }, 300);
  try {
    const r = await fetch(`${ENGINE_URL}/ai-config`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
    const json = await r.json().catch(() => ({}));
    return NextResponse.json(json, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ error: `engine unreachable: ${String(e?.message ?? e)}` }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const session = await verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'operator') return NextResponse.json({ error: 'insufficient role' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!ACTIONS.includes(body?.action)) return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const token = await signToken({ email: session.email, role: session.role }, 300);
  try {
    const r = await fetch(`${ENGINE_URL}/ai-config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await r.json().catch(() => ({}));
    return NextResponse.json(json, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ error: `engine unreachable: ${String(e?.message ?? e)}` }, { status: 502 });
  }
}
