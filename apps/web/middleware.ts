import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const SESSION_COOKIE = 'vin_demo_session';

/**
 * Gate the whole console behind login. Unauthenticated → /login; an authenticated
 * user landing on /login is bounced to the console. /api/auth/* and static assets
 * are excluded via the matcher below.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith('/login')) {
    if (authed) return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  }
  if (!authed) {
    const url = new URL('/login', req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Run on everything except API auth routes, Next internals, and static design assets.
  matcher: ['/((?!api/|_next/static|_next/image|fonts/|assets/|favicon.ico).*)'],
};
