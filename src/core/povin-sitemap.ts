/**
 * PO.vin — DETERMINISTIC full-coverage sitemap (the authoritative source for 100% Knowledge + Demo Graph
 * coverage). Hand-transcribed from the code-grounded forensic Knowledge Center (master doc + the 5 page-
 * decomposition group files) so EVERY one of PO.vin's documented pages is represented with its purpose,
 * fields, buttons, actions, tabs, errors and FAQs — zero gaps. One reviewable dataset drives BOTH the demo
 * graph (nodes + elements + page_facts) and the knowledge base (business-facing chunks), so they can never
 * disagree.
 *
 * FIREWALL (standing rule — nothing technical reaches the AI/user): everything here is BUSINESS-FACING.
 * No RPC names (fn_*), file names (*.ts), SQL, or internal status codes. Honesty markers from the docs
 * (DEAD UI / UNWIRED / PARTIAL / UNKNOWN) are preserved via each element's `status`, never hidden.
 *
 * Consumed by seed-povin-coverage.ts (seed) and eval-povin-coverage.ts (the 100% assertion).
 */

export type ElStatus = 'live' | 'partial' | 'dead_ui' | 'unwired' | 'unknown';
export type ElType = 'field' | 'button' | 'action' | 'tab' | 'section' | 'error' | 'faq' | 'workflow_interaction' | 'note';
export interface PageElement { type: ElType; label: string; detail?: Record<string, unknown>; status?: ElStatus }
export interface PageDef {
  intentLabel: string;                  // unique lowercase navigational label (the graph node key)
  screenName: string;
  screenType: 'list' | 'form' | 'dashboard' | 'detail' | 'settings' | 'wizard' | 'report' | 'reference' | 'auth' | 'other';
  route: string;                        // the REAL route
  roles: string[];                      // who can reach it (permissions_required)
  purpose: string;                      // business-facing
  layout?: string;
  elements: PageElement[];
}
export interface WorkflowDef { name: string; businessPurpose: string; stakeholderType: string; personaType: string; sequence: string[]; successCriteria: string }

export const PRODUCT = 'PO.vin';

// ── compact element constructors (keep the dataset dense + readable) ──
const fld = (label: string, detail?: Record<string, unknown>, status?: ElStatus): PageElement => ({ type: 'field', label, detail, status });
const btn = (label: string, detail?: Record<string, unknown>, status?: ElStatus): PageElement => ({ type: 'button', label, detail, status });
const act = (label: string, detail?: Record<string, unknown>, status?: ElStatus): PageElement => ({ type: 'action', label, detail, status });
const tab = (label: string, detail?: Record<string, unknown>): PageElement => ({ type: 'tab', label, detail });
const err = (label: string, detail?: Record<string, unknown>): PageElement => ({ type: 'error', label, detail });
const faq = (q: string, a: string): PageElement => ({ type: 'faq', label: q, detail: { answer: a } });
const wfi = (label: string, detail?: Record<string, unknown>): PageElement => ({ type: 'workflow_interaction', label, detail });

const ALL = ['employee', 'manager', 'owner', 'accounting', 'admin'];

