import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/middleware';

// Placeholder for the gated operator console — the full 12-view console (Dashboard,
// Products, Knowledge, Demo Graphs, Environments, Personas, Departments, Sessions,
// Safety & Modes, Evals, Costs, Settings) is ported in the next step. This confirms
// the login → gated-console flow works end to end.
export default function ConsoleHome() {
  const email = cookies().get(SESSION_COOKIE)?.value ?? 'operator';
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 520 }}>
        <p className="overline">VIN Demo · Operator Console</p>
        <h1 style={{ marginTop: 8 }}>Demo operations</h1>
        <p style={{ color: 'var(--fg2)', marginTop: 12 }}>
          Signed in as <b style={{ color: 'var(--fg1)' }}>{email}</b>. The full console is being ported next —
          login gating and the design system are live.
        </p>
        <form action="/api/auth/logout" method="post" style={{ marginTop: 20 }}>
          <button
            type="submit"
            style={{ height: 40, padding: '0 18px', border: 'none', borderRadius: 9, background: 'var(--color-navy)', color: '#fff', fontFamily: 'inherit', fontWeight: 800, cursor: 'pointer' }}
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
