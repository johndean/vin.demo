/**
 * rounds.vin — DETERMINISTIC full-coverage sitemap (authoritative source for 100% Knowledge + Demo Graph
 * coverage). Hand-transcribed from the code-grounded rounds.vin AI-demo-knowledge corpus (architecture,
 * business rules, per-module demo-questions, per-screen specs, help center). rounds.vin is TRANSCRIPT
 * software for VIN: upload a recorded session → an AI pipeline produces a first-pass transcript with speaker
 * labels + slide alignment → an 8-stage human SOP workflow → CMS export. Every documented UX page is
 * represented with its purpose, fields, buttons, actions, tabs, errors and FAQs — zero gaps.
 *
 * FIREWALL: business-facing only — no file names, SQL/table names, HTTP routes-as-identifiers, env-var
 * names, or phase markers. The honesty markers the docs flag (PARTIALLY IMPLEMENTED / unwired / static
 * fixture / flag-gated / NOT IMPLEMENTED) are preserved via each element's `status`, never hidden.
 *
 * AUTHORIZATION REALITY (load-bearing, repeated by every source doc): there are NO role tiers. Access =
 * a valid sign-in (JWT), plus a single hardcoded bootstrap-admin email (johndean@vin.com) gating a handful
 * of destructive/admin surfaces. `roles: STAFF` = any signed-in user; `roles: ADMIN` = the bootstrap-admin
 * email gate (NOT a role column). Consumed by seed-rounds-coverage.ts + eval-rounds-coverage.ts.
 */
import { fld, btn, act, tab, err, faq, wfi, type PageDef, type WorkflowDef } from './coverage-seed.js';

export const PRODUCT = 'rounds.vin';
const STAFF = ['any signed-in user'];                 // JWT presence only — no role tier
const ADMIN = ['admin'];                              // the hardcoded johndean@vin.com bootstrap-admin email gate

