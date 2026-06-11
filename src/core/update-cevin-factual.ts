/**
 * Update the platform's ce.vin representation to the FACTUAL ce.vin product (per the founder's 91-doc dump:
 * ~85 UX surfaces, the 12 named workflows W1-W12, ~26 product specs). Touches Knowledge, Demo Graph nodes,
 * Demo Graph workflows (W1-W13 as editorial-gated DRAFTS), Product metadata, and Journeys.
 *
 * GUARDRAILS:
 *  - BUSINESS-FACING ONLY. Every string that can reach the demo AI / a prospect is written in product/business
 *    language — no infrastructure, file paths, task/queue names, model vendors, SQL, HTTP codes, or migration ids.
 *  - Workflows are created UNAPPROVED (drafts) via the audited createWorkflow(...false...) — not live until an
 *    operator approves them in the Workflow Builder. Nodes are pending_review (honest: the live site isn't certified).
 *  - Idempotent: re-running updates in place / skips existing; safe to run twice.
 *  - Audited: every mutation goes through the lifecycle helpers (recordGraphEvent / recordJourneyEvent / recordKnowledgeEvent).
 *
 *   npx tsx src/core/update-cevin-factual.ts            # DRY RUN (prints the plan; mutates nothing)
 *   npx tsx src/core/update-cevin-factual.ts --apply
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { createNode, updateNode, archiveNode, createWorkflow, archiveWorkflow } from './graph-lifecycle.js';
import { createJourney, updateJourney } from './journeys.js';

const APPLY = process.argv.includes('--apply');
const ACTOR = 'cevin-factual-update';
const pool = db();
const tag = (s: string) => (APPLY ? s : `would ${s}`);

// ── Resolve product + active graph + KB + version + env ──────────────────────────────────────────────
const prod = (await pool.query<{ id: string; name: string; metadata: any }>(
  `SELECT id, name, metadata FROM products WHERE name='ce.vin' AND archived_at IS NULL LIMIT 1`)).rows[0];
if (!prod) { console.error('ce.vin product not found'); process.exit(1); }
const graph = (await pool.query<{ id: string }>(
  `SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [prod.id])).rows[0];
if (!graph) { console.error('no active ce.vin graph'); process.exit(1); }
const kb = (await pool.query<{ id: string }>(`SELECT id FROM knowledge_bases WHERE product_id=$1 ORDER BY id LIMIT 1`, [prod.id])).rows[0];
const ver = (await pool.query<{ id: string }>(`SELECT id FROM product_versions WHERE product_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [prod.id])).rows[0];
const env = (await pool.query<{ id: string }>(`SELECT id FROM environments WHERE product_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`, [prod.id])).rows[0];
console.log(`ce.vin product=${prod.id}  graph=${graph.id}  kb=${kb?.id}  env=${env?.id ?? '—'}\nMODE: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION A — Product metadata (refine tagline to factual reality; light touch)
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const newMeta = {
  ...(prod.metadata || {}),
  mk: 'CE',
  color: (prod.metadata?.color) || '#007D61',
  category: 'Veterinary Continuing Education',
  tagline: 'Turns recorded CE lectures into accredited, gamified learner experiences',
  one_liner: 'Upload a recorded CE lecture; ce.vin produces transcripts, handouts, quizzes, reinforcement, games, simulations, diagrams, and certificates — ready to review and publish.',
};
console.log('## A. PRODUCT METADATA');
console.log(`   ${tag('set')} tagline="${newMeta.tagline}"  category="${newMeta.category}"`);
if (APPLY) await pool.query(`UPDATE products SET metadata=$2 WHERE id=$1`, [prod.id, JSON.stringify(newMeta)]);

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION B — Knowledge: add business-facing validated chunks grounded in the factual docs
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const CHUNKS: { category: string; content: string }[] = [
  // workflow-level facts (the 13 demo workflows, in business terms)
  { category: 'docs', content: 'Lecture-to-course pipeline: an operator uploads a recorded CE lecture (audio, video, or slides) and ce.vin automatically transcribes it, extracts the clinical concepts, and produces every learner artifact — handouts, quiz, reinforcement items, branching simulations, and diagrams — ready for review and publication.' },
  { category: 'docs', content: 'Operators watch a session move through automated processing on a live status screen and can resume any step that fails; a finished session can be re-processed to regenerate its content from the existing transcript without re-uploading.' },
  { category: 'docs', content: 'Several weekly lectures can be assembled into a multi-week course, and ce.vin can generate a cumulative final exam whose questions span every week once all the weekly sessions are rendered.' },
  { category: 'docs', content: 'Handouts are produced in four styles — an executive summary, a field guide / quick reference, a protocol sheet, and a compliance checklist — rendered to PDF, DOCX, HTML, and Markdown and bundled into one downloadable course pack.' },
  { category: 'docs', content: 'After an editor revises a handout, ce.vin re-validates it for quality and re-renders the downloadable files; handouts that fail the quality check are flagged for review rather than published.' },
  { category: 'docs', content: 'Before a course is published, a coverage gate checks that every important concept has a handout, a quiz item, and a reinforcement item — and that safety-critical concepts additionally carry a RACE learning objective — flagging any gaps for a reviewer.' },
  { category: 'docs', content: 'The Needs-review queue is ce.vin’s editorial inbox: anything flagged by quality checks, coverage gaps, low confidence, or an operator surfaces here for a reviewer to resolve, dismiss, or fill, with safety-critical items requiring a senior reviewer to sign off.' },
  { category: 'docs', content: 'Anyone can submit a product-improvement request through a guided five-step form; administrators move it through review, approval, in-progress, and rollout, and a live badge shows how many requests are pending.' },
  { category: 'docs', content: 'ce.vin schedules spaced-repetition reinforcement so concepts resurface to each learner at the right time — for example seven and thirty days later, or sooner when a concept is weak — and delivers them by push notification and an in-app queue.' },
  { category: 'docs', content: 'Learner answers are graded by meaning rather than exact wording and sorted into four bands — correct, mostly correct, partially correct, or unsafe — with coaching feedback explaining what was right, what was missed, why it matters, and a better answer.' },
  { category: 'docs', content: 'Learner milestones — finishing an activity, hitting a streak, mastering a concept, a perfect score, completing a course, or a first safe answer on a safety-critical item — trigger distinct, rate-limited celebration animations that can be configured per organization, course, session, or game.' },
  { category: 'docs', content: 'Concepts best shown as a flowchart, decision tree, process map, or clinical pathway are automatically turned into clean diagrams included in the learner materials, with operators able to review and regenerate any that need rework.' },
  { category: 'docs', content: 'When a learner completes every session in a course at mastery, ce.vin records the completion, fires a celebration, and issues a downloadable participation-credit certificate available from the learner’s credit page.' },
  { category: 'docs', content: 'Shared learning assets — flashcard decks, matching and ordering sets, crosswords, study guides, simulations, glossaries, reference cards, case studies, and diagrams — move through a draft, submit, review, and publish lifecycle, and can be forked and rated within the organization.' },
  { category: 'docs', content: 'A learner works a session end to end: watch the synchronized video lecture with its transcript, take the RACE-aligned quiz, complete reinforcement, and reach mastery — earning XP, streaks, and badges along the way.' },
  // surface-area facts
  { category: 'docs', content: 'ce.vin separates an operator and editor workspace — upload, sessions, processing, review, handouts, concepts, quizzes, reinforcement, courses, needs-review, analytics, and settings — from a learner experience of courses, sessions, players, games, and rewards.' },
  { category: 'docs', content: 'Learners can revisit concepts through about a dozen game formats — flashcards, spin-the-wheel, word search, matching, ordering, crossword, and a veterinary dose-calculation drill — in addition to quizzes and reinforcement.' },
  { category: 'docs', content: 'ce.vin includes sixteen real-time simulations: medical-crisis drills (code blue, sepsis resuscitation, toxin and radiation timelines, ER triage, hemorrhage and shock, multi-drug interactions) and OSHA safety drills (hazard communication, waste anesthetic gas, lockout/tagout, chemical splash, aggressive-animal handling, bloodborne pathogen, fire evacuation, and OR throughput).' },
  { category: 'docs', content: 'Gamification spans XP, streaks, badges, and weekly, all-time, and per-session leaderboards to keep learners returning to continuing-education content.' },
  { category: 'docs', content: 'Operator settings let an organization tune the AI models and prompt templates used in production, manage brand profiles (logo, colors, fonts) for handouts and certificates, adjust XP weighting and the gameplay engine, and review or restore archived sessions.' },
  { category: 'docs', content: 'Administrators get operational analytics — concept performance, learner interaction statistics, and intervention candidates — to see how courses and learners are performing.' },
  { category: 'docs', content: 'Reviewers triage a session from one place — its assets, concepts, handouts, quiz and reinforcement items, simulations, and coverage — and complete a pre-publication editorial review before the course is rendered.' },
];
console.log(`\n## B. KNOWLEDGE — ${CHUNKS.length} candidate business-facing chunks`);
const present = new Set((await pool.query<{ content: string }>(`SELECT content FROM knowledge_chunks WHERE knowledge_base_id=$1`, [kb.id])).rows.map(r => r.content));
const missing = CHUNKS.filter(c => !present.has(c.content));
console.log(`   ${missing.length} new, ${CHUNKS.length - missing.length} already present`);
if (missing.length && APPLY) {
  const embs = await getEmbeddingProvider().embed(missing.map(c => c.content));
  for (let i = 0; i < missing.length; i++) {
    await pool.query(
      `INSERT INTO knowledge_chunks
         (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, lifecycle_state, updated_at)
       VALUES ($1,$2,$3,$4,$5,0.85,'ce.vin factual reference (operator + learner surfaces, workflows)', now()::date, 'validated', 'validated', now())`,
      [kb.id, ver?.id ?? null, missing[i].category, missing[i].content, toVector(embs[i])],
    );
  }
  console.log(`   + inserted ${missing.length} validated chunks`);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION C — Demo Graph NODES (the real ce.vin surfaces, business-facing). Reuse-or-create by intent_label.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
type N = { label: string; route: string; type: string; purpose: string };
const NODES: N[] = [
  // operator / editor
  { label: 'upload session', route: '/op/upload', type: 'form', purpose: 'Upload a recorded lecture (audio, video, or slides) and create or attach it to a session.' },
  { label: 'sessions list', route: '/op/sessions', type: 'list', purpose: 'Every active session with its status and processing stage — the operator’s entry point.' },
  { label: 'session detail', route: '/op/sessions/{id}', type: 'detail', purpose: 'One-stop session view — assets, concepts, handouts, quiz and reinforcement items, simulations, and coverage — where operators triage.' },
  { label: 'processing monitor', route: '/op/sessions/{id}/processing', type: 'status', purpose: 'Live status of automated processing, stage by stage; operators monitor progress and resume any failed run.' },
  { label: 'content review', route: '/op/sessions/{id}/review', type: 'review', purpose: 'Pre-publication editorial review that surfaces concepts, handouts, and items needing attention before a course is rendered.' },
  { label: 'handouts', route: '/op/sessions/{id}/handouts', type: 'list', purpose: 'A session’s generated handouts with status, quality score, and downloads, plus the full course-pack download.' },
  { label: 'handout editor', route: '/op/sessions/{id}/handouts/{hid}', type: 'editor', purpose: 'Edit a handout’s content and action steps, then re-validate and re-render it.' },
  { label: 'concepts editor', route: '/op/sessions/{id}/concepts', type: 'editor', purpose: 'Review and edit the clinical concepts ce.vin extracted from a lecture.' },
  { label: 'quiz editor', route: '/op/sessions/{id}/quiz', type: 'editor', purpose: 'Review, edit, and reorder a session’s quiz questions, grouped by concept.' },
  { label: 'reinforcement editor', route: '/op/sessions/{id}/reinforcement', type: 'editor', purpose: 'Review, edit, and reorder a session’s spaced-repetition reinforcement items.' },
  { label: 'courses', route: '/op/courses', type: 'list', purpose: 'All courses with weeks-filled and weeks-rendered progress, and draft / active / archived status.' },
  { label: 'course view', route: '/op/courses/{id}', type: 'detail', purpose: 'Per-course management: its sessions, gameplay configuration, and the cumulative final-exam generator.' },
  { label: 'needs-review queue', route: '/op/needs-review', type: 'list', purpose: 'The org-wide editorial inbox of everything flagged for a reviewer to resolve.' },
  { label: 'improvements queue', route: '/op/improvements', type: 'list', purpose: 'The product-feedback queue where any user submits and admins act, with a live pending count.' },
  { label: 'improvement builder', route: '/op/improvements', type: 'wizard', purpose: 'A guided five-step form for submitting a product-improvement request.' },
  { label: 'analytics', route: '/op/analytics', type: 'dashboard', purpose: 'Operational analytics — concept performance, learner interaction statistics, and intervention candidates.' },
  { label: 'celebration assets', route: '/op/celebration-assets', type: 'list', purpose: 'Register and manage the custom celebration animations used to reward learners.' },
  { label: 'celebration config', route: '/op/celebration-config', type: 'config', purpose: 'Choose which celebration fires for each learner milestone, by organization, course, session, or game.' },
  { label: 'marketplace', route: '/op/marketplace', type: 'list', purpose: 'Browse shared learning assets across the organization with status and kind filters.' },
  { label: 'marketplace asset detail', route: '/op/marketplace/{id}', type: 'detail', purpose: 'A single shared learning asset with its review-and-publish lifecycle actions.' },
  // settings
  { label: 'general settings', route: '/op/settings/general', type: 'config', purpose: 'Organization-level basics for the CE program.' },
  { label: 'AI model settings', route: '/op/settings/ai-models', type: 'config', purpose: 'Configure the AI models used at each stage of course production.' },
  { label: 'prompt template settings', route: '/op/settings/prompt-templates', type: 'config', purpose: 'View and override the prompt templates that generate course content.' },
  { label: 'brand profiles', route: '/op/settings/profiles', type: 'config', purpose: 'Brand profiles — logo, colors, fonts — used to render handouts and certificates.' },
  { label: 'XP weighting', route: '/op/settings/xp-weights', type: 'config', purpose: 'Tune XP weight multipliers and grant manual XP, with full audit history.' },
  { label: 'gameplay engine settings', route: '/op/settings/gameplay-engine', type: 'config', purpose: 'Gameplay defaults at organization, topic, and course-kind levels, plus the game catalog.' },
  { label: 'per-game settings', route: '/op/settings/gameplay-engine/games/{gameId}', type: 'config', purpose: 'Settings for a single game type.' },
  { label: 'trash & restore', route: '/op/settings/trash', type: 'config', purpose: 'Restore or permanently delete archived sessions.' },
  { label: 'diagnostics', route: '/op/settings/diagnostics', type: 'config', purpose: 'Read-only diagnostics: audit log, gate overrides, and processing statistics.' },
  // learner
  { label: 'learner home', route: '/learn', type: 'home', purpose: 'The learner landing page — queued reinforcement above the fold, the course catalog, XP, and streak.' },
  { label: 'learner course hub', route: '/learn/courses/{id}', type: 'hub', purpose: 'A course’s weeks and sessions with progress, plus the final-exam tile when available.' },
  { label: 'session hub', route: '/learn/sessions/{id}', type: 'hub', purpose: 'A session’s table of contents and flow — the entry point for all learner activity in that session.' },
  { label: 'lesson player', route: '/learn/sessions/{id}/player', type: 'player', purpose: 'The synchronized video lesson player with transcript and segment navigation.' },
  { label: 'quiz player', route: '/learn/sessions/{id}/quiz', type: 'player', purpose: 'The quiz player — standard, adaptive, or timed lightning mode — with rationale feedback.' },
  { label: 'reinforcement player', route: '/learn/sessions/{id}/reinforcement', type: 'player', purpose: 'The reinforcement player for scenario-based and mistake-correction items.' },
  { label: 'reinforcement queue', route: '/learn/reinforcement/{queue_id}', type: 'player', purpose: 'A learner’s queued spaced-repetition item, opened from a push notification or the learner home.' },
  { label: 'badges', route: '/learn/badges', type: 'list', purpose: 'A learner’s earned badges and the criteria for ones not yet earned.' },
  { label: 'leaderboards', route: '/learn/leaderboards', type: 'list', purpose: 'Weekly, all-time, and per-session leaderboards with the learner’s own rank.' },
  { label: 'flashcards', route: '/learn/sessions/{id}/flashcards', type: 'game', purpose: 'A tap-to-flip flashcard review drill.' },
  { label: 'spin the wheel', route: '/learn/sessions/{id}/wheel', type: 'game', purpose: 'A spin-the-wheel game that picks a concept for a quick drill.' },
  { label: 'word search', route: '/learn/sessions/{id}/word-search', type: 'game', purpose: 'A word-search puzzle built from a session’s terms.' },
  { label: 'matching', route: '/learn/sessions/{id}/matching', type: 'game', purpose: 'A pairs game matching terms to definitions or conditions to treatments.' },
  { label: 'ordering', route: '/learn/sessions/{id}/ordering', type: 'game', purpose: 'An order-the-steps game where learners sequence a procedure correctly.' },
  { label: 'dose calculator', route: '/learn/sessions/{id}/dose-calc', type: 'game', purpose: 'A veterinary dose-calculation drill using animal weight, drug, concentration, and route.' },
  { label: 'crossword', route: '/learn/sessions/{id}/crossword', type: 'game', purpose: 'A crossword built from a session’s terminology.' },
  { label: 'crisis simulation', route: '/learn/sessions/{id}/crisis-sim', type: 'simulation', purpose: 'A real-time clinical-crisis drill where learners manage a patient through a code-blue scenario.' },
  { label: 'specialty simulations', route: '/learn/sessions/{id}/simulations', type: 'simulation', purpose: 'Sixteen real-time medical-crisis and OSHA safety simulations learners can run from a session.' },
  { label: 'learner credit & certificates', route: '/learn/credit', type: 'list', purpose: 'A learner’s per-course participation credit and downloadable completion certificates.' },
  // auth
  { label: 'login', route: '/login', type: 'auth', purpose: 'Sign in to ce.vin.' },
  { label: 'home / landing', route: '/', type: 'home', purpose: 'The role-aware landing page — operators see a dashboard, learners are taken to their home.' },
];

const existingNodes = (await pool.query<{ id: string; intent_label: string }>(
  `SELECT id, intent_label FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL`, [graph.id])).rows;
const byLabel = new Map(existingNodes.map(n => [n.intent_label.toLowerCase(), n]));
console.log(`\n## C. DEMO GRAPH NODES — ${NODES.length} canonical surfaces (currently ${existingNodes.length} nodes)`);
let nCreate = 0, nUpdate = 0;
for (const n of NODES) {
  const ex = byLabel.get(n.label.toLowerCase());
  if (ex) {
    nUpdate++; console.log(`   ${tag('update')} "${n.label}"  ${n.route} <${n.type}>`);
    if (APPLY) await updateNode(ex.id, { intentLabel: n.label, screenRoute: n.route, screenType: n.type, screenName: n.label, businessPurpose: n.purpose }, ACTOR);
  } else {
    nCreate++; console.log(`   ${tag('create')} "${n.label}"  ${n.route} <${n.type}>`);
    if (APPLY) await createNode(graph.id, { intentLabel: n.label, screenRoute: n.route, screenType: n.type, screenName: n.label, businessPurpose: n.purpose, verificationStatus: 'pending_review' }, ACTOR);
  }
}
// Archive the duplicate "badges page" (kept canonical "badges")
const dupBadges = byLabel.get('badges page');
if (dupBadges) { console.log(`   ${tag('archive')} duplicate node "badges page"`); if (APPLY) await archiveNode(dupBadges.id, ACTOR); }
console.log(`   → ${nCreate} new, ${nUpdate} updated, ${dupBadges ? 1 : 0} archived`);

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION D — Demo Graph WORKFLOWS: archive the loose autogen drafts, create grounded W1-W13 (DRAFTS)
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const KEEP_WORKFLOWS = new Set(['ce.vin demo']); // keep the approved backfill
const existingWfs = (await pool.query<{ id: string; workflow_name: string; approved_at: any }>(
  `SELECT id, workflow_name, approved_at FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL`, [graph.id])).rows;
console.log(`\n## D. WORKFLOWS — archive ${existingWfs.filter(w => !KEEP_WORKFLOWS.has(w.workflow_name.toLowerCase())).length} loose draft(s); create W1-W13 grounded drafts`);
for (const w of existingWfs) {
  if (KEEP_WORKFLOWS.has(w.workflow_name.toLowerCase())) { console.log(`   keep "${w.workflow_name}" (${w.approved_at ? 'approved' : 'draft'})`); continue; }
  console.log(`   ${tag('archive')} loose draft "${w.workflow_name}"`);
  if (APPLY) await archiveWorkflow(w.id, ACTOR);
}

type WF = { name: string; purpose: string; stakeholder: string; success: string; seq: string[]; outcome?: string };
const WORKFLOWS: WF[] = [
  { name: 'Lecture to Publishable Course Pack', stakeholder: 'Content Production Manager', outcome: 'Reduce course production time',
    purpose: 'Upload a recorded CE lecture and let ce.vin produce every learner artifact — transcript, handouts, quiz, reinforcement, simulations, and diagrams — then review and publish it.',
    success: 'A raw 60-minute lecture becomes a publishable course session in tens of minutes of processing instead of days of manual work.',
    seq: ['upload session', 'processing monitor', 'content review', 'session detail'] },
  { name: 'Multi-Week Course Build with Final Exam', stakeholder: 'Director of Continuing Education', outcome: 'Increase published course volume',
    purpose: 'Assemble several weekly lectures into a multi-week course and generate a cumulative final exam that spans every week.',
    success: 'A complete multi-week course, including a course-level final exam, is published from individually processed sessions.',
    seq: ['courses', 'course view', 'session detail'] },
  { name: 'Validate, Render & Bundle Handouts', stakeholder: 'Content Production Manager', outcome: 'Reduce manual content editing effort',
    purpose: 'After an editor revises a handout, re-validate it for quality, re-render the downloadable files, and bundle the session’s full course pack.',
    success: 'Edited handouts pass the quality check and the downloadable course pack (PDF, DOCX, Markdown) is regenerated.',
    seq: ['session detail', 'handouts', 'handout editor'] },
  { name: 'Submit & Track a Product Improvement', stakeholder: 'Owner / Managing Director',
    purpose: 'Capture a product-improvement request through a guided form, route it through admin review and approval, and track it to rollout with a live pending count.',
    success: 'An improvement request moves from submitted through review, approval, and rollout, with submitters notified along the way.',
    seq: ['improvements queue', 'improvement builder'] },
  { name: 'Spaced-Repetition Reinforcement', stakeholder: 'CE Program Manager', outcome: 'Increase member engagement with CE content',
    purpose: 'Surface concepts back to learners at the right time through scheduled reinforcement, delivered by push notification and completed in the in-app queue.',
    success: 'Learners receive and complete timely reinforcement (for example at day 7 and day 30), strengthening long-term retention.',
    seq: ['learner home', 'reinforcement queue', 'reinforcement player', 'badges'] },
  { name: 'Coverage Gate — Publication Readiness', stakeholder: 'Accreditation & Compliance Manager', outcome: 'Reduce gate violations before publishing',
    purpose: 'Before publishing, verify every important concept has handout, quiz, and reinforcement coverage — and that safety-critical concepts carry a RACE objective — flagging any gaps.',
    success: 'Courses reach the review gate with coverage gaps surfaced and resolved before members ever see them.',
    seq: ['processing monitor', 'content review', 'needs-review queue'] },
  { name: 'Needs-Review Editorial Triage', stakeholder: 'Clinical Review Lead', outcome: 'Reduce review bottlenecks',
    purpose: 'Work the editorial inbox: items flagged by quality checks, coverage gaps, low confidence, or operators surface here for a reviewer to resolve, dismiss, or fill.',
    success: 'Flagged items are cleared quickly and meaningfully, with safety-critical items routed to a senior reviewer.',
    seq: ['needs-review queue', 'session detail', 'content review'] },
  { name: 'Answer Grading & Coaching Feedback', stakeholder: 'CE Program Manager', outcome: 'Improve course content accuracy',
    purpose: 'Grade a learner’s answer by meaning rather than exact wording, band the result, and return coaching feedback on what was right, what was missed, and a better answer.',
    success: 'Learners get accurate semantic grading and actionable feedback within seconds of answering.',
    seq: ['session hub', 'quiz player', 'reinforcement player', 'badges'] },
  { name: 'Celebrations & Rewards', stakeholder: 'CE Program Manager', outcome: 'Increase member engagement with CE content',
    purpose: 'Reward learner milestones — activity completion, streaks, mastery, perfect scores, course completion — with distinct, rate-limited celebrations configurable per org, course, session, or game.',
    success: 'Meaningful milestones trigger the right celebration, configurable by the program and respectful of reduced-motion preferences.',
    seq: ['reinforcement player', 'badges', 'leaderboards'] },
  { name: 'Diagram Generation from Concepts', stakeholder: 'Content Production Manager', outcome: 'Improve course content accuracy',
    purpose: 'Automatically turn decision-tree and flowchart concepts into clean diagrams included in the learner materials, with operators able to review and regenerate any that fail.',
    success: 'Diagrammatic concepts ship as portable diagrams in the course pack; failures are flagged for review rather than published broken.',
    seq: ['session detail', 'concepts editor', 'handouts'] },
  { name: 'Course Completion & Certificate', stakeholder: 'Membership Manager', outcome: 'Increase member engagement with CE content',
    purpose: 'When a learner completes every session in a course at mastery, record the completion, fire a celebration, and issue a downloadable participation-credit certificate.',
    success: 'Completing learners receive a downloadable certificate and see their participation credit on their credit page.',
    seq: ['learner course hub', 'learner credit & certificates'] },
  { name: 'Marketplace Asset Lifecycle', stakeholder: 'CE Program Manager', outcome: 'Strengthen content governance',
    purpose: 'Move shared learning assets (flashcard decks, sims, glossaries, case studies, and more) through a draft → submit → review → publish lifecycle, with fork and rate.',
    success: 'Community learning assets are governed end to end — only admin-reviewed assets get published, and published assets can be forked and rated.',
    seq: ['marketplace', 'marketplace asset detail'] },
  { name: 'Learner Lesson to Mastery', stakeholder: 'Membership Manager', outcome: 'Increase member engagement with CE content',
    purpose: 'A learner works a session end to end: watch the synchronized lecture, take the RACE-aligned quiz, complete reinforcement, and reach mastery — earning XP, streaks, and badges.',
    success: 'A learner completes a full session — lecture, quiz, reinforcement — reaches mastery, and is rewarded, all in one guided flow.',
    seq: ['learner home', 'learner course hub', 'session hub', 'lesson player', 'quiz player', 'reinforcement player', 'badges'] },
];

// resolve outcome ids by title
const outRows = (await pool.query<{ id: string; title: string }>(`SELECT id, title FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL`, [prod.id])).rows;
const outByTitle = new Map(outRows.map(o => [o.title.toLowerCase(), o.id]));
const createdWf = new Map<string, string>(); // name -> id
let wn = 0;
for (const w of WORKFLOWS) {
  wn++;
  const oid = w.outcome ? outByTitle.get(w.outcome.toLowerCase()) : undefined;
  console.log(`   ${tag('create')} W${wn} "${w.name}"  [${w.stakeholder}]${oid ? ` →outcome:${w.outcome}` : ''}\n        seq=[${w.seq.join(' → ')}]`);
  if (APPLY) {
    const { workflowId } = await createWorkflow(graph.id, { name: w.name, businessPurpose: w.purpose, stakeholderType: w.stakeholder, personaType: null, nodeSequence: w.seq, successCriteria: w.success, sortOrder: wn }, false, ACTOR);
    createdWf.set(w.name, workflowId);
    if (oid) await pool.query(`UPDATE demo_graph_workflows SET business_outcome_id=$2 WHERE id=$1`, [workflowId, oid]);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION E — Journeys grounded in W1-W13 + outcomes + committee (DRAFTS; zero dangling: workflow + note only)
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const shRows = (await pool.query<{ id: string; role: string | null }>(`SELECT id, role FROM product_stakeholders WHERE product_id=$1 AND archived_at IS NULL`, [prod.id])).rows;
const shByRole = (role: string) => shRows.find(s => (s.role || '').toLowerCase() === role.toLowerCase())?.id;
const wf = (name: string) => createdWf.get(name) || null;
const step = (kind: 'workflow' | 'note', refName: string | null, caption: string) => ({ kind, refId: kind === 'workflow' ? wf(refName!) : null, caption });

console.log(`\n## E. JOURNEYS`);

// J1: update the existing "Reduce course production time" journey to reference the new W1/W2/W6
const existingJ = (await pool.query<{ id: string }>(`SELECT id FROM journeys WHERE product_id=$1 AND name ILIKE '%Reduce course production time%' AND archived_at IS NULL LIMIT 1`, [prod.id])).rows[0];
const j1Flow = [
  step('note', null, 'Frame for the CE production team — target outcome: cut the time from upload to a publishable course.'),
  step('workflow', 'Lecture to Publishable Course Pack', 'Show: a recorded lecture becomes a full course pack automatically.'),
  step('workflow', 'Coverage Gate — Publication Readiness', 'Show: the coverage gate keeps quality high without slowing publication.'),
  step('workflow', 'Multi-Week Course Build with Final Exam', 'Scale it: assemble a multi-week course with a cumulative final exam.'),
  step('note', null, 'Close on faster, more predictable time-to-publish.'),
];
if (existingJ) {
  console.log(`   ${tag('update')} J1 "Reduce course production time" → refs W1, W6, W2 (5 steps)`);
  if (APPLY) await updateJourney(existingJ.id, { storyFlow: j1Flow, businessOutcomeId: outByTitle.get('reduce course production time') || null, environmentId: env?.id || null,
    stakeholderRefs: ['Director of Continuing Education', 'Content Production Manager', 'CE Program Manager', 'Owner / Managing Director'].map(shByRole).filter(Boolean) as string[] }, ACTOR);
} else console.log('   (existing production-time journey not found — skipping J1 update)');

// J2: engage learners & prove retention
const j2Flow = [
  step('note', null, 'Frame for the membership and program team — target outcome: more learners completing and returning.'),
  step('workflow', 'Learner Lesson to Mastery', 'Show: a learner works a lesson end to end and reaches mastery.'),
  step('workflow', 'Spaced-Repetition Reinforcement', 'Show: reinforcement brings concepts back at the right time.'),
  step('workflow', 'Celebrations & Rewards', 'Show: milestones are celebrated to keep learners engaged.'),
  step('workflow', 'Course Completion & Certificate', 'Close: completion earns a downloadable participation certificate.'),
];
console.log(`   ${tag('create')} J2 "Engage Learners and Prove Retention" → outcome:Increase member engagement (5 steps)`);
if (APPLY) await createJourney(prod.id, { name: 'Engage Learners and Prove Retention', businessGoal: 'Increase member engagement with CE content',
  businessOutcomeId: outByTitle.get('increase member engagement with ce content') || null, environmentId: env?.id || null, status: 'draft',
  storyFlow: j2Flow, stakeholderRefs: ['Membership Manager', 'CE Program Manager'].map(shByRole).filter(Boolean) as string[],
  successCriteria: 'Course completion rate and member return rate increase; learners receive timely reinforcement and earn certificates on completion.' }, ACTOR);

// J3: publish accredited courses with confidence
const j3Flow = [
  step('note', null, 'Frame for accreditation and review leadership — target outcome: publish accredited courses with zero gate violations.'),
  step('workflow', 'Lecture to Publishable Course Pack', 'Show: a lecture becomes a structured, reviewable course.'),
  step('workflow', 'Coverage Gate — Publication Readiness', 'Show: every concept is checked for coverage, with RACE objectives on safety-critical content.'),
  step('workflow', 'Needs-Review Editorial Triage', 'Show: flagged items are triaged and resolved before publication.'),
  step('note', null, 'Close on a complete, auditable review trail for accreditation.'),
];
console.log(`   ${tag('create')} J3 "Publish Accredited Courses with Confidence" → outcome:Reduce gate violations (5 steps)`);
if (APPLY) await createJourney(prod.id, { name: 'Publish Accredited Courses with Confidence', businessGoal: 'Reduce gate violations before publishing',
  businessOutcomeId: outByTitle.get('reduce gate violations before publishing') || null, environmentId: env?.id || null, status: 'draft',
  storyFlow: j3Flow, stakeholderRefs: ['Accreditation & Compliance Manager', 'Clinical Review Lead', 'Director of Continuing Education'].map(shByRole).filter(Boolean) as string[],
  successCriteria: 'Courses reach the review gate with zero unresolved violations and a complete, retrievable review record.' }, ACTOR);

console.log(`\n${APPLY ? 'APPLIED.' : 'DRY RUN complete — re-run with --apply to mutate.'}`);
process.exit(0);
