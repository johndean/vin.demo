import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';
import { verifyToken, signToken } from '@/lib/session-token';

/**
 * Console-triggered eval runs — a thin RBAC PROXY to the engine's /evals endpoint (mirrors the /graph
 * proxy). The engine owns the work: it spawns the existing eval npm script in the repo it ships, which hits
 * the LLM/retrieval and records a real eval_runs row. This route only enforces the privileged role + mints a
 * short-lived signed token. A suite hits the model and can take minutes — hence the long maxDuration.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const ENGINE_URL = process.env.VIN_DEMO_ENGINE_URL || 'https://vin-demo-engine-production.up.railway.app';

export async function POST(req: Request) {
  const session = await verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'operator') return NextResponse.json({ error: 'insufficient role' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!body?.suite) return NextResponse.json({ error: 'suite required' }, { status: 400 });

  const token = await signToken({ email: session.email, role: session.role }, 300);
  try {
    const r = await fetch(`${ENGINE_URL}/evals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(290_000),
    });
    const json = await r.json().catch(() => ({}));
    return NextResponse.json(json, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ error: `engine unreachable: ${String(e?.message ?? e)}` }, { status: 502 });
  }
}