export const PAGES: PageDef[] = [
  // ───────────────────────────── Auth ─────────────────────────────
  {
    intentLabel: 'login', screenName: 'Sign in', screenType: 'auth', route: '/#/login', roles: ['public'],
    purpose: 'Email + password sign-in to the VIN Transcript Operations Console. Accounts are created by an administrator — there is no self sign-up, no SSO, and no "forgot password" link. A successful sign-in lands you on the dashboard (or back on the page you were heading to).',
    elements: [
      fld('Email', { required: true, note: 'your VIN email; sign-in is case-insensitive' }),
      fld('Password', { required: true, note: 'case-sensitive' }),
      fld('Keep me signed in for 8 hours', { note: 'static label only — it has no effect; the token lifetime is fixed by the server (~8h)' }, 'dead_ui'),
      btn('Sign in', { triggers: 'authenticates and redirects to the dashboard or the requested page' }),
      err('Incorrect email or password', { recovery: 're-check the exact email + retype the password' }),
      err('Email and password required', { note: 'client-side guard when a field is blank' }),
      faq('I forgot my password — what do I do?', 'Contact your administrator to set a new password. There is no self-serve reset on the sign-in screen.'),
      faq('Is the account locked after failed sign-ins?', 'No. Despite older help copy mentioning a "5 attempts / 15 minutes" lockout, the sign-in screen has no lockout or attempt counter. If you cannot get in, ask your admin to reset your password.'),
      faq('Is there sign-up, SSO, or multi-factor auth?', 'No. Authentication is single-factor email + password; accounts are admin-created. There is no SSO/OAuth or MFA.'),
    ],
  },

  // ───────────────────────────── Dashboard ─────────────────────────────
  {
    intentLabel: 'dashboard', screenName: 'Dashboard', screenType: 'dashboard', route: '/#/dashboard', roles: STAFF,
    purpose: 'The landing screen after sign-in (the site root redirects here). A time-of-day greeting, a six-card KPI strip, a "Your Queue" shortlist, a two-row pipeline visualization (the 7-step AI pipeline + the 8-stage SOP), an operations section, and lower widget cards. Every signed-in user sees the same dashboard.',
    layout: 'KPI strip · Your Queue · AI pipeline row + SOP pipeline row · Operations section · widget rows',
    elements: [
      btn('New upload', { triggers: 'opens the Upload page to start a new session' }),
      act('AI Sessions / SOP Sessions / Segments / Words / CMS Published cards', { detail: 'live counts computed from the session list', note: 'bounded by the 50-session page limit, so they can undercount once you exceed 50 sessions' }, 'live'),
      fld('Improvement RQs card', { note: 'hard-coded 0 — not wired to the Improvements board' }, 'unwired'),
      act('Your Queue (3 cards)', { detail: 'the three MOST RECENT sessions globally — NOT the sessions assigned to you; click a card to open its processing page or editor', note: 'the per-user queue lives at the separate Queue screen' }, 'partial'),
      act('AI pipeline row', { detail: 'Transcribe / Ready / Failed counts are real; Upload / Normalize / Align / Fuse are placeholder 0s; click a step to filter the sessions list' }, 'partial'),
      act('SOP pipeline row', { detail: 'all 8 stages show a real count + an ATTN badge when a stage is overdue; click a stage to filter sessions by that stage' }, 'live'),
      act('Operations KPIs + SLA-by-stage grid', { detail: 'Unresolved Discrepancies, QA Tasks, Storage, Avg Processing, Fusion Runs and the dwell-time grid are static zeros/dashes — there is no time-series store behind them' }, 'dead_ui'),
      act('7d / 30d / 90d / All tabs · All-types / ARAV / NAVAS chips', { note: 'inert — they toggle a local value but filter nothing' }, 'dead_ui'),
      act('Bottom widgets (Age Alerts, Correction Hotspots, Storage, Jobs Queue)', { note: 'render "No data yet." / "Celery queue is empty." — not data-driven' }, 'dead_ui'),
      faq('What do the top cards mean?', 'Live counts of one part of the workflow — total sessions, sessions in review, segment + word totals, and completed/published sessions.'),
      faq('Does "Your Queue" show work assigned to me?', 'No — it shows the three most recent sessions overall. Your own assigned work is on the Queue screen.'),
      faq('Why do trend charts and sparklines look empty?', 'There is no historical time-series store, so the sparklines, the time-range tabs, and the SLA dwell-time grid are decorative chrome only.'),
    ],
  },

  // ───────────────────────────── Sessions ─────────────────────────────
  {
    intentLabel: 'sessions', screenName: 'Sessions', screenType: 'list', route: '/#/sessions', roles: STAFF,
    purpose: 'The master list of every recording in the pipeline. Four KPI tiles (In Workflow / Processing / Published / Total), a search + filter toolbar, and a table of sessions; each row links to its editor or processing screen. Deep-linkable by SOP stage / AI step / free text.',
    elements: [
      fld('Search', { note: 'matches session code, title, or presenter (case-insensitive); Enter runs it against the full list' }),
      act('Filter chips (All / In Workflow / Processing / Published)', { note: 'In-Workflow/Processing key off legacy status values that no longer occur, so those counts can read 0' }, 'partial'),
      fld('Sort dropdown (updated / code / title)', { note: 'bound but never applied — selecting a sort does not re-order the table' }, 'partial'),
      btn('New upload', { triggers: 'opens the Upload page' }),
      btn('Export CSV', { note: 'shows a "download started" toast but generates no file — not wired to any export' }, 'unwired'),
      act('Open a row', { triggers: 'opens the processing page if still processing, else the session detail page' }),
      btn('Delete (per row)', { triggers: 'soft-deletes the session (recoverable 30 days); confirm dialog first', visibleTo: 'shown to everyone but the server allows it only for the bootstrap admin + one external partner account' }, 'partial'),
      btn('Failed · why? pill', { triggers: 'opens a modal with the failure category, recorded reason, recent status changes, and a link to the full audit log' }),
      err('Could not load failure reason', { recovery: 'retry; or open the session audit log' }),
      faq('What does each status chip mean?', 'Processing: still being prepared/transcribed. Ready: finished and the editor is available. Published: completed. Failed: something went wrong — click for details.'),
      faq('Who can delete a session?', 'Soft-delete is restricted server-side to the bootstrap admin and one external partner account; everyone else gets a 403. Restore + permanent purge are admin-only.'),
    ],
  },
  {
    intentLabel: 'session detail', screenName: 'Session Detail', screenType: 'detail', route: '/#/s/:id', roles: STAFF,
    purpose: 'The per-session hub: status + editable code/title header, the files that make up the session, key counts (segments/words/sources/duration), slide alignment, per-stage SOP assignees, and quick links into the Editor / Workflow / Audit.',
    layout: 'header (status, code, title, chips, actions) · meta+downloads · KPIs+AI-mode+files · stage assignments+publishing · timeline · segment widgets',
    elements: [
      act('Edit code / title inline', { triggers: 'click to edit; saves immediately on blur/Enter — no page-level Save' }, 'live'),
      btn('Open Editor', { triggers: 'opens the transcript editor' }), btn('Workflow', { triggers: 'opens the SOP page' }), btn('Audit', { triggers: 'opens the per-session change history' }),
      act('Change session Type', { triggers: 'saves the type, then offers to apply that type’s default stage assignees (replaces existing — confirm first)' }, 'live'),
      act('Reassign / Reset a stage owner', { triggers: 'pick a person or a group per SOP stage; Reset returns it to the type default' }, 'live'),
      act('Add / Update session file (slides, chat, manifest, bios)', { triggers: 'opens the add-file dialog; re-adding a present type replaces it' }, 'live'),
      btn('Download (.docx/.srt/.txt/.zip tiles)', { note: 'warn toast only — the working export is in the Editor’s Download menu' }, 'unwired'),
      act('Publishing-link chips', { note: 'placeholders — clicking warns "not persisted"; publishing-link save is not built' }, 'unwired'),
      act('Chat Participants / Alignment / Segment Confidence / Review Queue cards', { detail: 'read-only summaries; render empty "no data yet" frames before processing finishes' }, 'live'),
      faq('Where do exports come from?', 'Open the Editor and use its Download menu — the download buttons on this page are not wired.'),
      faq('What happens when I change the Type?', 'It saves the new type and offers to re-seed all 8 stage assignees from that type’s matrix, replacing any manual choices (it asks first).'),
    ],
  },

  // ───────────────────────────── Upload & Processing ─────────────────────────────
  {
    intentLabel: 'upload', screenName: 'Upload', screenType: 'form', route: '/#/upload', roles: STAFF,
    purpose: 'Intake for a new session. Attach one or more files (the page infers each file’s role from its name — video/audio/slides/chat/manifest), choose the AI processing options, and click Process; bytes stream straight from your browser to cloud storage, then the session opens on the Processing page.',
    elements: [
      fld('Drop zone / file picker', { note: 'multiple files; role inferred from extension — unknown types fall through to "other" rather than being rejected' }, 'partial'),
      fld('Processing Pipeline (Direct to AI / AI-Enhanced)', { note: 'Direct = Gemini multimodal; Enhanced = transcribe-then-refine (only Enhanced uses the Speech-to-Text option)' }),
      fld('AI Processing Mode (Transcript / Summary / Key Moments / Structured Notes / Custom Prompt)'),
      fld('AI Model', { note: 'defaults to the org default (gemini-2.5-pro); pickable per upload' }),
      fld('Processing Style (Lecture / Training / Technical / Podcast / Sales / custom)'),
      fld('Instructor Intelligence Layer tiers', { detail: 'toggle filler-word cleanup tiers (acoustic fillers, discourse fillers, redundant phrases)' }),
      fld('Saved prompt template picker (custom-prompt mode)', { note: 'options are static — selecting one does not load a stored template' }, 'partial'),
      btn('Process', { triggers: 'creates the session, uploads each file, then opens the processing page; disabled until at least one file is attached' }),
      btn('Remove attachment (×)', { triggers: 'drops a file from this upload before processing' }),
      err('Add at least one file', { note: 'shown if Process is clicked with no files' }),
      err('GCS PUT failed', { recovery: 'retry the upload from this page (no pause/resume)' }),
      err('Rate limit — already at 3 concurrent sessions / queue full', { recovery: 'finish or clean up an in-flight session, then retry' }),
      faq('What file types can I upload?', 'Video (mp4/mov/mkv/webm/avi/m4v), audio (mp3/m4a/wav/ogg/flac/aac), slides (pdf/pptx/ppt), and a .txt chat or manifest. Other extensions are accepted as "other" rather than rejected.'),
      faq('Can I close the tab while it uploads?', 'No — bytes stream from your browser; closing the tab interrupts the upload. There is no pause/resume.'),
      faq('Is there a size or length limit?', 'A 180-minute cap exists server-side but only fires when the client reports a duration, which the upload form does not send — so from this screen it is effectively unenforced.'),
    ],
  },
  {
    intentLabel: 'processing', screenName: 'Processing', screenType: 'other', route: '/#/p/:id', roles: STAFF,
    purpose: 'The live "Building your output" status card shown while a session is ingested/transcribed. Shows a step list (adapts to AI-Direct / AI-Enhanced / Standard), a progress bar with elapsed + estimated-remaining, and a Segments/Markers/Slides metrics panel. On completion it auto-redirects to the editor; on failure it shows a failure card.',
    elements: [
      act('Step list', { detail: 'current step spins; counts of segments/markers/slides fill in live over a websocket (with a 3s polling fallback)' }, 'live'),
      act('Auto-redirect to Editor', { triggers: 'when the session reaches "ready", it opens the editor after a short delay' }),
      btn('Retry', { triggers: 'restarts the whole pipeline from the upload (re-ingest); safe to repeat' }),
      btn('Delete & start over', { triggers: 'soft-deletes the session and returns you to Upload (confirm first)' }),
      act('Failure card', { detail: 'plain-language reason + a category-specific tip (e.g. AI busy → wait and retry; input too large → use audio / a larger model / a shorter clip)' }, 'live'),
      err('AI service busy / over quota', { recovery: 'usually transient — wait a minute or two and click Retry' }),
      faq('Do I have to do anything to start processing?', 'No — processing starts automatically when the upload completes; just watch the page.'),
      faq('My session failed — can I retry without re-uploading?', 'Yes. Retry restarts the pipeline against the already-uploaded media; re-runs are built to be safe to repeat.'),
    ],
  },

  // ───────────────────────────── Editor ─────────────────────────────
  {
    intentLabel: 'editor', screenName: 'Editor', screenType: 'other', route: '/#/e/:id', roles: STAFF,
    purpose: 'The transcript correction workspace: video + slide rail on the left, the transcript in the center (AI Transcript / STT Reference / Discrepancies / Audit tabs), reference + chat/poll tools on the right. Edits are append-only — undo/redo move a pointer, nothing is destroyed. One person edits at a time via a 90-second lock.',
    layout: 'left: video + slide rail · center: tabbed transcript panes · right: Active-slide + Admin/Chat/Polls rail',
    elements: [
      act('Edit a segment', { triggers: 'click Edit, type, Save — autosaves on a debounce; records a text edit', note: 'gated on holding the session lock' }, 'live'),
      act('Reassign slide', { triggers: 'pick the correct slide from a tile grid' }), act('Reassign speaker', { triggers: 'pick from the session speakers' }),
      btn('Undo / Redo', { triggers: 'move the session-wide ledger pointer back/forward (also Cmd/Ctrl+Z, Shift+Z, Ctrl+Y); nothing is deleted' }),
      btn('Find & Replace', { triggers: 'bulk text edit across the transcript with a dry-run preview (Cmd/Ctrl+F)' }),
      act('Flag filter chips (Medication / Name / Number / Filler / Punctuation / Drift …)', { note: 'Name/Number/Date/Style have no data source, so those chips read 0' }, 'partial'),
      act('Split / Merge segments', { note: 'hidden unless a configuration switch is on (off by default); when off the action is unavailable and the API returns 503' }, 'partial'),
      btn('Download menu (Word .docx / Captions .srt / Plain Text .txt / Word Macro .zip)', { triggers: 'regenerates the file fresh from the current transcript and downloads it' }),
      btn('Force-take lock', { visibleTo: 'admin only (bootstrap-admin email)', triggers: 'steals a held edit lock', note: 'UI-gated by email; the server is authoritative' }, 'partial'),
      act('Follow-video toggle / J-K-L playback keys', { detail: 'auto-scroll the transcript with playback; J/L seek ±10s, K play/pause' }),
      err('Read-only — session held by another editor', { recovery: 'wait out the 90s lock TTL or ask an admin to force-take' }),
      err('Lock service unavailable', { recovery: 'editing fails closed to read-only; click Retry on the banner' }),
      faq('Can two people edit at once?', 'No — editing is single-writer via a 90-second lock. A second person drops to read-only and sees who holds it; an admin can force-take.'),
      faq('Can I split or merge segments?', 'Only if the split/merge configuration switch is enabled (off by default). With it off the controls are hidden and the action is refused.'),
      faq('How far back does the edit history go?', 'To the moment the session was created — the correction ledger is append-only and is never deleted.'),
    ],
  },
  {
    intentLabel: 'sop workflow', screenName: 'SOP Workflow', screenType: 'other', route: '/#/e/:id/sop', roles: STAFF,
    purpose: 'The per-session review board. Shows the current SOP stage, a clickable 8-stage stepper, the stage owner + dwell time + overdue badge, acceptance checks, approvals, and the transition history. Any signed-in user can advance, reassign, annotate, or resolve checks — there is no admin gate on the workflow.',
    elements: [
      btn('Advance', { triggers: 'moves the session exactly one stage forward (forward-only; confirm dialog); records who + when', note: 'the in-page button stays gated because acceptance checks display "pending" and never flip to pass in the current build' }, 'partial'),
      btn('Reassign owner', { triggers: 'enter an email or "group:NAME" to reassign the current stage; audited' }, 'live'),
      btn('Add note / Override with reason', { triggers: 'append an annotation to the stage (append-only, audited)' }, 'live'),
      btn('Resolve check', { triggers: 'records that a failing acceptance check was cleared' }, 'partial'),
      btn('Ping owner', { note: 'not wired — shows a warn toast; there is no Slack/messaging integration' }, 'unwired'),
      act('Approvals card', { note: 'derived synthetically from the current stage index — not real sign-off records' }, 'partial'),
      act('Overdue badge (+Nh OVERDUE)', { detail: 'computed from time-in-stage vs the per-stage SLA; refreshed by a deadline websocket event' }, 'live'),
      faq('What are the 8 stages?', 'Prep → Copy Draft → Medical → Copy Final → CMS → Captions → QA → Complete. A session moves forward one stage at a time; no skipping and no going backward.'),
      faq('Why is the Advance button greyed out?', 'Advancing is gated by the stage’s acceptance checks, which stay "pending" in the current build — a known limitation, not a problem with your session.'),
      faq('Is advancing restricted to admins?', 'No — any signed-in user can advance, reassign, annotate, or resolve checks. The SOP workflow has no role gate.'),
    ],
  },
  {
    intentLabel: 'editor audit', screenName: 'Word Track Changes (session audit)', screenType: 'report', route: '/#/e/:id/audit', roles: STAFF,
    purpose: 'The per-session correction ledger — an append-only, read-only list of every edit (text edit, slide/speaker reassignment, chat/poll move, find-replace) with who, when, and before/after. KPIs, type filters, and a client-side JSONL export.',
    elements: [
      act('Filter by correction type', { detail: 'chips filter the ledger rows (text edit, chat insert/edit, poll insert, slide/speaker reassignment, …)' }),
      btn('Export JSONL', { triggers: 'downloads the loaded ledger as a JSONL file (client-side; no server call)' }),
      act('KPIs', { detail: 'Total Corrections · Text Edits · Non-dirty Corrections · Distinct Actors' }),
      faq('Can the edit history be altered or deleted?', 'No. The ledger is append-only; undo/redo only move a pointer, the rows themselves are never changed.'),
      faq('Who can view and export the ledger?', 'Any signed-in user — there is no admin gate on the audit view.'),
    ],
  },
  {
    intentLabel: 'viewer', screenName: 'Viewer / Preview', screenType: 'reference', route: '/#/v/:id', roles: STAFF,
    purpose: 'A read-only "Export Preview" of a finished session laid out the way it will read once published: a slide-by-slide render of the transcript with speaker labels, the available export formats, a publishing checklist, and an optional key-points section. Read-only for everyone.',
    elements: [
      act('Slide-by-slide transcript render', { detail: 'each slide shows the speech spoken over it; slides with no speech show "( no audio )"' }),
      fld('Include key points section', { triggers: 'toggles a key-points block in the preview (local only)' }),
      btn('Editor', { triggers: 'opens the same session in the editor' }),
      btn('Export-format cards (Word / Captions / Plain Text / Word Macro)', { note: 'not wired — clicking warns the real export ships later; use the Editor’s Download menu' }, 'unwired'),
      act('Publishing checklist (Zoom / Slides / Podbean / VINcast / Intranet / Message board / Session page)', { note: 'reference list — the links are not active' }, 'unwired'),
      faq('Can I edit from the Viewer?', 'No — it is read-only. Use the Editor button to make changes.'),
      faq('Why did clicking a download do nothing?', 'Viewer downloads are not wired in this build — use the Editor’s Download menu to get a file.'),
    ],
  },

  // ───────────────────────────── Queue · Improvements · Audit · GCS ─────────────────────────────
  {
    intentLabel: 'queue', screenName: 'My Queue', screenType: 'list', route: '/#/queue', roles: STAFF,
    purpose: 'Your personal work queue — the sessions where you are the assignee for that session’s current SOP stage, longest-waiting first, with time-in-stage and an OVERDUE pill past the SLA. Scoped per-user by the server; it refreshes in the background every 30 seconds.',
    elements: [
      act('Open a queue row', { triggers: 'opens that session’s SOP workflow tab' }),
      act('OVERDUE pill (+Nh)', { detail: 'shown when the stage is past its SLA' }),
      act('Background refresh', { detail: 'polls every 30s and on tab refocus; no manual refresh button' }),
      faq('What shows up in My Queue?', 'Sessions where you are the assignee of the current SOP stage. It excludes soft-deleted sessions, completed sessions, and group assignments.'),
      faq('Can I see someone else’s queue?', 'No — the queue is filtered to the email in your sign-in; there is no parameter to view another user’s queue.'),
    ],
  },
  {
    intentLabel: 'improvements', screenName: 'Improvements', screenType: 'list', route: '/#/improvements', roles: STAFF,
    purpose: 'A shared backlog of change requests about the app — enhancements, bug reports, operator suggestions. A status-tabbed, searchable master list with a detail "Action Plan Builder" pane. Any signed-in user can file, browse, search, and delete. (It is NOT automatic pattern detection — every entry is typed in by a person.)',
    elements: [
      btn('Suggest Improvement', { triggers: 'opens a form (Title required, Surface, Priority, Description); your name is attached automatically' }),
      fld('Search', { note: 'filters the loaded list by title substring' }),
      act('Status tabs (All / Pending / Under Review / Approved / In Progress / Rolled Out / Declined / Archived)', { note: 'three tabs use hyphenated ids that don’t match the stored underscored statuses, so they can read 0 — use All + search' }, 'partial'),
      btn('Delete (Del)', { triggers: 'soft-deletes the request (confirm first); hidden from view, not erased' }),
      act('Action Plan Builder (Overview / Requirements / Implementation / Testing / Review)', { note: 'display + draft only — Save Changes, Regenerate, and the AI-model picker are not wired (warn toasts); the per-item detail body is templated client-side, not fetched' }, 'unwired'),
      faq('Is this where the app suggests corrections to my transcripts?', 'No — it is a human-filed change-request backlog. It does not watch your editing or propose automatic fixes.'),
      faq('Why do some status tabs show 0?', 'A few tabs label statuses slightly differently than they are stored, so they cannot match. Use the All tab and search to find any request reliably.'),
    ],
  },
  {
    intentLabel: 'audit log', screenName: 'System Audit Log', screenType: 'report', route: '/#/audit', roles: STAFF,
    purpose: 'The global, system-wide activity ledger (SOP deadline warnings, settings changes, improvement events, alignment-gate failures, …) — append-only and read-only, with KPIs, kind filters, and a client-side JSONL export. Reachable by deep link; despite being system-wide it is JWT-only, not admin-gated.',
    elements: [
      act('Filter by kind', { detail: 'chips derived from the kinds actually present in the data' }),
      btn('Export JSONL', { triggers: 'downloads the loaded events as a JSONL file (client-side)' }),
      act('KPIs', { detail: 'Total Events · Distinct Kinds · SOP Deadline Warnings · Distinct Actors' }),
      faq('Is the audit log admin-only?', 'No — the global system audit log requires only a valid sign-in; it carries no admin gate.'),
      faq('Can audit rows be edited or removed?', 'No — the event log is append-only; rows are never updated or deleted.'),
    ],
  },
  {
    intentLabel: 'gcs qa', screenName: 'GCS Pipeline QA', screenType: 'report', route: '/#/gcs', roles: STAFF,
    purpose: 'A read-only "14 checks across the storage-ingestion plane" ledger with KPI tiles. IMPORTANT: this standalone page is a STATIC fixture — the rows, pass/fail flags, latencies, cadence and uptime numbers are hard-coded and it makes no live call. For live probe results use Settings → Diagnostics → GCS Pipeline QA.',
    elements: [
      act('14-check ledger (KPI tiles + rows)', { note: 'static fixture — no API call; 13/14 "pass", one "retrying" are literal display values' }, 'dead_ui'),
      faq('Is the /gcs page showing live results?', 'No — it is a static fixture. For live checks, open Settings → Diagnostics → GCS Pipeline QA, which runs a real probe suite.'),
    ],
  },

  // ───────────────────────────── Admin Help Editor ─────────────────────────────
  {
    intentLabel: 'help editor', screenName: 'Help Editor (admin)', screenType: 'other', route: '/#/admin/help', roles: ADMIN,
    purpose: 'The Help Center CMS: a filterable list of all help articles, a coverage report, an article editor with automatic version history + restore, a per-article CC-Rounds compliance meter, and a bulk-AI toolbar. Admin-only — the only screen with an active client-side admin gate (the bootstrap-admin email), re-checked on the server for every write.',
    elements: [
      btn('New article / Edit / History / Archive', { triggers: 'create, edit, view+restore prior versions, or soft-unpublish an article' }),
      btn('Publish all drafts', { triggers: 'publishes only the drafts that pass CC-Rounds compliance; returns a skipped list with reasons' }),
      btn('Fix CC-Rounds / Expand Steps / Expand FAQs / Generate FAQ corpus', { triggers: 'enqueue Gemini bulk tasks; output lands as DRAFTS for review — nothing auto-publishes' }),
      act('Filters (Audience / Domain / Status / Search)', { detail: 'audience+domain re-query the server; status+search filter client-side' }),
      act('Coverage report + compliance meter', { detail: 'per-domain published counts; per-article word/summary/step-count compliance' }),
      faq('Who can open the Help Editor?', 'Only the bootstrap admin (the hardcoded johndean@vin.com email). Non-admins are redirected to the dashboard, and every write is re-checked on the server.'),
      faq('Are AI-generated articles published automatically?', 'No — every AI rewrite/draft is saved unpublished and must be manually published by an admin.'),
    ],
  },

  // ───────────────────────────── Settings shell + 13 sections ─────────────────────────────
  {
    intentLabel: 'settings', screenName: 'Settings', screenType: 'settings', route: '/#/settings', roles: STAFF,
    purpose: 'The workspace control panel — a left nav of 13 deep-linkable sections with the active section’s form on the right. The shell opens for any signed-in user; several sections are admin-gated server-side and show an "Admin only" banner / refuse to save for non-admins.',
    elements: [
      act('Section nav (13 sections)', { detail: 'General, Team & roles, Types & stage defaults, AI models, Upload & storage, Discrepancy classification, Export, Prompt templates, Session manifest, Email, Auth & logins, Diagnostics, Deleted sessions' }),
      faq('Why can I open Settings but not change anything?', 'The page opens for any signed-in account, but several sections run admin-only operations server-side; without admin access they load empty and saves are refused.'),
      faq('Is admin a role here?', 'No — "admin" is the single hardcoded bootstrap-admin email gate. The stored role column is not consulted at request time.'),
    ],
  },
  {
    intentLabel: 'settings general', screenName: 'Settings · General', screenType: 'settings', route: '/#/settings/general', roles: STAFF,
    purpose: 'Edit workspace identity: organisation name, default locale, and default time zone. Save writes all three.',
    elements: [
      fld('Organisation name'), fld('Default locale'), fld('Default time zone'),
      btn('Save', { triggers: 'persists org name + locale + timezone' }),
      faq('Do General settings need admin?', 'No — the org key/value settings (name, locale, time zone) are not admin-gated; any signed-in user can change them.'),
    ],
  },
  {
    intentLabel: 'settings team', screenName: 'Settings · Team & roles', screenType: 'settings', route: '/#/settings/team', roles: STAFF,
    purpose: 'Two-pane People + Groups management: add/edit/remove people (name, email, role label, avatar color) and add/rename/remove groups with member chips. These feed the stage-assignee pickers elsewhere.',
    elements: [
      btn('Add person', { triggers: 'creates a person; disabled until a name + a valid email are entered' }),
      act('Edit / remove person'), btn('Add group / rename / remove'), act('Add / remove group member'),
      faq('Why isn’t my new teammate a stage-assignee option?', 'The Types section hydrates its assignee dropdown live from the people list, so a new person appears without a reload (if not, the people fetch failed).'),
    ],
  },
  {
    intentLabel: 'settings types', screenName: 'Settings · Types & stage defaults', screenType: 'settings', route: '/#/settings/types', roles: ADMIN,
    purpose: 'Manage session Types and, per Type, an 8-stage assignee matrix (a person or group per SOP stage, with an email-on-entry checkbox). New sessions inherit the selected Type’s matrix. Add/remove Type and saving the matrix are admin-gated.',
    elements: [
      btn('Add type', { triggers: 'creates a session Type (admin)' }),
      act('Stage assignee matrix (8 stages)', { detail: 'pick a person or group per stage; check Email to notify on entry' }),
      btn('Save matrix', { triggers: 'replaces all 8 assignee rows for the Type (admin)' }),
      err('Default type cannot be deleted', { note: 'the default Type is locked from deletion' }),
      faq('Do stage-default changes affect existing sessions?', 'No — defaults apply to sessions created after the change; existing sessions keep the values they started with.'),
    ],
  },
  {
    intentLabel: 'settings ai models', screenName: 'Settings · AI models', screenType: 'settings', route: '/#/settings/ai-models', roles: STAFF,
    purpose: 'Pick the org-wide default AI model used to prefill the model picker for new AI-mode sessions. Saves on change.',
    elements: [
      fld('Default AI model', { note: 'default is gemini-2.5-pro (its larger context fits a long video + big slide deck)' }),
      faq('Does this force every session to that model?', 'No — it is the default for new AI-mode sessions and is overridable per upload.'),
    ],
  },
  {
    intentLabel: 'settings upload', screenName: 'Settings · Upload & storage', screenType: 'settings', route: '/#/settings/upload', roles: STAFF,
    purpose: 'Choose the upload transport: direct browser-to-cloud-storage (default) versus routing bytes through the server.',
    elements: [
      fld('Upload backend (cloud-direct / server-routed)', { note: 'production default is cloud-direct for large videos' }),
      faq('Why upload straight to cloud storage?', 'Routing 200MB+ videos through the server is slower and less reliable; a direct signed upload bypasses the server.'),
    ],
  },
  {
    intentLabel: 'settings discrepancy', screenName: 'Settings · Discrepancy classification', screenType: 'settings', route: '/#/settings/discrepancy', roles: STAFF,
    purpose: 'Configure the discrepancy classifier — which backend labels AI-vs-reference diffs as meaningful, and which model it uses. Separate from the main transcription model and billed independently.',
    elements: [
      fld('Classify backend (developer API / Vertex AI)', { note: 'developer API by default; Vertex is a separate billing/quota path' }),
      fld('Classify model'),
      faq('Can I route classification billing separately?', 'Yes — switching the backend to Vertex uses a distinct key/quota from the main transcription model.'),
    ],
  },
  {
    intentLabel: 'settings export', screenName: 'Settings · Export', screenType: 'settings', route: '/#/settings/export', roles: STAFF,
    purpose: 'Toggle whether a key-points section is included in exports, and download the one-time Word VBA macro bundle.',
    elements: [
      fld('Include key points in export'),
      btn('Download macro (.zip)', { triggers: 'downloads the Word macro bundle' }),
      err('Macro bundle not deployed yet', { note: 'shown if the bundle is absent (404)' }),
      faq('What is the macro bundle for?', 'It is the macro-compatible Word tooling used in the CMS prep workflow.'),
    ],
  },
  {
    intentLabel: 'settings prompts', screenName: 'Settings · Prompt templates', screenType: 'settings', route: '/#/settings/prompts', roles: ADMIN,
    purpose: 'CRUD catalog for two template kinds — Speech-to-Text presets and Gemini system prompts — plus binding a prompt template as the live default for an AI mode. The active transcript prompt is read on every upload. Template create/update/delete are admin-gated.',
    elements: [
      btn('New / Edit / Duplicate / Delete template'),
      fld('Default-for-mode binding', { detail: 'bind an AI-prompt template as the live default for transcript/summary/etc. (one default per mode)' }),
      err('System template is locked', { note: 'built-in system templates cannot be deleted; duplicate to edit' }),
      faq('Where does the live transcription prompt come from?', 'From the prompt template bound as the default for the transcript mode — editing it changes what the AI receives on the next upload.'),
    ],
  },
  {
    intentLabel: 'settings manifest', screenName: 'Settings · Session manifest', screenType: 'reference', route: '/#/settings/manifest', roles: STAFF,
    purpose: 'A static reference doc describing the producer-prepared session manifest text file — its expected fields and filename conventions. Read-only reference; no inputs.',
    elements: [
      act('Manifest field reference', { detail: 'expected fields + filename conventions for the uploaded manifest', note: 'static documentation — no form, no save' }, 'dead_ui'),
      faq('What does the manifest populate?', 'Session metadata (titles, ids, tags, publishing links), speaker bios, and parsed polls when the manifest file is uploaded with the session.'),
    ],
  },
  {
    intentLabel: 'settings email', screenName: 'Settings · Email', screenType: 'settings', route: '/#/settings/email', roles: ADMIN,
    purpose: 'Per-Type × per-Stage HTML email templates with live preview and a variable palette, plus a test send. A null-Type row is the default for all Types; per-Type rows override it. Template edits and the test send are admin surfaces.',
    elements: [
      btn('Open builder', { triggers: 'opens the per-Type/per-Stage template editor with preview' }),
      act('Edit subject + HTML body', { detail: 'variables are HTML-escaped in the body for safety; preview renders in a sandboxed frame' }),
      btn('Send test to my email', { triggers: 'renders sample variables and sends a real test message (admin email-debug path)' }),
      btn('Remove override · revert', { triggers: 'soft-deletes a per-Type override and falls back to the default template' }),
      faq('Do stage-transition emails fire automatically?', 'Deadline (overdue) emails fire when enabled by a configuration switch (off by default); the stage-transition templates are seeded but not wired to an automatic sender.'),
    ],
  },
  {
    intentLabel: 'settings auth users', screenName: 'Settings · Auth & logins', screenType: 'settings', route: '/#/settings/auth-users', roles: ADMIN,
    purpose: 'Manage login accounts: add (email + a ≥10-char initial password + role label), toggle admin/user, disable/enable, reset password (never echoed back), and delete. Includes a "Seed from environment" recovery panel when the table is empty. Admin-gated server-side.',
    elements: [
      btn('Add user', { triggers: 'creates a login; password must be ≥10 characters' }),
      act('Make admin / Make user · Disable / Enable'),
      btn('Reset password', { triggers: 'sets a new ≥10-char password; bcrypt-hashed, never shown again' }),
      btn('Delete', { triggers: 'removes the login (confirm first); refuses to remove the only active admin' }),
      btn('Seed from AUTH_USERS env', { triggers: 'idempotent recovery seed when the login table is empty' }),
      err('Admin only — your account does not have access', { note: 'non-admins get a 403 here and see the list cleared' }),
      err('Cannot demote or disable the only active admin', { recovery: 'add a second admin first' }),
      faq('I made a user an admin — do they have admin powers now?', 'Not at runtime. The role column is written but never read; effective admin is still the single hardcoded email gate.'),
      faq('Can I see a user’s current password?', 'No — passwords are bcrypt-hashed and never shown. If one is lost, reset it.'),
    ],
  },
  {
    intentLabel: 'settings diagnostics', screenName: 'Settings · Diagnostics', screenType: 'settings', route: '/#/settings/diagnostics', roles: STAFF,
    purpose: 'Operational tools: reset your own stale rate-limit slots, open the live GCS Pipeline QA probe, and open the test-email page. The telemetry counters shown here (heap, RTT, uptime) are static display text, not live metrics.',
    elements: [
      btn('Reset my stale slots', { triggers: 'sweeps your active-session slots, removing ones whose session is deleted/gone; reports how many cleared' }),
      btn('Open GCS QA', { triggers: 'mounts the LIVE GCS probe table (6 real probes + 8 deferred stubs)' }),
      btn('Open test email page', { triggers: 'mounts the SMTP diagnostics (config, connectivity probe, test send, attempts ledger) — admin' }),
      act('Telemetry counters', { note: 'static literals (heap / RTT / uptime), not live telemetry' }, 'dead_ui'),
      faq('I keep hitting a 429 after deleting sessions — can I fix it myself?', 'Yes — "Reset my stale slots" clears slots whose sessions are soft-deleted or gone, for your own account, no admin required.'),
    ],
  },
  {
    intentLabel: 'settings deleted', screenName: 'Settings · Deleted sessions', screenType: 'settings', route: '/#/settings/deleted', roles: ADMIN,
    purpose: 'Recover soft-deleted sessions within a 30-day window — list, restore, or permanently purge. Admin-gated server-side; non-admins see an "Admin-only" banner.',
    elements: [
      act('List deleted sessions', { detail: 'soft-deleted within the last 30 days, with an "N/30 days elapsed" counter' }),
      btn('Restore', { triggers: 'clears the deletion and returns the session to the active list (confirm)' }),
      btn('Permanent delete', { triggers: 'hard-deletes irreversibly; requires prior soft-delete (confirm)' }),
      err('Admin-only', { note: 'non-admins get a 403 banner here' }),
      faq('How long are deleted sessions recoverable?', 'Restorable for 30 days; after that only append-only audit entries persist. Permanent purge cannot be undone.'),
    ],
  },
];

