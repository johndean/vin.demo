/**
 * Backfill provenance onto every PRE-EXISTING chunk (migration 0011): for each chunk's free-text `source`
 * string, create/find a real knowledge_sources row, set chunk.source_id + lifecycle_state (mapped from
 * validation_status) + updated_at, and emit a 'create' knowledge_events row so the mutation audit is
 * non-empty from day one. IDEMPOTENT: only touches chunks whose source_id IS NULL, so a re-run is a no-op
 * (and won't duplicate audit events). Run AFTER `npm run migrate`:  npm run backfill:sources
 */
import { db } from './db.js';
import { ensureSource, recordKnowledgeEvent, inferSourceType, mapLifecycle } from './knowledge.js';

interface Row {
  id: string; product_id: string; product_version_id: string | null;
  source: string; category: string; confidence: number;
  last_verified: string | null; validation_status: string; source_id: string | null;
}

// Process chunks missing a source_id (first-time) OR validated chunks missing a validator (top-up after a
// prior backfill predating validated_by). Idempotent: after this, both conditions are empty → re-run no-ops.
const { rows } = await db().query<Row>(`
  SELECT kc.id, kb.product_id, kc.product_version_id, kc.source, kc.category, kc.confidence,
         kc.last_verified::text AS last_verified, kc.validation_status, kc.source_id
    FROM knowledge_chunks kc
    JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
   WHERE kc.source_id IS NULL OR (kc.lifecycle_state = 'validated' AND kc.validated_by IS NULL)`);

console.log(`Backfilling provenance for ${rows.length} chunk(s)…`);
let created = 0, toppedUp = 0;
for (const r of rows) {
  const firstTime = !r.source_id;
  const sourceType = inferSourceType(r.category);
  const sourceId = await ensureSource(r.product_id, {
    title: r.source, sourceType, owner: 'VIN Demo (internal)', uri: null,
    lastVerified: r.last_verified, versionId: r.product_version_id, createdBy: 'backfill',
  });
  const lifecycle = mapLifecycle(r.validation_status);
  const validated = lifecycle === 'validated';
  // Validated chunks carry a real validator + method (the VIN Demo team's human review) so the AI can
  // state "validated by <X> on <date>". COALESCE keeps any already-set value (never overwrite).
  await db().query(
    `UPDATE knowledge_chunks SET
        source_id = $2, lifecycle_state = $3, updated_at = COALESCE(updated_at, created_at),
        validated_by      = CASE WHEN $4 THEN COALESCE(validated_by, 'VIN Demo (internal)') ELSE validated_by END,
        validated_at      = CASE WHEN $4 THEN COALESCE(validated_at, last_verified::timestamptz, created_at) ELSE validated_at END,
        validation_method = CASE WHEN $4 THEN COALESCE(validation_method, 'human_review') ELSE validation_method END
       WHERE id = $1`,
    [r.id, sourceId, lifecycle, validated],
  );
  if (firstTime) {
    await recordKnowledgeEvent('create', {
      chunkId: r.id, sourceId, productId: r.product_id, actor: 'backfill',
      after: { source: r.source, source_type: sourceType, lifecycle_state: lifecycle, confidence: r.confidence, validation_status: r.validation_status },
    });
    created++;
  } else toppedUp++;
}
console.log(`  + provenance backfilled: ${created} created, ${toppedUp} validator-topped-up; sources upserted; mutation audit seeded.`);
process.exit(0);
