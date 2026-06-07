'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('Sign in');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setLabel('Signing in…');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, remember }),
      });
      if (res.ok) {
        setLabel('Signed in ✓');
        router.replace('/');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Sign in failed. Please try again.');
        setBusy(false);
        setLabel('Sign in');
      }
    } catch {
      setError('Network error. Please try again.');
      setBusy(false);
      setLabel('Sign in');
    }
  }

  return (
    <div className={styles.root}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <div className={styles.topline}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.logo} src="/assets/VIN.svg" alt="VIN" />
          <span className={styles.demoChip}>Demo</span>
        </div>

        <div className={styles.titleRow}>
          <h1 className={styles.title}>Demo Hub</h1>
          <span className={styles.pill}>V2 · Flowint SSOT</span>
        </div>
        <p className={styles.subtitle}>Reconciled with Flowint SSOT · 7-stage workflow · audit-traceable mutations</p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input type="password" id="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <div className={styles.row}>
            <label className={styles.remember}>
              <input type="checkbox" id="remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className={styles.box}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              Keep me signed in
            </label>
            <a className={styles.forgot} href="#">Forgot password?</a>
          </div>

          <button className={styles.signin} type="submit" disabled={busy}>{label}</button>

          {error && <div className={styles.error} role="alert">{error}</div>}

          <div className={styles.note}><b>Operator sign-in.</b> Sign in with your VIN Demo operator credentials. Roles (Employee, Manager, Accounting, Admin) can be switched from the top-right once inside.</div>
        </div>
      </form>

      <div className={styles.footer}>
        <span className={styles.footerDemo}>VIN Demo</span> · © 2026 Veterinary Information Network · <a href="#">Privacy</a> · <a href="#">Support</a>
      </div>
    </div>
  );
}
