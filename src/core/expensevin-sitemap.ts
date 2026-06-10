/**
 * expense.vin — DETERMINISTIC full-coverage sitemap (authoritative source for 100% Knowledge + Demo Graph
 * coverage). Hand-transcribed from the code-grounded EXPENSE.VIN Knowledge Center (role guides + the 23
 * per-screen page decompositions + approval/policy/status/error/integration dictionaries). Every documented
 * screen is represented with its purpose, fields, buttons, actions, tabs, errors and FAQs — zero gaps.
 *
 * FIREWALL: business-facing only — no RPC names, file names, SQL, or raw error codes. Honesty markers from
 * the docs (DEAD UI / UNWIRED / PARTIALLY IMPLEMENTED / NOT IMPLEMENTED) are preserved via each element's
 * `status`, never hidden. Consumed by seed-expensevin-coverage.ts + eval-expensevin-coverage.ts.
 */
import { fld, btn, act, tab, err, faq, wfi, type PageDef, type WorkflowDef } from './coverage-seed.js';

export const PRODUCT = 'expense.vin';
const ALL = ['employee', 'manager', 'accounting', 'admin', 'auditor'];

export const PAGES: PageDef[] = [
  // ───────────────────────────── Auth ─────────────────────────────
  {
    intentLabel: 'login', screenName: 'Login', screenType: 'auth', route: '/login', roles: ['public'],
    purpose: 'Email + password sign-in against the Expense Reimbursement Hub. Your role (Employee / Manager / Accounting / Admin) comes from the account, not a choice at login.',
    elements: [
      fld('Email', { required: true }), fld('Password', { required: true }),
      fld('Keep me signed in', { note: 'shown but not functional — session persistence is unconditional' }, 'dead_ui'),
      fld('Forgot password?', { note: 'shows an advisory only — password resets are handled by your administrator' }, 'partial'),
      btn('Sign in', { triggers: 'authenticates and opens your dashboard' }),
      err('Email or password is incorrect', { recovery: 're-enter credentials' }),
      err('Too many attempts — account locked for 15 minutes', { recovery: 'wait 15 minutes' }),
      faq('Is there a forgot-password flow?', 'No self-serve reset — your administrator handles password resets.'),
      faq('Can I pick my role at login?', 'No — your role is assigned to your account by an administrator.'),
    ],
  },
  // ───────────────────────────── Role dashboards (dispatched at /dashboard) ─────────────────────────────
  {
    intentLabel: 'employee dashboard', screenName: 'Employee Overview', screenType: 'dashboard', route: '/dashboard', roles: ['employee'],
    purpose: 'The employee home ("My Hub") — a personalized greeting, a clarification alert, four KPI cards, and a recent-reports table, all scoped to your own reports.',
    elements: [
      btn('New report', { triggers: 'opens the report wizard' }),
      btn('Review (clarification)', { visibleWhen: 'you have reports needing changes', triggers: 'opens your clarifications' }),
      act('Stat tiles', { detail: 'In flight · Reimbursed YTD · Drafts · Needs attention (each navigates)' }),
      faq('What counts toward Reimbursed YTD?', 'Net reimbursable summed over your reimbursed and closed reports.'),
      faq('Why is "Needs attention" highlighted?', 'It is highlighted when you have reports returned for clarification.'),
    ],
  },
  {
    intentLabel: 'manager dashboard', screenName: 'Manager Approvals', screenType: 'dashboard', route: '/dashboard', roles: ['manager'],
    purpose: 'The manager home — reports submitted by your team (and anyone whose approvals are delegated to you) awaiting the manager stage, plus KPI cards. You open a report to act on it.',
    elements: [
      act('Stat tiles', { detail: 'Awaiting your approval · In clarification · Team members · Approved (cycle)' }),
      act('Open pending report', { triggers: 'opens the report detail where approve/clarify/reject happen' }),
      faq('Can I approve from the dashboard?', 'No — open the report first; approve/clarify/reject live on the report detail.'),
      faq('Why is my queue empty?', 'In live mode you see exactly the reports the backend scopes to you; if none are at the manager stage, the queue is empty.'),
    ],
  },
  {
    intentLabel: 'accounting dashboard', screenName: 'Accounting Dashboard', screenType: 'dashboard', route: '/dashboard', roles: ['accounting'],
    purpose: 'The finance cockpit — KPI tiles (Awaiting review, Exception backlog, Queued to pay, SLA breaches), a review-queue preview, an exception backlog, and an executive co-approval alert bar.',
    elements: [
      btn('Export center', { triggers: 'downloads a CSV of all reports' }),
      btn('Run SLA check', { triggers: 'opens the SLA dashboard on the breaches tab' }),
      act('Stat tiles', { detail: 'Awaiting review · Exception backlog (blocking count) · Queued to pay · SLA breaches' }),
      wfi('Executive co-approval bar', { detail: 'lists over-threshold reports awaiting a Controller co-approval' }),
      faq('What counts as "Queued to pay"?', 'Reports that are queued for reimbursement or approved.'),
      faq('Who is in the executive bar?', 'Reports held awaiting executive (Controller) co-approval because their total is over the threshold.'),
    ],
  },
  {
    intentLabel: 'admin dashboard', screenName: 'Platform Overview', screenType: 'dashboard', route: '/dashboard', roles: ['admin'],
    purpose: 'The admin home — four platform KPIs (Active users, Active policies, Reports in flight, Open exceptions) plus a system-of-record integrity panel. Display + navigation only.',
    elements: [
      btn('Audit log', { triggers: 'opens the audit log' }), btn('Configuration', { triggers: 'opens admin configuration' }),
      act('Stat tiles', { detail: 'Active users · Active policies · Reports in flight · Open exceptions' }),
      act('Integrity panel', { detail: 'audit-chain integrity — server-enforced in live mode; locally a hash-chain verdict' }),
      faq('What counts as "in flight"?', 'Reports at manager review, accounting review, clarification, approved, or queued.'),
      faq('Why does integrity say "Server-enforced"?', 'In live mode the system of record enforces integrity; the local hash-chain verdict is a seed-mode artifact.'),
    ],
  },
  // ───────────────────────────── Employee ─────────────────────────────
  {
    intentLabel: 'new report', screenName: 'New Report Wizard', screenType: 'wizard', route: '/new', roles: ['employee', 'admin'],
    purpose: 'A four-step wizard (Details → Expenses → Mileage → Review) to create, save as draft, and submit an expense report; also the edit surface for a draft or a clarification-returned report. Submitting routes it to your manager.',
    layout: 'Page head (Save draft) · stepper (Details/Expenses/Mileage/Review) · step body · footer (Back / Continue / Submit report).',
    elements: [
      fld('Business purpose', { step: 'Details', required: true, note: 'gates Continue; becomes the report title' }),
      fld('Period from / Period to', { step: 'Details' }), fld('Currency', { step: 'Details', options: 'USD / EUR / CAD / GBP' }),
      fld('Advance received', { step: 'Details', note: 'subtracted from the total → net reimbursable' }),
      fld('Line: Date / Merchant / Description', { step: 'Expenses' }),
      fld('Line: Category', { step: 'Expenses', note: 'changing it resets the line GL to the category default' }),
      fld('Line: Amount', { step: 'Expenses', validation: 'whole dollars-and-cents; never reformatted mid-type' }),
      fld('Line: Cost center', { step: 'Expenses', note: 'live mode only' }, 'partial'),
      fld('Line: Receipt', { step: 'Expenses', note: 'file upload (PDF/JPG/PNG/HEIC/WebP, ≤10MB) in live mode; a checkbox in seed mode' }),
      fld('Mileage: Date / From / To / Miles', { step: 'Mileage', note: 'amount = miles × the current IRS rate (display-only rate)' }),
      btn('Save draft', { triggers: 'persists the draft, returns to My Reports' }),
      btn('Add line / Remove line', { step: 'Expenses' }), btn('Add trip / Remove trip', { step: 'Mileage' }),
      btn('Back / Continue', { note: 'Continue is disabled on Details until a purpose is entered; Back is hidden once a live draft exists' }),
      btn('Submit report', { enabledWhen: 'no blocking policy issue (seed) / passes server checks (live)', triggers: 'submits → manager review' }),
      err('Resolve all blocking issues (receipts, FX rates) before submitting', { recovery: 'fix the flagged lines' }),
      err('That accounting period is closed', { recovery: 'amend the line dates or ask an admin to reopen the period' }),
      faq('Where are the cost-center and file-upload receipt fields in seed mode?', 'Both are live-mode only; seed mode uses a receipt checkbox and no cost center.'),
      faq('Why is Submit disabled?', 'A blocking policy issue is open (most often a missing receipt ≥ $25 or a missing FX rate). Fix it to enable Submit.'),
    ],
  },
  {
    intentLabel: 'my reports', screenName: 'My Reports', screenType: 'list', route: '/reports', roles: ['employee'],
    purpose: 'Your own report register grouped into Active / Drafts / History tabs. Draft and returned reports expose an inline Edit; every row opens the report.',
    elements: [
      tab('Active', { matches: 'manager review / clarification / accounting review / approved / queued' }),
      tab('Drafts'), tab('History', { matches: 'reimbursed / closed / rejected / cancelled' }),
      btn('New report'), btn('Edit / Edit & resubmit', { visibleWhen: 'status is draft or clarification-requested', triggers: 'opens the wizard in edit mode' }),
      act('Row click', { triggers: 'opens the report detail' }),
      faq('Why can\'t I edit a report under manager review?', 'Only draft or returned reports are editable; ask the reviewer to return it, or withdraw it if still pending.'),
    ],
  },
  {
    intentLabel: 'employee reimbursement', screenName: 'Reimbursement Tracking', screenType: 'list', route: '/reimbursement', roles: ['employee'],
    purpose: 'A read-only list of your approved/paid reports showing payment status, method, reference, and net-paid amount (after advances).',
    elements: [
      fld('Columns', { note: 'Report · Status · Method · Reference · Net paid' }),
      act('Row click', { triggers: 'opens the report detail' }),
      faq('Why does an approved report show no payment reference?', 'The reference is set when the report is marked reimbursed; before that it shows a dash.'),
      faq('Is "Net paid" gross?', 'No — it is net reimbursable (approved total minus advances).'),
    ],
  },
  {
    intentLabel: 'employee clarifications', screenName: 'My Clarifications', screenType: 'list', route: '/clarifications', roles: ['employee'],
    purpose: 'Your reports a reviewer sent back for more information. Each card shows the reviewer note and an Edit & resubmit button.',
    elements: [
      btn('Edit & resubmit', { triggers: 'opens the report, then the wizard to fix + resubmit' }),
      act('Reviewer note', { detail: 'the last clarification note from the approver' }),
      faq('What happens after I resubmit?', 'It re-runs the policy checks and returns to the stage that requested the change (usually manager review).'),
    ],
  },
  // ───────────────────────────── Manager ─────────────────────────────
  {
    intentLabel: 'manager clarifications', screenName: 'Team Clarifications', screenType: 'list', route: '/clarifications', roles: ['manager'],
    purpose: 'The manager view of team reports you returned to employees for more information; they reappear here until resubmitted. Read + navigate only.',
    elements: [
      act('Open report', { triggers: 'opens the report detail' }),
      faq('How is this different from the employee Clarifications?', 'Same route, but managers see the team view; employees see their own returned reports.'),
      faq('What makes a report leave this list?', 'The employee resubmitting it (its status moves back to manager review).'),
    ],
  },
  {
    intentLabel: 'department activity', screenName: 'Department Activity', screenType: 'report', route: '/department', roles: ['manager'],
    purpose: 'A read-only visualization of reimbursement spend per team member (FX-normalized to USD), with a per-member report count. No actions.',
    elements: [
      act('Per-member spend bars', { detail: 'each team member\'s approved-stage spend as a share of the top spender' }),
      faq('Why might a member show $0 with reports?', 'Only reports at accounting review and beyond count toward spend; earlier-stage reports still count toward the report count.'),
    ],
  },
  {
    intentLabel: 'delegation', screenName: 'Delegation', screenType: 'form', route: '/delegation', roles: ['manager', 'admin'],
    purpose: 'Hand your approval authority to another manager for a date window, list existing delegations, and revoke active ones.',
    elements: [
      fld('Delegate to', { required: true, source: 'other managers (excludes yourself)' }),
      fld('From / To', { note: 'the delegation date window' }),
      btn('New delegation'), btn('Set delegation', { triggers: 'creates the delegation' }), btn('Cancel'),
      btn('Revoke', { visibleWhen: 'delegation is active', triggers: 'ends the delegation' }),
      err('You cannot delegate approvals to yourself', { recovery: 'pick a different (non-subordinate, non-cyclic) manager' }),
      act('Delegation routing', { note: 'delegations are stored + audited, but live approval routing does not yet consult them' }, 'partial'),
      faq('Why doesn\'t the delegate receive approvals yet?', 'In live mode, approval routing does not yet consult delegations — route approvals to the substantive approver until that ships.'),
    ],
  },
  // ───────────────────────────── Accounting / Finance ─────────────────────────────
  {
    intentLabel: 'review queue', screenName: 'Review Queue', screenType: 'list', route: '/queue', roles: ['accounting'],
    purpose: 'The accounting worklist of every report in accounting review, with search and an All / Flagged / Clean filter. Open a row to code GL, adjust, resolve exceptions, and approve.',
    elements: [
      fld('Search', { note: 'report number / purpose / employee' }), fld('Filter', { options: 'All / Flagged / Clean' }),
      act('Row click', { triggers: 'opens the report detail (where coding + approval happen)' }),
      faq('Which reports appear here?', 'Only reports in accounting review.'),
      faq('What does "Flagged" mean?', 'The report has open exceptions.'),
    ],
  },
  {
    intentLabel: 'exception queue', screenName: 'Exception Queue', screenType: 'list', route: '/exceptions', roles: ['accounting'],
    purpose: 'The accounting exception worklist — duplicate receipts, missing receipts, FX gaps, policy violations, inactive-category flags. Live mode shows a per-report aggregate; seed mode a per-violation master-detail with Open/Resolved/Waived tabs.',
    elements: [
      tab('Open / Resolved / Waived', { note: 'seed mode' }), fld('Type filter', { options: 'duplicate / missing receipt / policy violation / FX missing / inactive category' }),
      btn('Review', { triggers: 'opens the report to resolve inline (live)' }),
      act('Resolve / Waive', { detail: 'clears or waives a flag; waive requires a reason' }),
      err('Resolve or waive all blocking exceptions before approving', { recovery: 'clear the blocking flag, then approve' }),
      err('Not on live backend yet', { note: 'synthetic seed exceptions have no live id — resolve from the report instead' }),
      faq('Why must blocking exceptions clear first?', 'Accounting approval is blocked while a block-severity exception is open.'),
    ],
  },
  {
    intentLabel: 'reimbursement queue', screenName: 'Reimbursement Queue', screenType: 'list', route: '/reimburse', roles: ['accounting'],
    purpose: 'The payment screen — queue approved reports and execute payment. Live mode uses payment batches (create → post by a different user → export CSV/NACHA); seed mode marks reports paid. You cannot pay your own report.',
    elements: [
      fld('Approved-report checkbox', { note: 'your own report is separation-of-duties locked' }),
      btn('Create batch', { triggers: 'creates a draft payment batch from selected approved reports' }),
      btn('Post', { triggers: 'posts the batch — the poster must differ from the preparer' }),
      btn('Export CSV'), btn('Export NACHA', { triggers: 'downloads the ACH bank file' }),
      btn('Mark N paid / Execute payment', { note: 'seed mode' }), btn('Cancel'),
      err('Separation of duties: the poster must differ from the batch preparer', { recovery: 'a different finance user posts the batch' }),
      err('You cannot execute reimbursement on your own report', { recovery: 'a different executor pays it' }),
      err('Already reimbursed — duplicate payment blocked', { recovery: 'none — intentional' }),
      faq('Why can\'t I post the batch I created?', 'The poster must differ from the preparer (separation of duties).'),
      faq('CSV vs NACHA?', 'CSV is a report; NACHA is the ACH bank file for the bank to process.'),
    ],
  },
  {
    intentLabel: 'sla dashboard', screenName: 'SLA & Cycle Time', screenType: 'report', route: '/sla', roles: ['accounting'],
    purpose: 'Tracks how long in-flight reports wait at each handoff — KPIs (In flight, SLA breaches, Avg cycle time, On-time rate), a breaches table, and a cycle-time-by-handoff chart. Targets: manager & accounting review 48h, payment queue 72h.',
    elements: [
      act('Stat tiles', { detail: 'In flight · SLA breaches · Avg cycle time · On-time rate' }),
      tab('All in-flight / SLA breaches'), act('Open report', { triggers: 'opens the report detail' }),
      faq('What are the SLA targets?', 'Manager review 48h, accounting review 48h, payment queue 72h.'),
    ],
  },
  {
    intentLabel: 'analytics', screenName: 'Spend Analytics', screenType: 'report', route: '/analytics', roles: ['accounting', 'admin'],
    purpose: 'Spend analytics (FX-normalized) — KPIs plus, in live mode, three materialized views (monthly totals, policy violations, reimbursement cycle time) with a manual Refresh; in seed mode, spend-by-category and spend-by-department charts.',
    elements: [
      btn('Refresh', { note: 'live mode — recomputes the materialized views' }),
      act('Stat tiles', { detail: 'Total approved spend · Avg report value · Reports processed · Policy violations' }),
      faq('Why no client spend charts in live mode?', 'Live report lists carry no line detail, so the authoritative materialized-view tables are shown instead.'),
    ],
  },
  {
    intentLabel: 'all reports', screenName: 'All Reports', screenType: 'list', route: '/reports', roles: ['accounting', 'auditor'],
    purpose: 'The full report register across all statuses and employees — searchable, status-filterable, with a CSV export of the filtered rows. Auditor access is read-only.',
    elements: [
      fld('Search'), fld('Status filter', { options: 'All / Processed / each status' }),
      btn('Export CSV', { triggers: 'downloads the currently filtered rows' }),
      act('Row click', { triggers: 'opens the report detail' }),
      faq('Does Export dump all reports?', 'No — it exports the filtered view; clear filters first for everything.'),
    ],
  },
  {
    intentLabel: 'controls and compliance', screenName: 'Controls & Compliance', screenType: 'report', route: '/controls', roles: ['accounting', 'admin', 'auditor'],
    purpose: 'The governance cockpit — audit-chain integrity, a separation-of-duties + policy rollup, budgets/cost centers, a fraud monitor, payment batches, tax & retention, and accounting periods. The only action is the audit CSV export.',
    elements: [
      btn('Export audit (CSV)', { triggers: 'downloads the audit chain (includes a Hash column)' }),
      act('Panels', { detail: 'integrity · SoD & violations rollup · budgets · fraud monitor · payment batches · taxable · periods · retention' }),
      faq('Does the CSV include the hash?', 'Yes — the audit export includes a Hash column even though the on-screen audit table does not show one.'),
      faq('Why do fraud/taxable panels say "needs line-level data"?', 'In live mode the report list lacks per-line detail those signals need; they compute fully in seed mode and surface on report detail.'),
    ],
  },
  {
    intentLabel: 'audit log', screenName: 'Audit Log', screenType: 'report', route: '/audit', roles: ['accounting', 'admin', 'auditor'],
    purpose: 'The immutable, hash-chained, append-only trail of every state change — newest-first, searchable, with a CSV export. Entries cannot be edited or deleted.',
    elements: [
      fld('Search', { note: 'actor / action / report number' }),
      btn('Export', { triggers: 'downloads the trail as CSV, including the Hash column' }),
      faq('Why is there no Hash column in the table?', 'By design — the hash is internal and surfaces only in the CSV export.'),
      faq('Can I edit or delete an entry?', 'No — the ledger is append-only and immutable.'),
    ],
  },
  // ───────────────────────────── Admin ─────────────────────────────
  {
    intentLabel: 'admin configuration', screenName: 'Configuration', screenType: 'settings', route: '/config', roles: ['admin'],
    purpose: 'The admin master-data console — six tabs (Hub Users, Categories, Policies, Governance, Mileage & FX, Delegations) with inline editors. Most writes are live and audited; hub-user create/edit is local-only in this build.',
    layout: 'Page head (Reset demo) · mode banner · six tabs · inline editors · tab bodies.',
    elements: [
      tab('Hub Users'), tab('Categories'), tab('Policies'), tab('Governance'), tab('Mileage & FX'), tab('Delegations'),
      fld('User: Name / Email / Department / Title / Roles / Active', { note: 'create/edit persists locally only on live' }, 'unwired'),
      fld('Category: Code / Name / Default GL / Receipt threshold / Active'),
      fld('GL account: Code / Name / Type / Active'), fld('Cost center: Code / Name / Owner / Active'),
      fld('FX rate: Base / Quote / Rate / Effective date / Source'),
      fld('Policy: Code / Label / Enforcement / Active', { note: 'enforcement = warn or block; code is read-only on live' }),
      btn('Reset demo', { note: 'seed mode only — reloads the app' }),
      btn('Save user / Disable / Enable', { note: 'local-only on live — a warn toast fires; manager assignment is the only live hub-user write' }, 'unwired'),
      btn('New category / Save / Archive'), btn('Edit policy / Save'),
      btn('New GL / Save / Archive'), btn('New cost center / Save / Archive'),
      btn('Lock / Close / Reopen period', { visibleTo: 'admin', triggers: 'accounting-period state machine' }),
      btn('New FX rate / Save'), act('Map GL (category)'), act('Manager assignment', { note: 'the one live hub-user write' }),
      act('Approval-matrix editor', { note: 'read-only in the UI; band edits are governance/seed-driven' }, 'partial'),
      act('Mileage rates / Receipt rules editors', { note: 'no live writer yet — shown as pending' }, 'unwired'),
      err('Code required', { recovery: 'enter a code for the category/GL/cost-center' }),
      err('Invalid rate', { recovery: 'enter a base, quote, and a rate greater than zero' }),
      faq('Why doesn\'t hub-user create/edit persist on live?', 'There is no live route yet — only manager assignment is a live, admin-gated write.'),
      faq('Why is there no "New policy" button?', 'The Policies tab only edits/archives seeded policy keys; adding a new one is a backend change.'),
    ],
  },
  // ───────────────────────────── Report detail (shared, heaviest) ─────────────────────────────
  {
    intentLabel: 'report detail', screenName: 'Report Detail', screenType: 'detail', route: '/report/:id', roles: ALL,
    purpose: 'The full record of one report and the heaviest interactive screen — header + status, a lifecycle stage bar, a role/status-conditional action bar, the line/mileage table with inline GL coding and per-line adjustment, an exceptions panel, and a right rail (summary, employee, timeline, receipts, audit). Affordances adapt to your role × the report status. Auditors view read-only.',
    layout: 'Breadcrumb · header (status, SLA pill, Unlock/Archive/Export) · stage bar · alert bars · action bar · lines table + exceptions · right rail · docked editors.',
    elements: [
      tab('Lines'), tab('Summary'), tab('Employee'), tab('Workflow timeline'), tab('Receipts'), tab('Versions & audit'),
      fld('GL Account (per line)', { note: 'required on every line before Approve & code' }),
      fld('Approve note / Clarify reason / Reject reason', { note: 'clarify + reject require a reason' }),
      fld('Reimburse: payment reference', { note: 'auto if blank' }), fld('Queue: method', { options: 'ACH / Payroll / Check / Cash / Other' }),
      fld('Adjust: approved amount + reason', { required: true, note: 'adjusting an approved report reopens it to accounting review' }),
      fld('Advance: amount + note', { note: 'live appends; seed replaces' }),
      fld('Override: force status + reason', { note: 'admin only' }), fld('Unlock / Edit-line: reason', { required: true }),
      btn('Approve', { visibleTo: 'manager @ manager review', triggers: 'advances to accounting review or holds for executive co-approval' }),
      btn('Request clarification', { triggers: 'returns the report to the employee (reason required)' }),
      btn('Reject', { triggers: 'terminates the report (reason required)' }),
      btn('Executive co-approve', { visibleTo: 'accounting/admin', visibleWhen: 'report is held awaiting executive', triggers: 'clears the exec hold' }),
      btn('Approve & code', { visibleTo: 'accounting @ accounting review', enabledWhen: 'every line has a GL + no open blocking exception', triggers: 'advances to approved' }),
      btn('Queue for reimbursement', { note: 'seed mode' }), btn('Mark reimbursed', { triggers: 'executes payment; records the executor' }),
      btn('Edit & submit / Edit & resubmit', { visibleTo: 'owner @ draft/clarification' }),
      btn('Withdraw', { visibleTo: 'owner', visibleWhen: 'still at manager review (live)', triggers: 'pulls the report back to draft' }),
      btn('Admin override', { visibleTo: 'admin', note: 'force any status with a reason — seed mode only on live' }, 'unwired'),
      btn('Unlock to edit / Re-lock', { visibleTo: 'accounting/manager', note: 'opens on-behalf editing — seed mode only on live' }, 'unwired'),
      btn('Archive', { visibleWhen: 'terminal (reimbursed/rejected)' }), btn('Export', { triggers: 'downloads this report as CSV' }),
      act('Assign GL / Adjust amount / Edit advances / Edit line', { detail: 'inline + docked editors for finance corrections (audited, reason required where shown)' }),
      act('Review exception', { detail: 'opens a flag to resolve/waive' }), act('View receipt', { detail: 'opens a 1-hour signed receipt URL (live)' }),
      err('Every line must have a GL account before approval', { recovery: 'assign a GL to each line, then approve' }),
      err('You cannot approve your own report (separation of duties)', { recovery: 'a different approver must act' }),
      err('Not on live backend yet', { note: 'admin override / unlock / queue have no live route in this build' }),
      faq('Does "Approved" mean paid?', 'No — payment happens at the reimburse step.'),
      faq('Why did adjusting reopen the report?', 'Adjusting an approved line returns the report to accounting review for re-approval.'),
      faq('Can an auditor act here?', 'No — auditors view read-only; no action buttons render.'),
    ],
  },
  // ───────────────────────────── Help (global overlay) ─────────────────────────────
  {
    intentLabel: 'help center', screenName: 'Help Center & Ask AI', screenType: 'reference', route: 'global overlay', roles: ALL,
    purpose: 'A docked help panel (not a route) with three tabs — This page, FAQ, Ask AI — plus search. All copy is generated from live config and role-filtered. "Ask AI" is a local keyword matcher, not an LLM.',
    elements: [
      tab('This page'), tab('FAQ'), tab('Ask AI'),
      fld('Search'), fld('Ask AI question'),
      btn('Send', { triggers: 'answers from a local keyword scorer' }),
      act('Ask AI', { note: 'a client-side keyword matcher over the FAQ content — there is no LLM call' }, 'partial'),
      faq('Is "Ask AI" a real AI?', 'No — it is a local keyword matcher over the help content; it does not call an LLM.'),
      faq('Why do I see different articles than a colleague?', 'Help content is role-filtered to your role.'),
    ],
  },
];

