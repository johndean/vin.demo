/* Desktop app shell: gate the control room behind the login (same design as the web),
   then fetch the REAL console data from the web SSOT (thin client) and provide it. */
import { useState, useEffect } from 'react';
import { Login } from './login';
import ControlRoom from './runtime';
import { RealDataProvider, type RealData } from './real-data';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<RealData | null>(null);

  // Keep the control room in sync with the web SSOT: load on auth, on window focus, and on a light
  // interval — so changes made in the web console (archived persona, per-site mode, edited roster)
  // propagate to the desktop within ~45s instead of being stale until the app is relaunched.
  useEffect(() => {
    if (!authed) return;
    const api = (window as unknown as { consoleData?: { fetch(): Promise<{ ok: boolean; data?: RealData }> } }).consoleData;
    if (!api) return;
    let alive = true;
    const load = () => api.fetch().then((r) => { if (alive && r?.ok && r.data) setData(r.data); }).catch(() => {});
    load();
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    const iv = setInterval(load, 45000);
    return () => { alive = false; window.removeEventListener('focus', onFocus); clearInterval(iv); };
  }, [authed]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const onLogout = async () => {
    const api = (window as unknown as { auth?: { logout(): Promise<unknown> } }).auth;
    try { await api?.logout?.(); } catch { /* */ }
    setData(null);
    setAuthed(false); // back to the Login screen
  };

  return (
    <RealDataProvider value={data}>
      <ControlRoom onLogout={onLogout} />
    </RealDataProvider>
  );
}
