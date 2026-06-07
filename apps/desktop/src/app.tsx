/* Desktop app shell: gate the control room behind the login (same design as the web). */
import { useState } from 'react';
import { Login } from './login';
import ControlRoom from './runtime';

export default function App() {
  const [authed, setAuthed] = useState(false);
  return authed ? <ControlRoom /> : <Login onDone={() => setAuthed(true)} />;
}
