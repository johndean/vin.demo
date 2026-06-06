/**
 * Agent safety model (Gap G) — FAIL-CLOSED action classification + default-deny
 * execution-mode policy. The product's hardest guarantee is "never fire a
 * mutating action in a demo", so the classifier defaults UNKNOWN interactive
 * elements to `mutating` (blocked) and grants `read`/`non_destructive` only on
 * positive evidence. Classification considers all accessible-name sources, the
 * href, the element role/container — not just visible text.
 *
 * (Replaces the earlier allowlist that failed OPEN; see increment-2 review.)
 */
export type ExecutionMode = 'read-only' | 'safe' | 'approval' | 'execution';
export type ActionClass = 'read' | 'non_destructive' | 'mutating';

export interface ActionCandidate {
  tag: string;            // 'a' | 'button' | 'tr' | 'input' | ...
  type?: string | null;
  role?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  text?: string | null;
  href?: string | null;
  className?: string | null;
  inNav?: boolean;
}

// State-changing verbs/stems — broad, inflection-tolerant, NOT strictly \b-anchored.
// `approve`/`delegate` match the VERB inflections only (approve/approved/approving),
// NOT the screen-name NOUNS (approval/approvals, delegation) — those are nav labels,
// not mutations (discovered onboarding expense.vin, P3.1).
const MUTATING =
  /(submit|approve(?:s|d)?|approving|reject|den(y|ied|ies)|delet|remov|\bpay\b|paid|saved?|saving|creat|\bsend\b|\bsent\b|\bpost\b|confirm|cancel|void|archiv|delegate(?:s|d)?|delegating|escalat|\bhold\b|reassign|overrid|authoriz|sign[\s_-]?off|finaliz|releas|publish|\bfund|disburse|reimburse(?:s|d)?|reimbursing|trigger|activat|deactivat|suspend|terminat|refund|transfer|allocat|dispatch|\brun\b|execut|commit|push\b)/i;
// Dangerous GET endpoints (a link is not proof of safety — GET can mutate).
const HREF_DANGER =
  /\/(approve|delete|remove|authoriz|release|pay|submit|cancel|reject|delegate|post|save|create|confirm|issue|void|archive|hold|escalate|reassign|override|sign|finaliz|publish|fund|execute|run|trigger|activate|deactivate|suspend|terminate|refund|transfer)(s|d|ing)?\b|[?&]action=/i;
// Positive READ signals.
const READ_VERB = /\b(view|opens?|details?|back|home|dashboard|overview|preview|read|expand|collapse|show|list)\b/i;
const NAV_LABEL = /(queue|registry|vendors?|reports?|dashboard|inventory|assets?|locations?|home|overview|workflow map|bypassed|approvals?|delegation|clarifications?|departments?|analytics|audit log|controls?|configuration)$/i;
const NON_DESTRUCTIVE = /\b(filter|search|sort|tab|refresh|toggle)\b/i;
const HELP_LEADING = /^\s*(how|why|what|where|when|can i)\b/i;
const AUTH_NAV = /\b(sign[\s_-]?out|log[\s_-]?out|logout|sign[\s_-]?in)\b/i;

export interface Classification {
  cls: ActionClass;
  reason: string;
  /** true = positive evidence for this class; false = fail-closed default (unknown,
   *  blocked for safety but NOT a confirmed mutation — don't report it as one). */
  confident: boolean;
}

/** All accessible-name sources, so an aria-label can't hide a dangerous control. */
function names(el: ActionCandidate): string[] {
  return [el.text, el.ariaLabel, el.title].map((s) => (s || '').trim()).filter(Boolean);
}

export function classifyAction(el: ActionCandidate): Classification {
  const ns = names(el);
  const joined = ns.join(' • ');

  // 0) A leading interrogative ("How do I approve?") is a help/FAQ label, not an action —
  //    classify it read before the verb scan so an embedded verb can't trip it (still
  //    deferring to a dangerous href). Discovered onboarding expense.vin (P3.1).
  if (HELP_LEADING.test(joined) && !(el.href && HREF_DANGER.test(el.href))) {
    return { cls: 'read', reason: 'leading-interrogative help text', confident: true };
  }

  // 1) DANGEROUS first — any name source OR the href. Mutation always wins.
  if (ns.some((n) => MUTATING.test(n))) return { cls: 'mutating', reason: `mutating verb in "${joined}"`, confident: true };
  if (el.href && HREF_DANGER.test(el.href)) return { cls: 'mutating', reason: `mutating href "${el.href}"`, confident: true };

  // 2) Positive READ evidence (only reached once we know nothing dangerous matched).
  const safeRoute = !!el.href && (el.href.startsWith('/') || el.href.startsWith('#')) && !HREF_DANGER.test(el.href);
  const navContainer = el.inNav === true || el.role === 'link' || el.role === 'menuitem' || el.role === 'tab' || el.tag === 'tr' || el.role === 'row';
  if (navContainer) return { cls: 'read', reason: 'navigation container/role', confident: true };
  if (safeRoute) return { cls: 'read', reason: `safe route "${el.href}"`, confident: true };
  if (AUTH_NAV.test(joined)) return { cls: 'read', reason: 'auth navigation', confident: true };
  if (READ_VERB.test(joined) || NAV_LABEL.test(joined)) return { cls: 'read', reason: `read/nav label "${joined}"`, confident: true };

  // 3) Known non-destructive interactive controls.
  if (NON_DESTRUCTIVE.test(joined)) return { cls: 'non_destructive', reason: `non-destructive "${joined}"`, confident: true };

  // 4) FAIL CLOSED — unknown interactive element (incl. empty/icon-only) is blocked
  //    for safety, but flagged NOT confident: it's a defensive hold, not a confirmed mutation.
  return {
    cls: 'mutating',
    reason: ns.length ? `unrecognized control "${joined}" (fail-closed)` : 'no accessible name (fail-closed)',
    confident: false,
  };
}

export interface Permission {
  permitted: boolean;
  requiresApproval: boolean;
  reason: string;
}

/** Default-deny policy: each mode permits its class and everything safer. */
export function permits(cls: ActionClass, mode: ExecutionMode): Permission {
  const deny = (reason: string): Permission => ({ permitted: false, requiresApproval: false, reason });
  switch (mode) {
    case 'read-only':
      return cls === 'read' ? ok('read-only allows reads') : deny(`read-only forbids ${cls}`);
    case 'safe':
      return cls === 'mutating' ? deny('safe forbids mutating') : ok(`safe allows ${cls}`);
    case 'approval':
      return cls === 'mutating'
        ? { permitted: false, requiresApproval: true, reason: 'mutating requires human approval' }
        : ok(`approval allows ${cls}`);
    case 'execution':
      return ok('execution allows all');
  }
}

function ok(reason: string): Permission {
  return { permitted: true, requiresApproval: false, reason };
}