export const WORKFLOWS: WorkflowDef[] = [
  { name: 'Expense Report Lifecycle', businessPurpose: 'File a claim, route it through manager (and any executive) and finance approval, then pay it out and close it.', stakeholderType: 'Procurement', personaType: 'employee', sequence: ['new report', 'manager dashboard', 'report detail', 'review queue', 'reimbursement queue'], successCriteria: 'Report reaches Reimbursed/Closed after manager → (exec) → finance approval → payment.' },
  { name: 'Manager Approval', businessPurpose: 'A manager reviews a team report and approves, returns for clarification, or rejects.', stakeholderType: 'Operations', personaType: 'manager', sequence: ['manager dashboard', 'report detail'], successCriteria: 'Report advances to accounting review (or holds for executive co-approval).' },
  { name: 'Executive Co-Approval', businessPurpose: 'A Controller co-approves an over-threshold report before finance.', stakeholderType: 'CFO', personaType: 'executive', sequence: ['accounting dashboard', 'report detail'], successCriteria: 'The executive hold clears and the report moves to accounting review.' },
  { name: 'Accounting Code & Approve', businessPurpose: 'Finance codes each line to a GL account, resolves flags, and gives final approval.', stakeholderType: 'Procurement', personaType: 'finance', sequence: ['review queue', 'exception queue', 'report detail'], successCriteria: 'Every line has a GL, no blocking exception remains, and the report is approved.' },
  { name: 'Clarification & Resubmit', businessPurpose: 'Return a report to the employee for a fix, who resubmits it.', stakeholderType: 'Operations', personaType: 'employee', sequence: ['report detail', 'employee clarifications', 'new report'], successCriteria: 'The corrected report re-enters review.' },
  { name: 'Payment & Reimbursement', businessPurpose: 'Finance builds a payment batch (or marks paid), a different user posts it, and exports CSV/NACHA for the bank.', stakeholderType: 'Procurement', personaType: 'finance', sequence: ['reimbursement queue', 'report detail'], successCriteria: 'Approved reports are paid by ACH; the poster differs from the preparer.' },
  { name: 'Delegation', businessPurpose: 'A manager hands approval authority to a peer for a date window when away.', stakeholderType: 'Operations', personaType: 'manager', sequence: ['delegation'], successCriteria: 'A delegation is recorded and audited (routing consult is a pending follow-on).' },
  { name: 'Period Close & Configuration', businessPurpose: 'Admin manages categories, policies, GL/cost centers, FX, and locks/closes accounting periods.', stakeholderType: 'IT', personaType: 'operations', sequence: ['admin configuration'], successCriteria: 'Master data is configured; closed periods block postings.' },
  { name: 'Controls & Audit Review', businessPurpose: 'An auditor reviews the audit chain, controls, and the full register read-only and exports for offline verification.', stakeholderType: 'Compliance', personaType: 'compliance', sequence: ['controls and compliance', 'audit log', 'all reports'], successCriteria: 'The hash-chained trail verifies; findings are raised out-of-band.' },
];

