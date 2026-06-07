import { cookies } from 'next/headers';
import ConsoleApp from './_console/App';
import { EMPTY_VD } from './_console/data';
import { getConsoleData } from '@/lib/console-data';
import { SESSION_COOKIE } from '@/middleware';

// Gated by middleware.ts. Always fetch fresh real data from Postgres (the SSOT).
export const dynamic = 'force-dynamic';

export default async function ConsoleHome() {
  let data = EMPTY_VD;
  try {
    data = await getConsoleData();
  } catch (e) {
    console.error('console data load failed; rendering empty states:', e);
  }
  const operator = cookies().get(SESSION_COOKIE)?.value;
  return <ConsoleApp data={data} operator={operator} />;
}