export const PAGES: PageDef[] = [
  // ───────────────────────────── High-traffic ─────────────────────────────
  {
    intentLabel: 'purchase order detail',
    screenName: 'PO Detail', screenType: 'detail', route: '/po/:id', roles: ALL,
    purpose: 'Single-PO workspace — header, action panel, lines, audit timeline, equipment, comments, approval routing and watchers. The convergence point for every workflow action. Backend row-scopes who can view each PO (requesters see their own; managers see direct reports + delegated; owner/accounting/admin per stage).',
    layout: 'Breadcrumb · header strip (ref, status badge, lifecycle strip, order-total card) · StageTracker · accounting-review badge · duplicate-vendor banner · two columns (tabs + comments | action panel, routing card, watchers).',
    elements: [
      tab('Details', { shows: 'Vendor, department, budget category, totals, needed-by, requester, payment block, description, justification, attachments (with scan status)' }),
      tab('Lines', { shows: 'Line items (qty, received, unit cost, total); switches to per-line Receive editor when receivable' }),
      tab('Activity', { shows: 'Audit timeline, color-coded by event type; inline bypass chip on override rows' }),
      tab('Audit', { shows: 'Filtered to governed mutations only' }),
      tab('Equipment', { shows: 'Per-unit asset records; verify mode for asset metadata', visibleWhen: 'PO has asset lines or equipment exists' }),
      btn('Back', { triggers: 'returns to previous list' }),
      btn('Post comment', { enabledWhen: 'comment is non-empty', triggers: 'adds a comment, reloads the PO' }),
      btn('Audit bundle CSV', { visibleTo: 'anyone who can view the PO', triggers: 'downloads the full audit history for this PO' }),
      btn('Continue editing', { visibleTo: 'requester (own draft)', visibleWhen: 'status is Draft', triggers: 'opens the PO Wizard to resume the draft' }),
      btn('Discard draft', { visibleTo: 'requester + admin', visibleWhen: 'status is Draft', triggers: 'discards the draft (confirm first)' }),
      btn('Download attachment', { enabledWhen: 'file is scanned-clean and not quarantined' }),
      act('Receive lines', { visibleTo: 'requester (own paid PO), accounting, admin', enabledWhen: 'status is Paid or Partially received', triggers: 'per-line receipt with disposition + proof-of-delivery + asset metadata' }),
      act('Verify assets', { visibleTo: 'accounting, admin', enabledWhen: 'asset lines exist and all units complete', triggers: 'advances the PO to asset verification' }),
      act('Approve / Reject / Clarify / Pay / Receive / Close / Finalize / Delegate / Escalate / Hold / Resume / Cancel', { note: 'surfaced by the embedded Action Panel per the PO status × your role; see the Permission Matrix' }),
      wfi('Approval pipeline', { detail: 'Manager / Owner / Accounting act here; status flips + audit row recorded' }),
      wfi('Clarification cycle', { detail: 'requester or prior actor receives a clarification request and re-submits' }),
      err('FORBIDDEN_ROLE', { friendly: 'A button was shown that the backend gate rejects — flag to your admin' }),
      err('SOD_VIOLATION', { friendly: 'Separation-of-duties prevented the action (e.g. you prepared this PO)' }),
      err('PO_TERMINAL_STATUS', { friendly: "Can't change a PO that's already closed, rejected, or cancelled" }),
      faq('Why is the Equipment tab missing from my PO?', 'It only appears when the PO has asset lines or equipment records exist. Non-asset POs hide it.'),
      faq("I'm the requester but I don't see Receive Mode.", 'Receive Mode requires the PO to be Paid or Partially received. Pre-paid POs do not show it.'),
      faq('Can I edit fields on a submitted PO?', 'Not from this page — submission creates an immutable record. Use the Request-Clarification cycle to send it back to a prior actor for revision.'),
    ],
  },
  {
    intentLabel: 'new purchase request',
    screenName: 'PO Wizard (New Purchase Request)', screenType: 'wizard', route: '/po/new', roles: ALL,
    purpose: 'Five-step wizard to create and submit a new purchase order (or resume a draft). Owns the entire write surface: drafts, attachments, line items with classification + GL/location/segment/cost-center pickers, routing preview, and final submission. Drafts auto-save while editing.',
    layout: 'Page head (auto-save pill + Save & Exit) · left step rail (The basics → Business purpose → Line items → Timing & docs → Review & submit) · right step form · footer (Back / Save as Draft / Continue / Submit).',
    elements: [
      fld('Purchase title', { step: 1, required: true }),
      fld('Vendor / Supplier', { step: 1, required: true, source: 'searchable vendor directory' }),
      fld('Vendor website or contact', { step: 1, required: false }),
      fld('Department', { step: 1, required: true, source: 'type-ahead datalist; new values allowed' }),
      fld('Requested by', { step: 1, note: 'read-only — your account' }),
      fld('Purchase description', { step: 2, required: true, validation: '≥ 20 characters' }),
      fld('Business justification', { step: 2, required: true, validation: '≥ 20 characters' }),
      fld('Line: description', { step: 3, required: true }),
      fld('Line: quantity', { step: 3, required: true, validation: '≥ 1' }),
      fld('Line: unit cost', { step: 3, required: true, validation: '> 0' }),
      fld('Line: classification', { step: 3, required: true, options: 'asset / consumable / service / software / subscription / other' }),
      fld('Line: asset category', { step: 3, requiredWhen: "classification = asset", options: 'Laptop / Monitor / Desk / Chair / Server / Networking / Software License / Other' }),
      fld('Line: GL account', { step: 3, required: 'at finalize', note: 'leaving it blank is allowed at submit but Finalize requires it' }),
      fld('Line: location / segment code / cost center', { step: 3, required: false }),
      fld('Line: tax rate / warranty months / depreciable / serial-tracked', { step: 3, note: 'advanced line options (asset-oriented)' }),
      fld('Budget category', { step: 4, required: true }),
      fld('Needed by', { step: 4, required: true }),
      fld('Urgent', { step: 4, required: false }),
      fld('Attachments', { step: 4, validation: 'allowed types, ≤ 10MB each' }),
      fld('Additional notes', { step: 4, required: false }),
      btn('Save & Exit', { triggers: 'saves the draft, returns to Drafts' }),
      btn('Save as Draft', { triggers: 'saves the draft' }),
      btn('Continue', { enabledWhen: 'current step is valid', triggers: 'advances a step' }),
      btn('Back', { triggers: 'previous step' }),
      btn('Submit Purchase Request', { visibleWhen: 'on the final step', triggers: 'validates all steps, submits, routes to Manager or Owner per threshold' }),
      btn('Add line / Remove line', { triggers: 'adds or removes a line item' }),
      btn('Upload attachment', { triggers: 'attaches a file (auto-saves the draft first)' }),
      wfi('Submission routing', { detail: 'on submit, the threshold engine reads the dollar amount and routes to Manager or Owner; a bypassed stage records a Bypassed audit row' }),
      wfi('Duplicate-vendor banner', { detail: 'surfaces prior POs to the same vendor' }),
      err('PO_VALIDATION', { friendly: 'A line failed a rule (missing asset category, classification mismatch, tax rate out of range, etc.) — the wizard jumps to the field' }),
      faq("My department isn't in the dropdown.", "It's a type-ahead — you can enter a new value; the backend resolves it on submit."),
      faq('GL account is empty — will submit fail?', 'No. Submit allows a blank GL account. Finalize later requires every line to have one.'),
      faq('I clicked Submit but nothing happened.', 'Validation runs across all steps; the first error is shown and the wizard jumps to that field.'),
    ],
  },
  {
    intentLabel: 'dashboard',
    screenName: 'Dashboard', screenType: 'dashboard', route: '/', roles: ALL,
    purpose: 'Role dispatcher — renders the dashboard matching your role (Employee / Manager / Owner / Accounting / Admin). Surfaces a filter banner so dashboard counts can never silently lie when a filter is active elsewhere.',
    elements: [
      act('Role dispatch', { detail: 'shows the Employee, Manager, Owner, Accounting, or Admin dashboard based on your role; admins can preview other roles' }),
      faq("I'm an admin but I see the Employee dashboard.", 'Check the role-preview toggle in the header — your effective role reflects the previewed role.'),
      faq('My dashboard counts look wrong.', 'Check the active-filter banner — a filter from Registry/Vendors may be narrowing the view. Clear it to reset.'),
    ],
  },
  {
    intentLabel: 'purchase registry',
    screenName: 'Registry', screenType: 'list', route: '/registry', roles: ALL,
    purpose: 'Full cross-stage purchase-order list with status tabs, a filter toolbar (search, status, department, amount, sort, urgent) and CSV export. The browse surface when you know the PO number/vendor but not the stage.',
    elements: [
      tab('All Requests', { matches: 'every PO' }),
      tab('Pending', { matches: 'manager/owner-stage POs' }),
      tab('In Accounting', { matches: 'approved / processing' }),
      tab('In Receive', { matches: 'paid / partially received' }),
      tab('Closed', { matches: 'received / closed' }),
      tab('On Hold'), tab('Rejected', { matches: 'rejected / cancelled' }),
      btn('Export CSV', { triggers: 'downloads the current filtered list as a dated CSV' }),
      btn('Clear filters', { visibleWhen: 'filters hid all rows' }),
      act('Row click', { triggers: 'opens the PO detail' }),
      faq('My PO is missing from the All tab.', 'The list is scoped by your role — requesters see only their own POs; managers see direct reports + delegated.'),
      faq('Does the CSV include audit history?', 'No — for full per-PO audit use the Audit bundle CSV on the PO detail.'),
    ],
  },
  {
    intentLabel: 'vendor directory',
    screenName: 'Vendors', screenType: 'list', route: '/vendors', roles: ALL,
    purpose: 'Vendor directory with inline-expanding cards (contact, risk, compliance, performance, recent POs). View-only for non-admins; admins create and edit vendors. Deep-linkable to a specific vendor.',
    elements: [
      fld('Name', { required: true, validation: '2–200 characters' }),
      fld('Service type / Description / Contact name / Contact email / Contact phone', { required: false, note: 'contact email is format-validated' }),
      fld('Relationship owner', { required: false, source: 'active users' }),
      fld('Override active', { required: false, note: 'overrides the computed risk classification' }),
      btn('Add Vendor', { visibleTo: 'admin', triggers: 'opens the vendor editor in create mode' }),
      btn('Edit', { visibleTo: 'admin', triggers: 'opens the vendor editor' }),
      btn('Save', { visibleTo: 'admin', triggers: 'creates or updates the vendor' }),
      act('Card click', { triggers: 'expands the vendor card; syncs the URL for deep-linking' }),
      err('VENDOR_NAME_TAKEN', { friendly: 'A vendor with that name already exists' }),
      faq("Why can't I create a vendor?", 'Only admins can. The button is disabled for other roles.'),
      faq("Where's the risk level field?", 'Risk is computed by the backend, not edited. To override an auto-classification, an admin checks "Override active".'),
    ],
  },
  {
    intentLabel: 'workflow map',
    screenName: 'Workflow Map', screenType: 'reference', route: '/workflow', roles: ALL,
    purpose: 'Educational reference showing the status reconciliation (Hub status ↔ backend status ↔ payment status) and the canonical governed operations. Read-only.',
    elements: [
      act('Status map', { detail: 'a table reconciling each Hub status to its backend + payment status' }),
      faq('Does this page reflect what is actually in the backend?', 'The status mapping is single-source and shared with the backend; it is a reference view, not a live query.'),
    ],
  },
  {
    intentLabel: 'drafts',
    screenName: 'Drafts', screenType: 'list', route: '/drafts', roles: ALL,
    purpose: 'Your unsubmitted draft purchase orders. Resume any draft into the wizard. Not visible to approvers.',
    elements: [
      act('Row click', { triggers: 'opens the draft in the PO Wizard for editing' }),
      faq('Can my manager see my drafts?', 'No — drafts are scoped to you until you submit.'),
    ],
  },
  {
    intentLabel: 'my requests',
    screenName: 'My Requests', screenType: 'list', route: '/my', roles: ALL,
    purpose: 'Every PO you have submitted (excludes drafts). Entry to the PO detail, including the clarification-response flow for returned POs.',
    elements: [
      act('Row click', { triggers: 'opens the PO detail' }),
      faq("A PO I just submitted doesn't appear.", 'Reload — the list cache may be stale. The list is scoped exactly to you.'),
    ],
  },
  {
    intentLabel: 'closed purchase orders',
    screenName: 'Closed POs', screenType: 'list', route: '/closed', roles: ALL,
    purpose: 'Records-retention archive of fully received and closed POs. Read-only; closure is terminal.',
    elements: [
      act('Row click', { triggers: 'opens the PO detail (audit + equipment, no actions)' }),
      faq('Can I reopen a closed PO from here?', 'No — closure is terminal in the Hub.'),
    ],
  },
  {
    intentLabel: 'reports',
    screenName: 'Reports', screenType: 'report', route: '/reports', roles: ALL,
    purpose: 'Spend and workflow analytics: stage-timing chart, spend by department/category, status distribution, and downloadable specialized reports (asset custody, inventory aging, open-PO aging, vendor spend).',
    elements: [
      fld('Quarter selector', { note: 'pick a quarter or last-90-days' }),
      btn('Export', { triggers: 'downloads the spend/workflow CSV for the selected window' }),
      btn('Asset custody CSV / Inventory aging CSV / Open PO aging CSV / Vendor spend CSV', { triggers: 'downloads the specialized report' }),
      act('Stat tiles', { detail: 'Total Requested · Authorized · Equipment Received · Audit Log Entries' }),
      faq('Why does "Authorized" include paid/received/closed POs?', 'It captures cumulative authorized spend — any downstream stage was approved at some point.'),
    ],
  },

  // ───────────────────────────── Approval queues ─────────────────────────────
  {
    intentLabel: 'manager review queue',
    screenName: 'Manager Review Queue', screenType: 'list', route: '/queue/manager', roles: ['manager', 'admin'],
    purpose: 'First-stage approval inbox. Managers review POs submitted by their direct reports (and POs delegated to them) and decide approve / reject / clarify / delegate / escalate / hold. Sorted urgent-first, then newest.',
    elements: [
      act('Row click', { triggers: 'opens the PO detail where approve/reject/clarify/delegate/escalate/hold live' }),
      wfi('Approve', { to: 'Owner stage, or Approved if the threshold skipped Owner' }),
      wfi('Reject', { to: 'Rejected (terminal)' }), wfi('Clarify', { to: 'returned for clarification' }),
      wfi('Delegate', { detail: 'hands approval to a peer manager' }), wfi('Escalate', { to: 'Owner stage' }),
      faq("I'm a manager but the queue is empty — what's wrong?", "Most likely your direct reports don't have you set as their Manager. Ask an admin to set it on each requester in Manage Users."),
      faq('Can I approve my own PO that landed here?', 'No — separation-of-duties prevents self-approval. A different manager must approve.'),
    ],
  },
  {
    intentLabel: 'owner approval queue',
    screenName: 'Owner Approval Queue', screenType: 'list', route: '/queue/owner', roles: ['owner', 'admin'],
    purpose: 'Second-stage approval inbox for Owners (Executive Approvers): approve, approve-with-conditions, reject, clarify, delegate, hold. Sorted largest-amount-first.',
    elements: [
      act('Row click', { triggers: 'opens the PO detail with owner-stage actions' }),
      wfi('Approve', { to: 'Approved → Accounting' }), wfi('Approve with conditions', { to: 'Approved (conditional)' }),
      wfi('Reject / Clarify / Delegate / Hold'),
      faq('A PO that should have hit Owner went straight to Accounting — where do I review it?', 'The threshold engine bypassed your stage; review it in Bypassed Approvals.'),
      faq('Can I conditionally approve at Manager stage too?', 'No — approve-with-conditions is Owner-only.'),
    ],
  },
  {
    intentLabel: 'accounting payment queue',
    screenName: 'Accounting Payment Queue', screenType: 'list', route: '/queue/accounting', roles: ['accounting', 'admin'],
    purpose: 'Payment-stage operations. Tab 1 (Pending Payment) lists Owner-approved POs awaiting payment initiation; Tab 2 (In Payment) lists payments in flight. Includes a separation-of-duties safety alert.',
    elements: [
      tab('Pending Payment', { matches: 'approved / approved-conditional' }),
      tab('In Payment', { matches: 'processing' }),
      act('Pay start', { triggers: 'moves a PO into processing' }),
      act('Mark paid', { note: 'surfaced to Accounting, but the authoritative gate is Comptroller/Finance post separation-of-duties split — Accounting may receive a separation-of-duties rejection', status: 'partial' }),
      err('SOD_VIOLATION', { friendly: 'You started or approved this payment — a different finance user must mark it paid' }),
      faq('I clicked Pay Started — where did the row go?', 'It moved from Pending Payment to In Payment.'),
      faq('I tried to mark a PO paid and got a separation-of-duties error.', 'Mark-paid requires a different finance/comptroller user than the one who processed it.'),
    ],
  },
  {
    intentLabel: 'bypassed approvals',
    screenName: 'Bypassed Approvals', screenType: 'list', route: '/queue/bypass', roles: ['owner', 'admin'],
    purpose: 'Read-only retrospective surface for POs the threshold engine routed past the Owner stage — governance review of what was auto-cleared. No actions.',
    elements: [
      act('Row click', { triggers: 'opens the PO detail for read-only review' }),
      faq('Can I cancel or reject a PO that bypassed me?', 'No — this view is read-only. Contact Accounting to hold/cancel during payment if needed.'),
      faq('Why is the queue empty? We have POs over the threshold.', 'It populates once a qualifying PO is submitted and routed past your stage.'),
    ],
  },
  {
    intentLabel: 'receive queue',
    screenName: 'Receive Queue', screenType: 'list', route: '/receive', roles: ['accounting', 'admin'],
    purpose: 'Paid POs awaiting receipt intake. Accounting (and admin) line up POs to mark received; asset receipts create equipment records automatically.',
    elements: [
      act('Row click', { triggers: 'opens the PO detail to receive lines / verify assets / finalize / close' }),
      wfi('Receive (all lines)', { to: 'Received' }), wfi('Receive (per-line)', { to: 'Partially received' }),
      wfi('Verify assets', { detail: 'asset POs require complete per-unit metadata' }),
      faq("I'm a requester — can I see my own paid PO here?", 'The Receive Queue is for accounting + admin. Confirm receipt from My Requests → the PO → Receive on your own paid PO.'),
      faq('I marked one line received but the status did not change to Received.', 'Partial receipt sets Partially received; only when all lines are received does it advance to Received.'),
    ],
  },

  // ───────────────────────────── Assets + Inventory ─────────────────────────────
  {
    intentLabel: 'asset registry',
    screenName: 'Assets List', screenType: 'list', route: '/assets', roles: ['accounting', 'admin'],
    purpose: 'Asset registry — equipment lifecycle, custody and movement history for every registered unit. Receiving a fixed-asset PO line registers units here automatically.',
    elements: [
      fld('Search', { note: 'serial / tag / name / model' }),
      fld('Lifecycle status filter', { options: 'in inventory / assigned / active / in repair / damaged / lost / retired / sold / written off / archived' }),
      fld('Category filter'), fld('Active only', { default: true, note: 'hides archived/lost/sold/written-off' }),
      act('Lifecycle rollup pills', { detail: 'count per lifecycle state' }),
      act('Row click', { triggers: 'opens the asset detail' }),
      faq('Why is my newly received asset not showing here?', 'The PO line must be classified as an asset — consumables seed Inventory instead.'),
      faq('Where are the assets I retired last quarter?', 'Turn off "Active only" or click the relevant lifecycle pill.'),
    ],
  },
  {
    intentLabel: 'asset detail',
    screenName: 'Asset Detail', screenType: 'detail', route: '/assets/:id', roles: ['accounting', 'admin'],
    purpose: 'Per-asset lifecycle and custody view — quick facts, a lifecycle strip, the action panel for lifecycle transitions, and the movement-history timeline.',
    elements: [
      act('Assign to user', { enabledWhen: 'asset is in inventory', triggers: 'assigns the asset' }),
      act('Reassign', { enabledWhen: 'asset is assigned/active' }),
      act('Transfer', { detail: 'change owner, location, and/or department (at least one)' }),
      act('Send for repair'), act('Mark damaged'), act('Retire from service'),
      act('Dispose (sell / write off)', { detail: 'requires a note; optional proceeds' }),
      act('Archive', { enabledWhen: 'asset is retired/sold/written-off/lost (terminal)' }),
      err('ASSET_INVALID_TRANSITION', { friendly: "That lifecycle move isn't allowed from the asset's current state" }),
      faq("Why don't I see a Reassign button on this in-inventory asset?", 'Use Assign to user — Reassign is for an already-assigned/active asset.'),
      faq('Where do I edit the asset tag or serial number?', 'Those are set when the asset is first received; later edits are not exposed in the Hub UI today.'),
    ],
  },
  {
    intentLabel: 'inventory',
    screenName: 'Inventory', screenType: 'list', route: '/inventory', roles: ['accounting', 'admin'],
    purpose: 'Stock-managed item registry — consumables replenished on PO receipt and consumed via ledger writes. Every transaction is immutable. A low-stock banner surfaces items at/under their reorder threshold.',
    elements: [
      fld('Search'), fld('Category filter'), fld('Show inactive', { default: false }),
      act('Show only low stock', { detail: 'banner toggle when low-stock items exist' }),
      act('Row click', { triggers: 'opens the inventory item detail' }),
      faq('The "On hand" column shows a value but I can only consume part of it.', 'Available = on hand − reserved. Reserved quantity is held against allocations.'),
      faq('Where do I create a brand-new inventory item?', 'There is no "New item" button — items appear via PO receipt seeding or a backend path.', ),
    ],
  },
  {
    intentLabel: 'inventory detail',
    screenName: 'Inventory Detail', screenType: 'detail', route: '/inventory/:id', roles: ['accounting', 'admin'],
    purpose: 'Per-item ledger view — on-hand / reserved / available / threshold stats, item facts, the ledger action panel (consume / replenish / adjust), and the full transaction ledger.',
    elements: [
      fld('Quantity', { note: 'consume/replenish amount; consume capped at available' }),
      fld('Target quantity', { note: 'adjust mode; cannot drop below reserved' }),
      fld('Reason', { required: true, note: 'captured on every ledger row' }),
      fld('Notes', { required: false }),
      act('Replenish', { triggers: 'adds stock; writes a ledger row' }),
      act('Consume', { enabledWhen: 'available > 0', triggers: 'removes stock' }),
      act('Adjust to target', { triggers: 'sets the on-hand count to a target' }),
      err('INVENTORY_INSUFFICIENT', { friendly: 'Not enough unreserved stock — replenish first or reduce the amount' }),
      faq('Why does adjust refuse to drop below the reserved value?', "You can't have negative-available stock — release the allocation first."),
      faq("I don't see a Delete item button.", 'Items are deactivated, not deleted, to preserve ledger integrity.'),
    ],
  },

  // ───────────────────────────── Admin ─────────────────────────────
  {
    intentLabel: 'workflow settings',
    screenName: 'Admin Settings (Workflow configuration)', screenType: 'settings', route: '/admin', roles: ['admin'],
    purpose: 'Configuration hub: approval thresholds (dollar-band routing rules), notification rules (on/off + test-fire per workflow event), and a read-only role mapping overview. Changes apply to new POs / new events.',
    elements: [
      fld('Approval threshold bands', { detail: 'each band = min amount, max amount, rule (Manager/Owner). Row 0 starts at 0; the last row is open-ended.' }),
      fld('Notification rules', { detail: 'one toggle per workflow event (submitted-to-manager, approved-to-owner, payment-processed, overdue reminder, …)' }),
      btn('Edit / Save / Cancel (thresholds)', { triggers: 'edits the dollar-band routing table' }),
      btn('+ Add band / Remove band'),
      btn('Test fire (notification)', { visibleTo: 'admin', enabledWhen: 'the rule is enabled', triggers: 'sends a test email to you' }),
      btn('Manage users', { triggers: 'opens Manage Users' }),
      act('PO numbering & security card', { note: 'a non-functional UI mockup — not wired to any backend' }, 'dead_ui'),
      err('EMAIL_PROVIDER_UNCONFIGURED', { friendly: 'Email provider not configured — add/rotate the Resend key in Integrations' }),
      faq("I edited thresholds — why don't existing in-flight POs re-route?", 'Thresholds apply to new submissions only; a submitted PO has its routing locked.'),
      faq('How do I add a new notification rule?', 'Not from this UI — the event keys are seeded server-side.'),
    ],
  },
  {
    intentLabel: 'manage hub users',
    screenName: 'Admin Users', screenType: 'settings', route: '/admin/users', roles: ['admin'],
    purpose: 'CRUD over Hub users — invite, edit, deactivate, set role, and CRITICALLY set each employee\'s Manager (the link that scopes Manager queues). Until Manager is set on requesters, manager queues are empty.',
    elements: [
      fld('Email', { required: true, validation: 'email format; unique' }),
      fld('Full name', { required: true }),
      fld('Role', { required: true, options: 'employee / manager / owner / accounting / admin' }),
      fld('Department', { required: false }),
      fld('Manager', { required: false, note: 'CRITICAL — scopes the manager review queue; pick an active manager/owner/admin' }),
      fld('Password', { requiredWhen: 'create (≥ 8 chars); blank on edit keeps it' }),
      fld('Active', { note: 'edit only — inactive users cannot log in' }),
      btn('Invite user', { triggers: 'opens the create form' }),
      btn('Save / Cancel'), btn('Disable / Enable', { triggers: 'deactivates or reactivates a user' }),
      err('EMAIL_TAKEN', { friendly: 'A user with that email already exists' }),
      faq('I invited a manager but their queue is empty.', "Set this manager on each of their direct reports' Manager field, and ensure those reports have POs at the manager stage."),
      faq('How do I delete a user?', "You can't — only deactivate. Historical PO/audit links require retention."),
    ],
  },
  {
    intentLabel: 'bulk csv imports',
    screenName: 'Admin Imports', screenType: 'settings', route: '/admin/imports', roles: ['admin'],
    purpose: 'Six-type bulk CSV importer with a dry-run / commit pattern: upload a CSV, review the dry-run errors, then commit. Every commit appends an audit row to the run history.',
    elements: [
      fld('Import type', { options: 'vendors / departments / GL accounts / locations / hub users / inventory items' }),
      btn('Download template', { triggers: 'downloads a header-only CSV for the chosen type' }),
      btn('Run dry-run', { enabledWhen: 'rows parsed and required columns present', triggers: 'validates without committing' }),
      btn('Commit', { enabledWhen: 'zero errored rows', triggers: 'applies the import' }),
      btn('Discard'),
      err('IMPORT_VALIDATION', { friendly: 'Per-row validation failures — fix the CSV and re-run the dry-run' }),
      faq('My CSV looks right but dry-run says all rows errored on role.', 'Role values are case-sensitive: employee/manager/owner/accounting/admin.'),
      faq('I committed a Hub Users import — can I roll it back?', 'No client rollback; deactivate the imported users manually.'),
    ],
  },
  {
    intentLabel: 'gl accounts',
    screenName: 'GL Accounts Admin', screenType: 'settings', route: '/admin/gl-accounts', roles: ['admin', 'accounting'],
    purpose: 'CRUD over the General Ledger chart of accounts. Drives the per-line GL picker in the wizard; Finalize refuses POs with any line missing a GL account.',
    elements: [
      fld('Code', { required: true, note: 'unique' }), fld('Name', { required: true }),
      fld('Account type', { required: true, options: 'asset / liability / equity / revenue / expense / contra asset' }),
      fld('Parent account', { required: false }), fld('Notes', { required: false }),
      btn('+ New account'), btn('Save / Cancel'), btn('Archive', { enabledWhen: 'account is active' }),
      err('GL_CODE_TAKEN', { friendly: 'That GL code is already in use' }),
      faq("Why can't I delete a GL account?", 'Only archive — finalized POs reference it.'),
      faq('I archived an account but it still shows on a draft PO.', 'The draft predates the archive; edit the line to swap to an active account.'),
    ],
  },
  {
    intentLabel: 'physical locations',
    screenName: 'Locations Admin', screenType: 'settings', route: '/admin/locations', roles: ['admin', 'accounting'],
    purpose: 'CRUD over physical locations used by PO lines, assets and inventory items. Free-text fallback preserved for legacy rows.',
    elements: [
      fld('Name', { required: true, note: 'unique' }), fld('Address', { required: false }), fld('Jurisdiction', { required: false, note: 'e.g. CA-USA' }),
      btn('+ New location'), btn('Save / Cancel'), btn('Archive'),
      err('LOCATION_NAME_TAKEN', { friendly: 'A location with that name already exists' }),
      faq('Can I rename a location?', 'Yes — the rename propagates to everything linked to it (linked by id, not name).'),
    ],
  },
  {
    intentLabel: 'help editor',
    screenName: 'Help Editor', screenType: 'settings', route: '/admin/help', roles: ['admin'],
    purpose: 'Edit, publish/unpublish or reset the in-app help content (per-page + per-role topics + global FAQ). Drafts persist locally; export/import is the round-trip into the next release.',
    elements: [
      tab('Page topics'), tab('Global FAQ'), tab('Import / Export'),
      fld('Question / Answer', { note: 'per topic; editing diverges from the baseline' }),
      btn('Save draft'), btn('Reset'), btn('Publish / Hide'), btn('Export overrides JSON'), btn('Apply import'),
      faq("I edited topics but they didn't appear for my colleague.", 'Overrides are stored per-browser — Export the JSON and share it, or commit it to the next release.'),
    ],
  },
  {
    intentLabel: 'integration keys',
    screenName: 'Integration Keys', screenType: 'settings', route: '/admin/integrations', roles: ['admin'],
    purpose: 'Manage third-party API key secrets (VirusTotal, Resend, Slack webhook, Shodan, GitHub, Lovable AI). Add / Rotate / Remove; each mutation runs a verify chain; an unverified key is refused by downstream consumers.',
    elements: [
      fld('Provider secret', { note: 'per-provider key/URL; never stored in the browser beyond submit' }),
      btn('Refresh', { triggers: 'refreshes provider status' }),
      btn('Add key / Rotate / Remove', { visibleTo: 'admin' }),
      err('VERIFY_CHAIN_FAILED', { friendly: 'Stored but verification failed — downstream consumers refuse it until verified; Rotate to retry' }),
      err('RATE_LIMITED', { friendly: 'Hit the per-minute rate limit — wait the indicated seconds' }),
      faq('I added a Resend key and it says "stored but verification failed" — is email broken?', 'Yes, until fixed — notification emails are skipped while the key is unverified. Rotate with the correct key.'),
    ],
  },

  // ───────────────────────────── Auth + 404 ─────────────────────────────
  {
    intentLabel: 'login',
    screenName: 'Login', screenType: 'auth', route: '/login', roles: ['public'],
    purpose: 'Email + password sign-in. On success returns you to the page you were heading to, or the dashboard.',
    elements: [
      fld('Email', { required: true }), fld('Password', { required: true }),
      btn('Sign in', { triggers: 'authenticates and redirects' }),
      err('AUTH_LOCKED', { friendly: 'Account temporarily locked — try again in a few minutes' }),
      faq('Forgot password link?', 'Not present — password reset is admin-mediated today.'),
    ],
  },
  {
    intentLabel: 'not found',
    screenName: 'Not Found (404)', screenType: 'other', route: '/:pathMatch(.*)*', roles: ALL,
    purpose: 'Catch-all page for unrouted paths, with a link back to the dashboard.',
    elements: [btn('Return to the dashboard', { triggers: 'navigates to the dashboard' })],
  },

  // ───────────────────────────── Role sub-dashboards (dispatched at /) ─────────────────────────────
  {
    intentLabel: 'employee dashboard',
    screenName: 'Employee Dashboard', screenType: 'dashboard', route: '/', roles: ['employee'],
    purpose: 'Requester home — drafts, active requests, a clarification-needed banner, and personal spend metrics. Entry point to the PO Wizard.',
    elements: [
      btn('New Request', { triggers: 'opens the PO Wizard' }), btn('View Registry'),
      act('Stat tiles', { detail: 'Working on (drafts) · Active Requests · Pending Value · Avg. Time to Approve (org-wide)' }),
      faq('Draft progress shows 100% but the wizard still rejects submit.', 'The progress bar is a heuristic — actual submit validation lives in the wizard.'),
    ],
  },
  {
    intentLabel: 'manager dashboard',
    screenName: 'Manager Dashboard', screenType: 'dashboard', route: '/', roles: ['manager'],
    purpose: 'Manager review overview — pending count, urgent count, quarter-to-date approval throughput, and a top-3 preview of awaiting items.',
    elements: [
      btn('Open Review Queue', { triggers: 'opens the Manager Review Queue' }),
      act('Stat tiles', { detail: 'In Your Queue · Approved This Quarter · Avg. Decision Time · Approved Spend (QTD)' }),
      faq('Why is my queue empty when I know there are pending POs?', "Until each direct report has you set as their Manager, the queue is empty." ),
    ],
  },
  {
    intentLabel: 'owner dashboard',
    screenName: 'Owner Dashboard', screenType: 'dashboard', route: '/', roles: ['owner'],
    purpose: 'Owner approval overview and authorized-spend visibility, with a full awaiting-sign-off list.',
    elements: [
      btn('Open Approval Queue', { triggers: 'opens the Owner Approval Queue' }),
      act('Stat tiles', { detail: 'Awaiting Owner · QTD Authorized · Avg. Approval Time · Active Requests' }),
      faq("Where's the Executive Bypass queue?", 'Not on this dashboard — reach it from the sidebar (Bypassed Approvals).'),
    ],
  },
  {
    intentLabel: 'accounting dashboard',
    screenName: 'Accounting Dashboard', screenType: 'dashboard', route: '/', roles: ['accounting'],
    purpose: 'Payment + receipt processing overview — ready-for-payment and awaiting-receipt queues plus an equipment-creation counter.',
    elements: [
      btn('Payment Queue', { triggers: 'opens the Accounting Payment Queue' }),
      act('Stat tiles', { detail: 'Ready for Payment · In Payment · Awaiting Receipt · Equipment Created' }),
      faq('A PO in approved-conditional shows up here — should I pay it?', 'Yes — both approved and approved-conditional route to the payment queue.'),
    ],
  },
  {
    intentLabel: 'admin dashboard',
    screenName: 'Admin Dashboard', screenType: 'dashboard', route: '/', roles: ['admin'],
    purpose: 'System overview for admins — active users, total requests, SLA compliance, equipment records — with quick links to settings and user management.',
    elements: [
      btn('Workflow Settings', { triggers: 'opens Admin Settings' }), btn('Manage Hub Users'),
      act('Stat tiles', { detail: 'Active Users · Total Requests · SLA Compliance · Equipment Records' }),
      faq('SLA Compliance shows a dash — is that bad?', 'No — it means no eligible rows yet (no samples in the window or no targets configured).'),
    ],
  },
];

