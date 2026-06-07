/* Desktop login — SAME design as the web login (app/login on demofor.vin). Gates the
   control room. Local demo gate: any email + password continues (per the design's note);
   a deployed/thin-client build would authenticate against the hosted engine instead. */
import { useState } from 'react';

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('Sign in');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    setError('');
    setLabel('Signing in…');
    // Validate against the SAME source of truth as the web console (via the main process).
    const auth = (window as unknown as { auth?: { login(e: string, p: string): Promise<{ ok: boolean; error?: string }> } }).auth;
    try {
      const res = auth ? await auth.login(email, password) : { ok: false, error: 'Auth bridge unavailable' };
      if (res.ok) { setLabel('Signed in ✓'); onDone(); }
      else { setError(res.error ? 'Could not reach the sign-in service.' : 'Incorrect email or password.'); setBusy(false); setLabel('Sign in'); }
    } catch {
      setError('Could not reach the sign-in service.');
      setBusy(false);
      setLabel('Sign in');
    }
  }

  return (
    <div className="vinlogin">
      <form className="card" onSubmit={onSubmit} noValidate>
        <div className="topline">
          <img className="logo" src="./assets/VIN.svg" alt="VIN" />
          <span className="demo-chip">Demo</span>
        </div>

        <div className="title-row">
          <h1 className="title">Demo Hub</h1>
          <span className="pill">V2</span>
        </div>
        <p className="subtitle">7-stage workflow · audit-traceable mutations</p>

        <div className="fields">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input type="password" id="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <div className="row">
            <label className="remember">
              <input type="checkbox" id="remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
              Keep me signed in
            </label>
            <a className="forgot" href="#" onClick={(e) => e.preventDefault()}>Forgot password?</a>
          </div>

          <button className="signin" type="submit" disabled={busy}>{label}</button>

          {error && <div className="error" role="alert">{error}</div>}

          <div className="note"><b>Operator sign-in.</b> Sign in with your VIN Demo operator credentials. Roles (Employee, Manager, Accounting, Admin) can be switched from the top-right once inside.</div>
        </div>
      </form>

      <div className="footer"><span className="demo">VIN Demo</span> · © 2026 Veterinary Information Network · <a href="#" onClick={(e) => e.preventDefault()}>Privacy</a> · <a href="#" onClick={(e) => e.preventDefault()}>Support</a></div>
    </div>
  );
}
