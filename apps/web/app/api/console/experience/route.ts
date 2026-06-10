import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';
import { verifyToken, signToken } from '@/lib/session-token';

/**
 * In-console EXPERIENCE registry actions (V5 Guided Experience Platform, Phase 1) — a thin RBAC PROXY to the
 * engine's /experience endpoint, mirroring the /graph + /knowledge proxies. The engine owns the work (it holds
 * the DB); this route only (1) enforces the privileged console role and (2) mints a short-lived signed token
 * the engine accepts. Pure-DB writes — Business Outcome Registry + Stakeholder Registry + influence graph —
 * with no LLM/Playwright, so they're fast (unlike autogen/verify on /graph).
 */
export const dynamic = 'force-dynamic';
const ENGINE_URL = process.env.VIN_DEMO_ENGINE_URL || 'https://vin-demo-engine-production.up.railway.app';
const ACTIONS = [
  'outcome.create', 'outcome.update', 'outcome.archive', 'outcome.link',
  'stakeholder.create', 'stakeholder.update', 'stakeholder.archive',
  'relationship.create', 'relationship.archive',
  'journey.create', 'journey.update', 'journey.status', 'journey.archive',
  'orgPerson.create', 'orgPerson.update', 'orgPerson.archive',
  'journey.assemble', 'gap.resolve', 'gap.dismiss',
];

export async function POST(req: Request) {
  const session = await verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'operator') return NextResponse.json({ error: 'insufficient role' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!ACTIONS.includes(body?.action)) return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const token = await signToken({ email: session.email, role: session.role }, 300);
  try {
    const r = await fetch(`${ENGINE_URL}/experience`, {
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