// ── The documented end-to-end workflows (Workflow Library) as ordered journeys over the page nodes. ──
export const WORKFLOWS: WorkflowDef[] = [
  {
    name: 'Purchase Order Lifecycle',
    businessPurpose: 'Originate a purchase, route it through approval per the threshold tier, pay the vendor, receive goods, finalize the GL, and close.',
    stakeholderType: 'Procurement', personaType: 'employee',
    sequence: ['new purchase request', 'manager review queue', 'owner approval queue', 'accounting payment queue', 'receive queue', 'purchase order detail'],
    successCriteria: 'PO reaches Closed after pay → receive → (verify assets) → finalize → close.',
  },
  {
    name: 'Manager Approval',
    businessPurpose: 'A manager reviews a direct report\'s request and approves, rejects, or asks for clarification.',
    stakeholderType: 'Operations', personaType: 'manager',
    sequence: ['manager review queue', 'purchase order detail'],
    successCriteria: 'PO advances to the Owner stage or returns for clarification.',
  },
  {
    name: 'Owner Executive Sign-off',
    businessPurpose: 'An executive approver gives final sign-off (optionally with conditions) on higher-value requests.',
    stakeholderType: 'CFO', personaType: 'executive',
    sequence: ['owner approval queue', 'purchase order detail', 'bypassed approvals'],
    successCriteria: 'PO is approved (or approved-conditional) and routes to Accounting.',
  },
  {
    name: 'Payment & Receipt',
    businessPurpose: 'Accounting initiates payment, finance marks it paid, then goods are received and assets registered.',
    stakeholderType: 'Procurement', personaType: 'finance',
    sequence: ['accounting payment queue', 'receive queue', 'asset registry', 'purchase order detail'],
    successCriteria: 'PO moves Approved → Processing → Paid → Received; asset lines create equipment records.',
  },
  {
    name: 'Delegation & Escalation',
    businessPurpose: 'Keep approvals moving when an approver is unavailable — delegate authority to a peer, or escalate past a stage.',
    stakeholderType: 'Operations', personaType: 'manager',
    sequence: ['manager review queue', 'purchase order detail', 'bypassed approvals'],
    successCriteria: 'A delegated/auto-routed approval appears under Bypassed; the PO is never blocked.',
  },
  {
    name: 'Asset Lifecycle Management',
    businessPurpose: 'Track a received asset through assign → active → repair/transfer → retire → dispose/archive with full custody history.',
    stakeholderType: 'Operations', personaType: 'operations',
    sequence: ['asset registry', 'asset detail'],
    successCriteria: 'Every lifecycle move is recorded on the asset movement timeline.',
  },
];

