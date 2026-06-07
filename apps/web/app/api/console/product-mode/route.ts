import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';
import { verifyToken } from '@/lib/session-token';
import { db } from '@/lib/db';

// Set a product's per-site DEFAULT execution mode (environments.default_mode). The desktop Control
// Room initializes its picker from this; the operator can still override per session. Self-gated
// (the /api/ matcher is excluded from middleware), so verify the signed session token here.
export const dynamic = 'force-dynamic';
const MODES = ['read-only', 'safe', 'approval', 'execution'];

export async function POST(req: Request) {
  const session = await verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const productId = typeof body?.productId === 'string' ? body.productId : '';
  const mode = MODES.includes(body?.mode) ? body.mode : '';
  if (!productId || !mode) return NextResponse.json({ error: 'productId and a valid mode are required' }, { status: 400 });
  try {
    const r = await db().query('UPDATE environments SET default_mode = $2 WHERE product_id = $1', [productId, mode]);
    return NextResponse.json({ ok: true, updated: r.rowCount, mode });
  } catch (e) {
    console.error('product-mode update failed:', e);
    return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }
}
