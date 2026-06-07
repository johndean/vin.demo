import type { Metadata } from 'next';

// Per-route title matching the design ("demo.vin - Login.html" <title>).
export const metadata: Metadata = { title: 'Demo Hub · demo.vin — Sign in' };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
