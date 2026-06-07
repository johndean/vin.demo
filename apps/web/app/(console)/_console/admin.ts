/* Client helper for the table-driven admin CRUD endpoint. Throws on failure with the server's
   message so forms can surface it. Callers refresh the server data (router.refresh()) after a write. */
export async function adminMutate(entity: string, op: 'create' | 'update' | 'delete', payload: { id?: string; data?: any }) {
  const res = await fetch('/api/console/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entity, op, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}