export const WORKFLOWS: WorkflowDef[] = [
  { name: 'Recording to published transcript', businessPurpose: 'The full arc: upload a recording, let the AI pipeline produce a first-pass transcript, correct it, walk it through the 8-stage SOP review, and preview it for publishing.', stakeholderType: 'transcript operator', personaType: 'operator', sequence: ['login', 'upload', 'processing', 'editor', 'sop workflow', 'viewer'], successCriteria: 'A session goes from uploaded media to a reviewed, preview-ready transcript.' },
  { name: 'Upload and ingest a session', businessPurpose: 'Bring a new recording (plus optional slides/chat/manifest) into the system and watch the AI pipeline run to ready.', stakeholderType: 'transcript operator', personaType: 'operator', sequence: ['login', 'upload', 'processing'], successCriteria: 'The session reaches "ready" and the editor opens automatically.' },
  { name: 'Correct a transcript', businessPurpose: 'Fix transcript text, slide alignment, and speaker attribution in the editor with full append-only undo/redo.', stakeholderType: 'copy editor', personaType: 'editor', sequence: ['editor', 'editor audit'], successCriteria: 'Edits are saved as append-only corrections and the change history is reconstructable.' },
  { name: 'Review AI discrepancies', businessPurpose: 'Work the AI-vs-reference diffs in priority order, marking the correct ones OK and fixing the wrong ones.', stakeholderType: 'copy editor', personaType: 'reviewer', sequence: ['editor'], successCriteria: 'Meaningful discrepancies are resolved; a text edit or "mark OK" auto-closes the flag.' },
  { name: 'Drive the SOP workflow', businessPurpose: 'Advance a ready transcript forward through the 8 review stages, one stage at a time, with owners and SLAs.', stakeholderType: 'medical reviewer', personaType: 'reviewer', sequence: ['sop workflow'], successCriteria: 'The session advances forward-only with every move recorded; backward moves and jumps are rejected.' },
  { name: 'Assign stage owners', businessPurpose: 'Set who is responsible for each SOP stage on a session, or apply a session Type’s default assignee matrix.', stakeholderType: 'administrator', personaType: 'operator', sequence: ['session detail', 'sop workflow'], successCriteria: 'Each stage has the right person or group; applying type defaults re-seeds all 8 stages.' },
  { name: 'Export the finished transcript', businessPurpose: 'Generate a downloadable transcript (Word / captions / plain text / macro bundle) fresh from the current edits.', stakeholderType: 'copy editor', personaType: 'operator', sequence: ['editor', 'viewer'], successCriteria: 'A file downloads that reflects the latest edits; captions stay aligned to the audio.' },
  { name: 'Manage logins (admin)', businessPurpose: 'Create, disable, reset, and delete sign-in accounts, protecting the last active admin.', stakeholderType: 'administrator', personaType: 'administrator', sequence: ['settings', 'settings auth users'], successCriteria: 'Accounts are managed; the only active admin cannot be removed.' },
  { name: 'Recover a deleted session (admin)', businessPurpose: 'Restore or permanently purge a soft-deleted session within the 30-day window.', stakeholderType: 'administrator', personaType: 'administrator', sequence: ['sessions', 'settings deleted'], successCriteria: 'A soft-deleted session is restored (or irreversibly purged) by an admin.' },
  { name: 'Rescue a stuck session (operator)', businessPurpose: 'Re-ingest, re-align, or force-abort a session that is stuck, from the editor Admin rescue panel.', stakeholderType: 'operator', personaType: 'operator', sequence: ['processing', 'editor'], successCriteria: 'A stuck session is restarted or cleanly failed so it can be retried or removed.' },
  { name: 'Configure stage-deadline emails (admin)', businessPurpose: 'Author per-Type/per-Stage email templates and set which stages notify on entry/overdue.', stakeholderType: 'administrator', personaType: 'administrator', sequence: ['settings', 'settings email', 'settings types'], successCriteria: 'Templates are saved and (when the switch is on) overdue stages email their assignee — at most once per stage per day.' },
];

