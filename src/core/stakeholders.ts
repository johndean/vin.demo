/**
 * Multi-stakeholder collection (Gap F, P2.3). Stakeholders are a COLLECTION, not
 * singular — role + interests + open items per person, even when one is active.
 * Phase 1 shipped the table; this exercises it: each session seeds 2 stakeholders,
 * a per-turn `speaker` marks one active, and discovery accrues per-stakeholder
 * open items.
 */
import { db } from './db.js';

export interface Stakeholder {
  id: string;
  name: string | null;
  role: string | null;
  interests: string[];
  openItems: string[];
  isActive: boolean;
}

interface StakeholderRow {
  id: string;
  name: string | null;
  role: string | null;
  interests: string[];
  open_items: string[];
  is_active: boolean;
}

const toStakeholder = (r: StakeholderRow): Stakeholder => ({
  id: r.id, name: r.name, role: r.role,
  interests: r.interests ?? [], openItems: r.open_items ?? [], isActive: r.is_active,
});

// The room: a procurement lead (hands-on) + a CFO (economic buyer). First is active.
const DEFAULTS = [
  { name: 'Dana', role: 'Procurement Manager', interests: ['approval turnaround', 'audit trail'] },
  { name: 'Morgan', role: 'CFO', interests: ['spend control', 'compliance'] },
];

/** Idempotently seed the stakeholder collection for a session (first one active). */
export async function seedStakeholders(sessionId: string): Promise<void> {
  const existing = await db().query('SELECT 1 FROM stakeholders WHERE demo_session_id = $1 LIMIT 1', [sessionId]);
  if (existing.rowCount) return;
  for (let i = 0; i < DEFAULTS.length; i++) {
    const s = DEFAULTS[i];
    await db().query(
      `INSERT INTO stakeholders (demo_session_id, name, role, interests, open_items, is_active)
         VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5)`,
      [sessionId, s.name, s.role, JSON.stringify(s.interests), i === 0],
    );
  }
}

/** Mark the stakeholder matching `speaker` (name or role, case-insensitive) active. */
export async function setActiveSpeaker(sessionId: string, speaker: string): Promise<Stakeholder | null> {
  // Prefer an exact (case-insensitive) name/role match; substring is only a fallback.
  // Exact-first ordering stops a substring from shadowing an exact hit; name is just a tie-break.
  const { rows } = await db().query<StakeholderRow>(
    `SELECT * FROM stakeholders
       WHERE demo_session_id = $1 AND (name ILIKE $2 OR role ILIKE $2)
       ORDER BY (lower(name) = lower($3) OR lower(role) = lower($3)) DESC, name
       LIMIT 1`,
    [sessionId, `%${speaker}%`, speaker],
  );
  const match = rows[0];
  if (!match) return getActiveStakeholder(sessionId); // unknown hint → keep the current active speaker
  await db().query('UPDATE stakeholders SET is_active = (id = $2) WHERE demo_session_id = $1', [sessionId, match.id]);
  return toStakeholder({ ...match, is_active: true });
}

export async function getActiveStakeholder(sessionId: string): Promise<Stakeholder | null> {
  const { rows } = await db().query<StakeholderRow>(
    `SELECT * FROM stakeholders WHERE demo_session_id = $1 ORDER BY is_active DESC, name LIMIT 1`,
    [sessionId],
  );
  return rows[0] ? toStakeholder(rows[0]) : null;
}

export async function getStakeholders(sessionId: string): Promise<Stakeholder[]> {
  const { rows } = await db().query<StakeholderRow>(
    'SELECT * FROM stakeholders WHERE demo_session_id = $1 ORDER BY name', [sessionId],
  );
  return rows.map(toStakeholder);
}

/** Append a follow-up to a stakeholder's open items (deduped). */
export async function addOpenItem(stakeholderId: string, item: string): Promise<void> {
  await db().query(
    `UPDATE stakeholders SET open_items =
       (SELECT to_jsonb(array(SELECT DISTINCT jsonb_array_elements_text(open_items || $2::jsonb))))
     WHERE id = $1`,
    [stakeholderId, JSON.stringify([item])],
  );
}
