import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/middleware';
import { validateCredentials } from '@/lib/auth';
import { signToken } from '@/lib/session-token';

const TOKEN_TTL = 60 * 60 * 24 * 7; // 7 days — the signed token's hard expiry

/**
 * Sign-in: validates against the seeded operator accounts (lib/auth → env). On success we store a
 * SIGNED (HMAC) session token in an httpOnly cookie — not the bare email — so the value can't be
 * forged. The same token gates the web console (middleware) AND the hosted engine's /session/stream
 * (it verifies with the shared SESSION_SECRET). On failure we 401 so the form can show an inline error.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const remember = body.remember !== false;

  const user = validateCredentials(email, password);
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Incorrect email or password.' }, { status: 401 });
  }

  const token = await signToken({ email: user.email, role: user.role }, TOKEN_TTL);
  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: remember ? TOKEN_TTL : undefined,
  });
  return res;
}
