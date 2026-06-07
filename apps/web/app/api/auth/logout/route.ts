import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/middleware';

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL('/login', req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
