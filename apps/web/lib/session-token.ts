/**
 * Stateless, signed session token (HMAC-SHA256) — replaces the old plain-email cookie whose
 * value was trivially forgeable (middleware only checked presence). The token is
 * `base64url(payload).base64url(sig)` where payload = { email, role, exp }. The SAME
 * SESSION_SECRET is set on the web AND the hosted engine, so the engine can verify a token the
 * web issued without any shared DB lookup — that is what gates the hosted /session/stream.
 *
 * Implemented with the Web Crypto API (crypto.subtle), NOT node:crypto, on purpose: Next.js
 * middleware runs on the Edge runtime where node:crypto is unavailable. Web Crypto is present in
 * Edge, Node 20, and tsx, so this one file works everywhere. No external dependency.
 *
 * NOTE: this file is intentionally duplicated at apps/engine/src/session-token.ts — the two
 * services build in independent contexts, so they each carry their own copy rather than coupling
 * the Next standalone build to the repo-root src/. Keep the two copies in sync.
 */
export interface SessionPayload {
  email: string;
  role: string;
  exp: number; // epoch seconds
}

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set — required to sign/verify session tokens.');
  return s;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export async function signToken(user: { email: string; role: string }, ttlSeconds: number): Promise<string> {
  const payload: SessionPayload = { email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(payloadB64));
  return `${payloadB64}.${b64url(sig)}`;
}

export async function verifyToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(), unb64url(sigB64), enc.encode(payloadB64));
  } catch {
    return null; // malformed signature segment
  }
  if (!ok) return null; // crypto.subtle.verify compares in constant time
  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64url(payloadB64)));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp * 1000 < Date.now()) return null; // expired
  return payload;
}
