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
  // Stakeholder governance — so the consultant knows who carries weight / can decide.
  influence: string | null;          // low | medium | high
  riskLevel: string | null;          // low | medium | high
  decisionAuthority: string | null;  // none | influencer | approver | economic_buyer
}

interface StakeholderRow {
  id: string;
  name: string | null;
  role: string | null;
  interests: string[];
  open_items: string[];
  is_active: boolean;
  influence: string | null;
  risk_level: string | null;
  decision_authority: string | null;
}

const toStakeholder = (r: StakeholderRow): Stakeholder => ({
  id: r.id, name: r.name, role: r.role,
  interests: r.interests ?? [], openItems: r.open_items ?? [], isActive: r.is_active,
  influence: r.influence ?? null, riskLevel: r.risk_level ?? null, decisionAuthority: r.decision_authority ?? null,
});

type RoomMember = { name: string; role: string; interests: string[]; influence: string; risk_level: string; decision_authority: string };
// Code DEFAULTS — the FALLBACK room when a product has no configured roster (keeps the reel working out of
// the box). The real, per-product room is defined in `product_stakeholders` (0012) and edited in the console.
const DEFAULTS: RoomMember[] = [
  { name: 'Dana', role: 'Procurement Manager', interests: ['approval turnaround', 'audit trail'], influence: 'medium', risk_level: 'low', decision_authority: 'influencer' },
  { name: 'Morgan', role: 'CFO', interests: ['spend control', 'compliance'], influence: 'high', risk_level: 'medium', decision_authority: 'economic_buyer' },
];

/** A product's SCRIPTED demo room — the named people the reel/convo tailor to (a Finance Controller for
 *  expense.vin, a CE Director for ce.vin, …). Empty → the code DEFAULTS apply. Founder-editable in the
 *  console. NOTE: live interactive/voice sessions seed NO room at all (session.ts `seedRoom=false`) — the
 *  operator is the only real person, so the AI must never address a fabricated attendee by name. */
export async function getProductRoster(productId: string): Promise<RoomMember[]> {
  const { rows } = await db().query<{ name: string; role: string | null; interests: string[]; influence: string | null; risk_level: string | null; decision_authority: string | null }>(
    `SELECT name, role, interests, influence, risk_level, decision_authority
       FROM product_stakeholders WHERE product_id = $1 AND archived_at IS NULL
      ORDER BY sort_order, created_at`,
    [productId],
  ).catch(() => ({ rows: [] as any[] })); // table may not exist pre-migration — fall back to DEFAULTS
  return rows.map((r) => ({
    name: r.name, role: r.role ?? '', interests: r.interests ?? [],
    influence: r.influence ?? 'medium', risk_level: r.risk_level ?? 'low', decision_authority: r.decision_authority ?? 'influencer',
  }));
}

/** Idempotently seed the stakeholder collection for a session (first one active), with governance attrs.
 *  Seeds from the product's roster when given a productId; otherwise the code DEFAULTS. */
