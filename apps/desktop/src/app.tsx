/* Desktop app shell: gate the control room behind the login (same design as the web),
   then fetch the REAL console data from the web SSOT (thin client) and provide it. */
import { useState, useEffect } from 'react';
import { Login } from './login';
import ControlRoom from './runtime';
import { RealDataProvider, type RealData } from './real-data';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<RealData | null>(null);

  useEffect(() => {
    if (!authed) return;
    const api = (window as unknown as { consoleData?: { fetch(): Promise<{ ok: boolean; data?: RealData }> } }).consoleData;
    if (!api) return;
    api.fetch().then((r) => { if (r?.ok && r.data) setData(r.data); }).catch(() => {});
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
