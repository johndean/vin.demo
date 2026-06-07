import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/middleware';
import { validateCredentials } from '@/lib/auth';

/**
 * Sign-in: validates against the seeded operator accounts (lib/auth → env). On success
 * we store the email in an httpOnly session cookie; on failure we 401 so the form can
 * show an inline error.
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

  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set(SESSION_COOKIE, user.email, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: remember ? 60 * 60 * 24 * 7 : undefined,
  });
  return res;
}
