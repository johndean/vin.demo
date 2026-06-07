import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';
import { verifyToken, signToken } from '@/lib/session-token';

/**
 * Mint a short-lived token for the browser's direct connection to the hosted engine
 * (EventSource / fetch can't attach the httpOnly cross-origin session cookie). We verify the real
 * session cookie server-side, then issue a fresh 1-hour signed token the browser can put on the
 * engine URL. Same SESSION_SECRET, so the engine accepts it. Also returns the engine base URL.
 */
export const dynamic = 'force-dynamic';

const ENGINE_URL = process.env.VIN_DEMO_ENGINE_URL || 'https://vin-demo-engine-production.up.railway.app';

export async function GET() {
  const payload = await verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!payload) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const token = await signToken({ email: payload.email, role: payload.role }, 60 * 60);
  return NextResponse.json({ token, engineUrl: ENGINE_URL });
}