export async function seedStakeholders(sessionId: string, productId?: string | null): Promise<void> {
  const existing = await db().query('SELECT 1 FROM stakeholders WHERE demo_session_id = $1 LIMIT 1', [sessionId]);
  if (existing.rowCount) return;
  const roster = productId ? await getProductRoster(productId) : [];
  const people = roster.length ? roster : DEFAULTS;
  for (let i = 0; i < people.length; i++) {
    const s = people[i];
    await db().query(
      `INSERT INTO stakeholders (demo_session_id, name, role, interests, open_items, is_active, influence, risk_level, decision_authority)
         VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5, $6, $7, $8)`,
      [sessionId, s.name, s.role, JSON.stringify(s.interests), i === 0, s.influence, s.risk_level, s.decision_authority],
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

// ── Stakeholder Registry CRUD (V5 Guided Experience Platform, Phase 1; migration 0020) — the per-product
// BUYING COMMITTEE as a governed registry. EXTENDS product_stakeholders (0012, the scripted room) with the
// decision_criteria / goals / objections / questions the platform asks for + version/authorship. NOTE:
// getProductRoster above is UNCHANGED (the minimal seed read the reel still uses). Soft-archive only (0009
// posture). Pure DB (no LLM/browser). ──

export interface RegistryStakeholder {
  id: string;
  name: string;
  role: string | null;
  interests: string[];
  influence: string | null;          // low | medium | high
  riskLevel: string | null;          // low | medium | high
  decisionAuthority: string | null;  // none | influencer | approver | economic_buyer
  decisionCriteria: string[];        // what THIS person evaluates on
  goals: string[];
  objections: string[];
  questions: string[];
  sortOrder: number;
}

export interface StakeholderInput {
  name: string;
  role?: string | null;
  interests?: string[];
  influence?: string | null;
  riskLevel?: string | null;
  decisionAuthority?: string | null;
  decisionCriteria?: string[];
  goals?: string[];
  objections?: string[];
  questions?: string[];
  sortOrder?: number | null;
}

interface RegistryRow {
  id: string; name: string; role: string | null; interests: string[];
  influence: string | null; risk_level: string | null; decision_authority: string | null;
  decision_criteria: string[]; goals: string[]; objections: string[]; questions: string[]; sort_order: number;
}
const toRegistry = (r: RegistryRow): RegistryStakeholder => ({
  id: r.id, name: r.name, role: r.role, interests: r.interests ?? [],
  influence: r.influence ?? null, riskLevel: r.risk_level ?? null, decisionAuthority: r.decision_authority ?? null,
  decisionCriteria: r.decision_criteria ?? [], goals: r.goals ?? [], objections: r.objections ?? [],
  questions: r.questions ?? [], sortOrder: r.sort_order ?? 0,
});

/** The full buying-committee registry for a product (non-archived), with decision criteria/goals/objections. */
export async function getStakeholderRegistry(productId: string): Promise<RegistryStakeholder[]> {
  const { rows } = await db().query<RegistryRow>(
    `SELECT id, name, role, interests, influence, risk_level, decision_authority,
            decision_criteria, goals, objections, questions, sort_order
       FROM product_stakeholders WHERE product_id = $1 AND archived_at IS NULL
      ORDER BY sort_order, created_at`, [productId]);
  return rows.map(toRegistry);
}

export async function createProductStakeholder(productId: string, input: StakeholderInput, actor = 'system'): Promise<{ stakeholderId: string }> {
  if (!productId) throw new Error('productId required');
  if (!input?.name?.trim()) throw new Error('stakeholder name required');
  const id = (await db().query<{ id: string }>(
    `INSERT INTO product_stakeholders
       (product_id, name, role, interests, influence, risk_level, decision_authority,
        decision_criteria, goals, objections, questions, sort_order, updated_by, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,now()) RETURNING id`,
    [productId, input.name.trim(), input.role ?? null, JSON.stringify(input.interests ?? []),
     input.influence ?? null, input.riskLevel ?? null, input.decisionAuthority ?? null,
     JSON.stringify(input.decisionCriteria ?? []), JSON.stringify(input.goals ?? []),
     JSON.stringify(input.objections ?? []), JSON.stringify(input.questions ?? []), input.sortOrder ?? 0, actor],
  )).rows[0].id;
  return { stakeholderId: id };
}

/** Edit a registry stakeholder (COALESCE keeps any omitted field). Bumps version; stamps updated_by/at. */
export async function updateProductStakeholder(stakeholderId: string, input: Partial<StakeholderInput>, actor = 'system'): Promise<void> {
  const before = (await db().query<{ id: string }>(`SELECT id FROM product_stakeholders WHERE id = $1`, [stakeholderId])).rows[0];
  if (!before) throw new Error('stakeholder not found');
  if (input.name != null && !input.name.trim()) throw new Error('stakeholder name cannot be blank');
  await db().query(
    `UPDATE product_stakeholders SET
       name = COALESCE($2, name), role = COALESCE($3, role),
       interests = COALESCE($4::jsonb, interests), influence = COALESCE($5, influence),
       risk_level = COALESCE($6, risk_level), decision_authority = COALESCE($7, decision_authority),
       decision_criteria = COALESCE($8::jsonb, decision_criteria), goals = COALESCE($9::jsonb, goals),
       objections = COALESCE($10::jsonb, objections), questions = COALESCE($11::jsonb, questions),
       sort_order = COALESCE($12, sort_order), version = version + 1, updated_by = $13, updated_at = now()
     WHERE id = $1`,
    [stakeholderId, input.name?.trim() ?? null, input.role ?? null,
     input.interests ? JSON.stringify(input.interests) : null, input.influence ?? null,
     input.riskLevel ?? null, input.decisionAuthority ?? null,
     input.decisionCriteria ? JSON.stringify(input.decisionCriteria) : null,
     input.goals ? JSON.stringify(input.goals) : null,
     input.objections ? JSON.stringify(input.objections) : null,
     input.questions ? JSON.stringify(input.questions) : null,
     input.sortOrder ?? null, actor],
  );
}

/** Soft-archive a registry stakeholder (never hard-delete): edges cascade-archive via FK on hard-delete only,
 *  so we also drop their non-archived influence edges here to keep the graph consistent. */
export async function archiveProductStakeholder(stakeholderId: string, actor = 'system'): Promise<void> {
  await db().query(`UPDATE product_stakeholders SET archived_at = now(), archived_by = $2 WHERE id = $1`, [stakeholderId, actor]);
  await db().query(
    `UPDATE stakeholder_relationships SET archived_at = now(), archived_by = $2
       WHERE archived_at IS NULL AND (from_stakeholder_id = $1 OR to_stakeholder_id = $1)`, [stakeholderId, actor]);
}

// ── Influence graph (stakeholder_relationships) — edges between committee members. Soft-archive (0009). ──
export interface StakeholderRelationship {
  id: string; fromStakeholderId: string; toStakeholderId: string; relation: string | null; weight: string | null;
}
interface RelationshipRow { id: string; from_stakeholder_id: string; to_stakeholder_id: string; relation: string | null; weight: string | null }

export async function getStakeholderRelationships(productId: string): Promise<StakeholderRelationship[]> {
  const { rows } = await db().query<RelationshipRow>(
    `SELECT id, from_stakeholder_id, to_stakeholder_id, relation, weight
       FROM stakeholder_relationships WHERE product_id = $1 AND archived_at IS NULL`, [productId]);
  return rows.map((r) => ({ id: r.id, fromStakeholderId: r.from_stakeholder_id, toStakeholderId: r.to_stakeholder_id, relation: r.relation, weight: r.weight }));
}

export async function addStakeholderRelationship(productId: string, fromId: string, toId: string, relation: string | null, weight: string | null, actor = 'system'): Promise<{ relationshipId: string }> {
  if (!fromId || !toId) throw new Error('from and to stakeholder ids required');
  if (fromId === toId) throw new Error('a stakeholder cannot relate to themselves');
  const id = (await db().query<{ id: string }>(
    `INSERT INTO stakeholder_relationships (product_id, from_stakeholder_id, to_stakeholder_id, relation, weight, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [productId, fromId, toId, relation ?? null, weight ?? null, actor],
  )).rows[0].id;
  return { relationshipId: id };
}

export async function archiveStakeholderRelationship(relationshipId: string, actor = 'system'): Promise<void> {
  await db().query(`UPDATE stakeholder_relationships SET archived_at = now(), archived_by = $2 WHERE id = $1`, [relationshipId, actor]);
}
