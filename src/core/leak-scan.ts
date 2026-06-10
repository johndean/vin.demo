/** Verify NO backend/technical/implementation detail leaked into a product's LIVE knowledge — the hard
 *  rule "nothing backend, technical reaches the AI or user". Prints every live chunk + flags any that
 *  match a technical-token regex. Run: railway run npx tsx src/core/leak-scan.ts "<product>" */
import { db } from './db.js';
const product = process.argv[2];
if (!product) { console.error('usage: leak-scan.ts <product>'); process.exit(1); }
const rows = (await db().query<{ content: string }>(`
  SELECT kc.content FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
   JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
  WHERE lower(p.name)=lower($1) AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'
  ORDER BY kc.created_at`, [product])).rows;

// Genuinely technical/backend tokens. Deliberately EXCLUDES legitimate product/business terms
// (PDF, DOCX, browser, embed, audit log, compliance engine, Stripe/HubSpot integration names).
const TECHNICAL = /(\/admin|\/embed|src\/|\.tsx?\b|\.sql\b|app_version|\brpc\b|enqueue_notification|fetchallrows|role_capabilities|user_roles|localstorage|postmessage|wizard\.js|data-[a-z]+=|\bcsp\b|content-security|\biframe\b|customevent|mc-wizard|\bgtm\b|\bga4\b|cloudflare|wordfence|\bwaf\b|\bdlq\b|langgraph|\bpinia\b|\bredis\b|\bvault\b|keycloak|\bjwt\b|\bcors\b|\bapi\b|\bhttp\b|\bendpoint|env var|\bssot\b|merkle|webhook|database|\bschema\b)/i;

console.log(`\n${product} — ${rows.length} LIVE chunk(s):\n`);
const flagged: { i: number; term: string; content: string }[] = [];
rows.forEach((r, i) => {
  const m = r.content.match(TECHNICAL);
  const mark = m ? `  ⚠️ [${m[0]}]` : '';
  console.log(`${String(i + 1).padStart(2)}.${mark} ${r.content}`);
  if (m) flagged.push({ i: i + 1, term: m[0], content: r.content });
});
console.log(`\n${'═'.repeat(60)}`);
if (flagged.length === 0) console.log(`✅ LEAK SCAN CLEAN — 0 of ${rows.length} chunks contain backend/technical tokens.`);
else { console.log(`⚠️ ${flagged.length} flagged:`); flagged.forEach((f) => console.log(`  #${f.i} [${f.term}] ${f.content.slice(0, 90)}…`)); }
process.exit(0);
