import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';
import { getConsoleData } from '@/lib/console-data';

// The SSOT data API — same real console data the web renders, served as JSON for other
// clients (the desktop control room). Self-gated (the matcher excludes /api/), so check
// the session cookie here.
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!cookies().get(SESSION_COOKIE)?.value) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const data = await getConsoleData();
    return NextResponse.json(data);
  } catch (e) {
    console.error('console data API failed:', e);
    return NextResponse.json({ error: 'data unavailable' }, { status: 500 });
  }
}