// ── Cross-page knowledge facts (business-facing) that aren't tied to one screen — the status model and the
// approval matrix, phrased for a stakeholder. The seed also generates one fact per page from PAGES. ──
export const EXTRA_KNOWLEDGE: { content: string; category?: string; source: string }[] = [
  {
    content: 'A PO.vin purchase order moves through these stages: Draft → Pending Manager → Pending Owner → Approved (In Accounting) → Processing Payment → Paid (Awaiting Receipt) → Received → Closed. Rejected and Cancelled are terminal. A PO can also be put On Hold from most stages and later resumed.',
    category: 'docs', source: 'PO.vin help center · purchase-order lifecycle',
  },
  {
    content: 'PO.vin routes each submitted request by dollar amount against configurable approval thresholds: small amounts route to Manager-only approval; larger amounts route to Owner (executive) approval, with side rules noted for capital, new-vendor, and high-value contracts. When a tier skips a stage, the skipped approval is recorded under Bypassed Approvals for governance review.',
    category: 'docs', source: 'PO.vin help center · approval matrix',
  },
  {
    content: 'PO.vin enforces separation of duties: the person who prepares a purchase order cannot approve it, the person who starts a payment cannot also mark it paid, and the preparer cannot finalize their own PO. Admins/owners can override payment separation, but the override is recorded in the audit trail.',
    category: 'docs', source: 'PO.vin help center · separation of duties',
  },
  {
    content: 'PO.vin recognizes these roles: Employee/Requester (creates and submits POs, receives their own paid POs), Manager (first-stage approval for direct reports), Owner/Executive Approver (second-stage approval, reviews bypassed POs), Accounting (payment, receipt intake, asset verification, finalize/close, GL and locations admin), and Admin (full operational + configuration authority).',
    category: 'docs', source: 'PO.vin help center · roles',
  },
];

/** The canonical set of intent labels — the eval asserts the active graph + knowledge cover all of them. */
export const ALL_INTENT_LABELS = PAGES.map((p) => p.intentLabel);
