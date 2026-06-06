/**
 * Agent safety model (Gap G) — element/intent-aware action classification +
 * default-deny execution-mode policy. Upgrades the Phase 0 spike's text-only
 * regex guard: classification uses the element's tag/type/role/class/context,
 * not just its label, so navigation ("Bypassed", a sidebar item) is correctly
 * read while an action ("Delegate to teammate") is correctly mutating.
 */
export type ExecutionMode = 'read-only' | 'safe' | 'approval' | 'execution';
export type ActionClass = 'read' | 'non_destructive' | 'mutating';

/** What we can observe about a candidate element before deciding to click it. */
export interface ActionCandidate {
  tag: string;            // 'a' | 'button' | ...
  type?: string | null;   // input/button type, e.g. 'submit'
  role?: string | null;
  ariaLabel?: string | null;
  text?: string | null;
  href?: string | null;
  className?: string | null;
  inNav?: boolean;        // inside a <nav>/sidebar container
}

const MUTATING = /\b(submit|approve|reject|deny|delete|remove|pay|save|create|send|post|confirm|issue|cancel|void|archive|delegate|escalate|hold|reassign|override)\b/i;
const NON_DESTRUCTIVE = /\b(filter|search|sort|expand|collapse|show|view|toggle|tab|refresh|details|open)\b/i;
const HELP = /^\s*(how|why|what|where|when|can i)\b|\?\s*$/i;

export interface Classification {
  cls: ActionClass;
  reason: string;
}

/** Classify a candidate action by its element semantics, not just its label. */
export function classifyAction(el: ActionCandidate): Classification {
  const label = (el.text || el.ariaLabel || '').trim();

  // Help-panel questions are not actions.
  if (HELP.test(label)) return { cls: 'read', reason: 'help/question text' };

  // True navigation: anchors with a route, sidebar/nav items, link/menuitem roles.
  const isNav =
    (el.tag === 'a' && !!el.href) ||
    el.role === 'link' ||
    el.role === 'menuitem' ||
    el.inNav === true ||
    /sidebar|nav-|menu-item/i.test(el.className || '');
  if (isNav && !MUTATING.test(label)) return { cls: 'read', reason: 'navigation element' };

  // Mutating: a form submit, or an action label containing a state-changing verb.
  if (el.type === 'submit' && MUTATING.test(label)) return { cls: 'mutating', reason: `submit + verb "${label}"` };
  if (MUTATING.test(label)) return { cls: 'mutating', reason: `mutating verb in "${label}"` };

  // Non-destructive interactive controls.
  if (NON_DESTRUCTIVE.test(label)) return { cls: 'non_destructive', reason: `non-destructive control "${label}"` };

  // A bare submit with no verb (e.g. a search box submit) is non-destructive.
  if (el.type === 'submit') return { cls: 'non_destructive', reason: 'generic submit' };

  // Default: an unrecognised button is treated as non-destructive (safe-side: it
  // still won't fire in read-only mode); pure text/links default to read.
  return el.tag === 'button'
    ? { cls: 'non_destructive', reason: 'unclassified button' }
    : { cls: 'read', reason: 'default read' };
}

export interface Permission {
  permitted: boolean;
  requiresApproval: boolean;
  reason: string;
}

/** Default-deny policy: each mode permits its class and everything below it. */
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