export const EXTRA_KNOWLEDGE: { content: string; category?: string; source: string }[] = [
  { content: 'An expense.vin report moves through these stages: Draft → Manager Review → (Executive co-approval) → Accounting/Finance Review → Approved → Queued for Reimbursement → Reimbursed → Closed. Clarification (returned for info), Rejected, and Cancelled branch off the review stages.', category: 'docs', source: 'expense.vin help center · report lifecycle' },
  { content: 'expense.vin routes each report by its USD total: under $500 needs manager approval only; $500–$2,500 is manager approval with admin escalation; $2,500 and above requires the manager plus an executive (Controller) co-approval before finance. If no band matches a positive total, the report safely holds for executive co-approval.', category: 'docs', source: 'expense.vin help center · approval matrix' },
  { content: 'expense.vin enforces separation of duties absolutely: no one can approve their own report, no one can reimburse their own report, managers can never execute reimbursement at all, a report cannot be paid twice, and the person who posts a payment batch must differ from the person who prepared it.', category: 'docs', source: 'expense.vin help center · separation of duties' },
  { content: 'expense.vin has five roles: Employee (claims and tracks), Manager (approves the team, delegates), Accounting/Finance (codes GL, adjusts, resolves flags, reimburses, runs controls), Admin (configures everything, can act in any queue, previews any role), and Auditor (read-only review of reports, controls, and the audit trail).', category: 'docs', source: 'expense.vin help center · roles' },
  { content: 'expense.vin policy checks are either block or warn. Blocks stop submit/approval: a receipt is required at or above $25 for receipt-required categories, and a foreign-currency line must have an exchange rate on file. Warnings flag but allow: meals over $75/day, lodging over $300/night, airfare over $1,200, and entertainment over $250. Finance must also assign a GL to every line and clear blocking exceptions before approving.', category: 'docs', source: 'expense.vin help center · policy dictionary' },
  { content: 'expense.vin is multi-currency: you enter the amount in the currency you paid and the system converts everything to USD for totals, caps, and analytics. Reimbursement is paid by ACH — finance builds a payment batch and exports it as CSV or a NACHA ACH file for the bank.', category: 'docs', source: 'expense.vin help center · currency and payment' },
  { content: 'Honest limits of expense.vin today: there is no live QuickBooks sync (each GL account carries a QuickBooks mapping code only), no receipt OCR (receipts are uploaded and hashed, not scanned), the "Ask AI" help is a local keyword matcher rather than a language model, and manager delegation is stored and audited but not yet consulted by live approval routing.', category: 'docs', source: 'expense.vin help center · known limitations' },
];

export const ALL_INTENT_LABELS = PAGES.map((p) => p.intentLabel);
