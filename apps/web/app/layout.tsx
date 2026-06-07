import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'VIN Demo',
  description: 'VIN Demo — Autonomous AI Solution Consultant. Operator console.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
