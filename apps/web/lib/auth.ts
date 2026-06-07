/**
 * Seeded credential validation for the gated console. Users come from env so secrets
 * never live in source/git: ADMIN_EMAIL + ADMIN_PASSWORD seed the primary admin, and
 * SEED_USERS (a JSON array) can add more. Fails closed when nothing is configured.
 * Swap for a real IdP when one exists.
 */
export interface SeedUser {
  email: string;
  password: string;
  role: string;
  name?: string;
}

function seedUsers(): SeedUser[] {
  const users: SeedUser[] = [];
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    users.push({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, role: 'admin', name: 'Admin' });
  }
  if (process.env.SEED_USERS) {
    try {
      const extra = JSON.parse(process.env.SEED_USERS);
      if (Array.isArray(extra)) for (const u of extra) if (u?.email && u?.password) users.push({ role: 'operator', ...u });
    } catch { /* ignore malformed SEED_USERS */ }
  }
  return users;
}

export function validateCredentials(email: string, password: string): SeedUser | null {
  const e = (email || '').trim().toLowerCase();
  if (!e || !password) return null;
  return seedUsers().find((u) => u.email.toLowerCase() === e && u.password === password) ?? null;
}
