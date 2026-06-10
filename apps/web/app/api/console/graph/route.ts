import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';
import { verifyToken, signToken } from '@/lib/session-token';

/**
 * In-console demo-graph actions (Phase E) — a thin RBAC PROXY to the engine's /graph endpoint, mirroring
 * the /knowledge proxy. The engine owns the work (it holds the DB + the LLM + Playwright, which autogen and
 * verify drive); this route only (1) enforces the privileged console role and (2) mints a short-lived
 * signed token the engine accepts. We never run Playwright/LLM from the web app — that keeps the Next
 * standalone build decoupled from src/core, same posture as the knowledge + voice token routes.
 *   actions: autogen (derive a DRAFT graph from validated knowledge) · verify (recon-validate the active
 *   graph → drift) · publish (promote a draft) · archive (soft-archive, never delete).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // autogen/verify drive the LLM + a real browser — allow a long request
const ENGINE_URL = process.env.VIN_DEMO_ENGINE_URL || 'https://vin-demo-engine-production.up.railway.app';

export async function POST(req: Request) {
  const session = await verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'operator') return NextResponse.json({ error: 'insufficient role' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!['autogen', 'verify', 'publish', 'archive', 'workflow.create', 'workflow.update', 'workflow.approve', 'workflow.archive', 'node.create', 'node.update', 'node.archive', 'rollback', 'tour.link'].includes(body?.action)) return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const token = await signToken({ email: session.email, role: session.role }, 300);
  try {
    const r = await fetch(`${ENGINE_URL}/graph`, {
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