export const EXTRA_KNOWLEDGE: { content: string; category?: string; source: string }[] = [
  { content: 'rounds.vin is transcript software for VIN (Veterinary Information Network). An operator uploads a recorded lecture/session; an AI pipeline produces a first-pass transcript with speaker labels and slide alignment; then a human 8-stage workflow walks it through editorial and medical review before export to a downstream CMS. It is single-tenant: no organizations, sites, vendors, or projects — the session list is one shared backlog. It processes uploaded recordings, not live audio.', source: 'rounds.vin product overview' },
  { content: 'Authorization in rounds.vin is NOT role-based. There are exactly two principals: any signed-in user (a valid login is the only check on the large majority of screens and actions), and a single bootstrap admin — the hardcoded email johndean@vin.com — which gates a handful of admin surfaces (auth-user management, session types, prompt + email templates, deleted-session restore/purge, editor lock force-take, and the Help Editor). A stored role field exists but is never read at request time, so making another account "admin" grants no admin power. One narrow carve-out lets the admin plus one external partner account (carlab@vin.com) soft-delete sessions.', category: 'reference', source: 'rounds.vin permissions reality' },
  { content: 'A session’s processing status moves through a locked state machine: uploading → transcribing → normalizing → fusing → aligning → ready → complete, with an AI-direct shortcut uploading → ready, and "failed" reachable from any stage. "failed" and "complete" are terminal. The legacy words ingesting/processing/published/archived are NOT statuses (in the UI, "archived" just means soft-deleted).', category: 'reference', source: 'rounds.vin session status dictionary' },
  { content: 'The SOP review workflow has 8 stages, advanced forward-only one at a time: Prep → Copy Draft → Medical → Copy Final → CMS → Captions → QA → Complete. Default SLA windows per stage: prep 8h, copy draft 24h, medical 48h (the longest, by design), copy final 24h, cms 12h, captions 12h, qa 8h, complete 0h (terminal — never overdue). A session can carry per-session SLA overrides.', category: 'reference', source: 'rounds.vin SOP workflow reference' },
  { content: 'Four capabilities ship behind configuration switches that are OFF by default: segment Split/Merge (when off the controls are hidden and the action is refused), Help Center "Ask AI" (when off the tab shows "coming soon"), SOP deadline emails (when off, overdue stages are still counted and warned in-app but no email is sent), and the stuck-upload auto-recovery watchdog (when off, recovery is a manual admin re-ingest). An admin flips these in the deployment environment — no code change.', category: 'reference', source: 'rounds.vin feature flags' },
  { content: 'Two processing pipelines exist, chosen per session at upload. "Direct" sends media + slides straight to Gemini multimodal and jumps to ready. "Enhanced" runs the classic chain — transcribe (Google Speech-to-Text), then anchor/normalize/fuse/align — with a Gemini refine pass. Both produce the same output shape (segments, words, slides, speakers, alignment, discrepancies). The default model is gemini-2.5-pro because its larger context fits a long video plus a big slide deck.', category: 'reference', source: 'rounds.vin processing pipeline' },
  { content: 'Edit history is append-only and fully attributed. Every transcript edit is recorded as a correction with the editor’s email and timestamp; undo and redo only move a per-session pointer — rows are never altered or deleted. Applying a text edit or "mark OK" at a flagged segment auto-closes that discrepancy; other correction types do not. The history goes back to the moment the session was created.', category: 'reference', source: 'rounds.vin corrections + audit' },
  { content: 'Uploads are confined to a session’s own storage area: the system rejects any file path outside that session’s folder. Per-user rate limits cap work in flight — at most 3 concurrent sessions per user and 10 in the global queue; exceeding either returns a "Slow down" (429). If the rate-limit store is briefly unreachable the check is skipped rather than blocking uploads.', category: 'reference', source: 'rounds.vin storage scope + rate limits' },
  { content: 'Reporting is current-state only — there is no time-series store. The dashboard aggregates over the session list and SOP state on load. So trend charts, sparklines, the SLA dwell-time grid, per-operator productivity, and cost tracking do not exist; the genuinely durable reporting surfaces are the append-only audit ledger and the per-session correction history. There is no built-in exportable report (screenshot / print-to-PDF only).', category: 'reference', source: 'rounds.vin reporting limits' },
  { content: 'Filler words ("um", "uh") are removed during AI normalization, so they are absent from the Word (.docx) and plain-text (.txt) exports. Caption files (.srt / .vtt) preserve the spoken words so the captions stay aligned to the audio. Every export is regenerated fresh from the current transcript at download time — there is no stale cached file. The Editor’s Download menu offers Word, Captions, Plain Text, and a Word-macro bundle; the in-player caption track refreshes the moment a correction lands.', category: 'reference', source: 'rounds.vin exports' },
  { content: 'Operators rescue stuck sessions from the editor’s Admin tab: Re-Ingest (restart the whole pipeline from the upload), Re-Align (rebuild just the slide-to-segment matches), Init Session Stages (assign SOP stages to a legacy session), Auto-Place Polls (backfill poll anchors), and Abort (force a hung session to failed so it can be cleaned up). Each confirms before firing; re-runs are built to be safe to repeat. Deeper recovery uses operator-only diagnostic tools.', category: 'reference', source: 'rounds.vin operator rescue' },
  { content: 'The Help Center is the in-app help drawer (This page / FAQ / Ask AI tabs plus search), opened from the question-mark button in the top bar and closed with Esc. Tips are matched to the page you are on and to whether your account is the admin. "Ask AI" only works when its configuration switch is enabled (otherwise the tab shows "coming soon"), and when on it has an hourly per-user question cap.', category: 'reference', source: 'rounds.vin help center' },
];
