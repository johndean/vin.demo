/**
 * Org Chart (migration 0024) — the REAL organization: real people + reporting lines, imported from a BambooHR
 * export. DISTINCT from product_stakeholders (the per-product, role-based buying committee). The export has
 * names + reporting structure but NO job titles, so `job_title` (the ROLE) is operator-assigned in the console
 * editor — never fabricated here. Pure DB (no LLM/browser); soft-archive (0009 posture). The reporting tree is
 * self-referential by source ids (supervisor_source_id → source_person_id) within one organization.
 */
import { db } from './db.js';

export interface OrgPerson {
  id: string; organizationId: string | null; sourcePersonId: string | null; name: string;
  supervisorSourceId: string | null; jobTitle: string | null; department: string | null;
  location: string | null; photoUrl: string | null; sortOrder: number;
}
export interface OrgPersonInput {
  name?: string; jobTitle?: string | null; department?: string | null; supervisorSourceId?: string | null;
  location?: string | null; photoUrl?: string | null; sourcePersonId?: string | null;
  sortOrder?: number | null; organizationId?: string | null;
}
interface Row {
  id: string; organization_id: string | null; source_person_id: string | null; name: string;
  supervisor_source_id: string | null; job_title: string | null; department: string | null;
  location: string | null; photo_url: string | null; sort_order: number;
}
const toPerson = (r: Row): OrgPerson => ({
  id: r.id, organizationId: r.organization_id, sourcePersonId: r.source_person_id, name: r.name,
  supervisorSourceId: r.supervisor_source_id, jobTitle: r.job_title, department: r.department,
  location: r.location, photoUrl: r.photo_url, sortOrder: r.sort_order ?? 0,
});

const SELECT = `SELECT id, organization_id, source_person_id, name, supervisor_source_id, job_title, department, location, photo_url, sort_order FROM org_people`;

/** All non-archived org people (optionally scoped to one organization), ordered by name. */
export async function getOrgPeople(organizationId?: string | null): Promise<OrgPerson[]> {
  const { rows } = organizationId
    ? await db().query<Row>(`${SELECT} WHERE organization_id = $1 AND archived_at IS NULL ORDER BY sort_order, name`, [organizationId])
    : await db().query<Row>(`${SELECT} WHERE archived_at IS NULL ORDER BY sort_order, name`);
  return rows.map(toPerson);
}

export async function createOrgPerson(input: OrgPersonInput, actor = 'system'): Promise<{ orgPersonId: string }> {
  if (!input?.name?.trim()) throw new Error('person name required');
  const id = (await db().query<{ id: string }>(
    `INSERT INTO org_people (organization_id, source_person_id, name, supervisor_source_id, job_title, department, location, photo_url, sort_order, created_by, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,now()) RETURNING id`,
    [input.organizationId ?? null, input.sourcePersonId ?? null, input.name.trim(), input.supervisorSourceId ?? null,
     input.jobTitle ?? null, input.department ?? null, input.location ?? null, input.photoUrl ?? null, input.sortOrder ?? 0, actor],
  )).rows[0].id;
  return { orgPersonId: id };
}

/** Edit a person (COALESCE keeps any omitted field). The editor uses this to ASSIGN job_title (role) + department + supervisor. */
export async function updateOrgPerson(id: string, input: OrgPersonInput, actor = 'system'): Promise<void> {
  const before = (await db().query<{ id: string }>(`SELECT id FROM org_people WHERE id = $1`, [id])).rows[0];
  if (!before) throw new Error('person not found');
  if (input.name != null && !input.name.trim()) throw new Error('name cannot be blank');
  await db().query(
    `UPDATE org_people SET
       name = COALESCE($2, name), job_title = COALESCE($3, job_title), department = COALESCE($4, department),
       supervisor_source_id = COALESCE($5, supervisor_source_id), location = COALESCE($6, location),
       sort_order = COALESCE($7, sort_order), updated_by = $8, updated_at = now()
     WHERE id = $1`,
    [id, input.name?.trim() ?? null, input.jobTitle ?? null, input.department ?? null,
     input.supervisorSourceId ?? null, input.location ?? null, input.sortOrder ?? null, actor],
  );
}

export async function archiveOrgPerson(id: string, actor = 'system'): Promise<void> {
  await db().query(`UPDATE org_people SET archived_at = now(), archived_by = $2 WHERE id = $1`, [id, actor]);
}

/** Idempotent import upsert keyed on (organization, source_person_id). Imports name + reporting link + photo;
 *  NEVER overwrites an operator-assigned job_title/department on re-import (those are curated in the editor). */
export async function upsertOrgPersonBySource(organizationId: string, sourcePersonId: string, fields: { name: string; supervisorSourceId?: string | null; photoUrl?: string | null; location?: string | null }, actor = 'system'): Promise<'created' | 'updated'> {
  const existing = (await db().query<{ id: string }>(
    `SELECT id FROM org_people WHERE organization_id = $1 AND source_person_id = $2 LIMIT 1`, [organizationId, sourcePersonId])).rows[0];
  if (existing) {
    await db().query(
      `UPDATE org_people SET name = $2, supervisor_source_id = $3, photo_url = COALESCE($4, photo_url), location = COALESCE($5, location), updated_by = $6, updated_at = now() WHERE id = $1`,
      [existing.id, fields.name, fields.supervisorSourceId ?? null, fields.photoUrl ?? null, fields.location ?? null, actor]);
    return 'updated';
  }
  await db().query(
    `INSERT INTO org_people (organization_id, source_person_id, name, supervisor_source_id, photo_url, location, created_by, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,now())`,
    [organizationId, sourcePersonId, fields.name, fields.supervisorSourceId ?? null, fields.photoUrl ?? null, fields.location ?? null, actor]);
  return 'created';
}
