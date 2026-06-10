/**
 * Semantic curation of a product's pending_review queue. Embedding-dedup only catches near-identical
 * wording; multi-source harvests (N role-recons + M docs) are CONCEPTUALLY redundant in different words.
 * This asks the model to SELECT the best distinct, demo-relevant set by index (never rewrite — kept chunks
 * stay verbatim + already faithfulness-gated, so no new text is invented), drop redundant/low-value and
 * anything internal/technical a salesperson would never say. Kept → validated live; dropped → archived.
 * Dry by default; EXECUTE=1 to apply. Run: railway run npx tsx src/core/curate.ts "expense.vin"
 */
import { db } from './db.js';
import Anthropic from '@anthropic-ai/sdk';
import { computeConfidence, sourceQualityFor, recordKnowledgeEvent, type SourceType } from './knowledge.js';

const product = process.argv[2] ?? 'expense.vin';
const DRY = process.env.EXECUTE !== '1';
const actor = 'john@vetvision.org';

const rows = (await db().query<{ id: string; content: string; source_type: string | null; source_id: string | null }>(`
  SELECT kc.id, kc.content, ks.source_type, kc.source_id
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
    LEFT JOIN knowledge_sources ks ON ks.id=kc.source_id
   WHERE p.name=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='pending_review'
   ORDER BY kc.created_at`, [product])).rows;
if (!rows.length) { console.log(`No pending chunks for ${product}.`); process.exit(0); }

const numbered = rows.map((r, i) => `[${i}] ${r.content}`).join('\n');
const client = new Anthropic();
const res = await client.messages.create({
  model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
  max_tokens: 1500,
  system:
    `You curate the demo knowledge base for "${product}". From the numbered candidate facts, SELECT the best set to keep. ` +
    `Rules: (1) DISTINCT — if several say the same thing, keep ONE clearest; (2) DEMO-RELEVANT — what the product does and how users (employee/manager/accounting/admin) use it: workflow, statuses, approvals, delegation, exceptions, payment, roles; ` +
    `(3) DROP internal/technical a salesperson would never say to a buyer: auth tokens, JWT, CORS, API envelopes, HTTP/error codes, RPC names, env vars, implementation detail; (4) DROP trivial/low-value. ` +
    `Aim for ~25-35 kept. SELECT ONLY by index — never rewrite. Output ONLY a JSON object: {"keep":[<indices>]}.`,
  messages: [{ role: 'user', content: `Candidates:\n${numbered}\n\nReturn {"keep":[...]}` }],
});
const b = res.content.find((x) => x.type === 'text');
const txt = b && 'text' in b ? b.text : '{"keep":[]}';
const keep: number[] = (() => { try { return JSON.parse(txt.replace(/^[^{]*/, '').replace(/[^}]*$/, '')).keep ?? []; } catch { return []; } })();
const keepSet = new Set(keep.filter((i) => i >= 0 && i < rows.length));

console.log(`\n══ Curate ${product}: ${rows.length} pending → KEEP ${keepSet.size} · drop ${rows.length - keepSet.size} ══`);
console.log('\nKEEP:'); rows.forEach((r, i) => { if (keepSet.has(i)) console.log(`  ✓ ${r.content.slice(0, 92)}…`); });
console.log('\nDROP (sample):'); rows.forEach((r, i) => { if (!keepSet.has(i)) console.log(`  ✗ ${r.content.slice(0, 78)}…`); });

if (!DRY) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (keepSet.has(i)) {
      const conf = computeConfidence(sourceQualityFor((r.source_type ?? 'doc') as SourceType), 0).value;
      await db().query(`UPDATE knowledge_chunks SET lifecycle_state='validated', validation_status='validated', validated_by=$2, validated_at=now(), validation_method='founder_authorized_curation', last_verified=now()::date, confidence=$3, updated_at=now() WHERE id=$1`, [r.id, actor, conf]);
      await recordKnowledgeEvent('validate', { chunkId: r.id, sourceId: r.source_id, productId: null, actor, after: { lifecycle_state: 'validated', confidence: conf } });
    } else {
      await db().query(`UPDATE knowledge_chunks SET archived_at=now(), archived_by=$2, lifecycle_state='archived', updated_at=now() WHERE id=$1`, [r.id, actor]);
      await recordKnowledgeEvent('archive', { chunkId: r.id, sourceId: r.source_id, productId: null, actor, after: { lifecycle_state: 'archived', reason: 'curation — redundant/low-value' } });
    }
  }
  console.log(`\n  APPLIED — ${keepSet.size} validated live · ${rows.length - keepSet.size} archived.`);
} else {
  console.log(`\n  [DRY] EXECUTE=1 to validate the ${keepSet.size} kept + archive the rest.`);
}
process.exit(0);
