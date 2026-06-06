/**
 * Product Lifecycle engine (Gap B, P3.2). Versions carry a real status
 * (active | deprecated | retired); bumping to a new version supersedes the prior one.
 * Knowledge tied to a non-active version DEGRADES at the trust gate (retrieval.ts:
 * versionStale) — "let me show you the current version" — so product drift surfaces
 * instead of confidently demoing obsolete functionality.
 */
import { db } from './db.js';

export type VersionStatus = 'active' | 'deprecated' | 'retired';
export interface ProductVersion { id: string; version_label: string; status: VersionStatus }

export async function listVersions(productId: string): Promise<ProductVersion[]> {
  const { rows } = await db().query<ProductVersion>(
    `SELECT id, version_label, status FROM product_versions WHERE product_id = $1 ORDER BY created_at`,
    [productId],
  );
  return rows;
}

/** Bump to a new active version: prior active version(s) → deprecated, insert the new active one. */
export async function bumpVersion(productId: string, newLabel: string): Promise<string> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE product_versions SET status = 'deprecated' WHERE product_id = $1 AND status = 'active'`, [productId]);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO product_versions (product_id, version_label, status) VALUES ($1, $2, 'active')
       ON CONFLICT (product_id, version_label) DO UPDATE SET status = 'active' RETURNING id`,
      [productId, newLabel],
    );
    await client.query('COMMIT');
    return rows[0].id;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function setVersionStatus(versionId: string, status: VersionStatus): Promise<void> {
  await db().query('UPDATE product_versions SET status = $2 WHERE id = $1', [versionId, status]);
}
