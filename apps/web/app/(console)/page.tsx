import ConsoleApp from './_console/App';

// Gated by middleware.ts (session cookie → /login). Renders the full operator console.
export default function ConsoleHome() {
  return <ConsoleApp />;
}
