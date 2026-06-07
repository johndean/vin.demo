/* VIN Demo control room — the demo-loop state machine (beats).
   One ordered sequence the runtime plays/steps through. This is the clean
   seam: swap BEATS for a live LangGraph trace and the UI is unchanged. */

const LOOP = ["Intent", "Retrieve", "Navigate", "Demonstrate", "Explain", "Follow-up", "Return"];
const PLAN = [
  { t: "Understand the question", p: "intent" },
  { t: "Retrieve a cited answer", p: "retrieval" },
  { t: "Navigate to Delegation rules", p: "navigation" },
  { t: "Demonstrate the feature", p: "demonstration" },
  { t: "Explain the business value", p: "explanation" },
  { t: "Handle follow-ups", p: "governance" },
  { t: "Return to context & recap", p: "context" },
];

const QUOTES = {
  k1: "Delegation lets an approver temporarily reassign authority for a defined window; delegated approvals retain the original threshold and are fully logged.",
  k7: "delegation.created and delegated.approval events emit webhooks; the delegate's SSO identity is preserved as the acting party.",
  k4: "Out-of-office status can auto-route pending approvals to a named delegate.",
};

// message helper
const M = (side, who, role, av, color, text, tag, uncertain) => ({ side, who, role, av, color, text, tag, uncertain });

const SEED = [
  M("ai", "Consultant", "VIN Demo", "AI", "#002855", "I'm your demo.vin solution consultant. I'll walk through approval delegation on a demo tenant — read-only, so nothing real changes. Ask me anything as we go."),
  M("them", "Maya Chen", "Product Owner", "MC", "#002855", "How does approval delegation work? We need coverage when an approver is on leave.", "question"),
];

const stk = { s1: ["Maya Chen", "Product Owner", "MC", "#002855"], s2: ["Daniel Okafor", "Developer", "DO", "#0097A9"], s3: ["Priya Raman", "Manager", "PR", "#007D61"], s4: ["Robert Vance", "Executive", "RV", "#4D6995"], s5: ["Susan Albright", "Owner", "SA", "#B9975B"] };
const aiMsg = (text, tag, uncertain) => M("ai", "Consultant", "VIN Demo", "AI", "#002855", text, tag, uncertain);
const them = (id, text, tag) => M("them", stk[id][0], stk[id][1], stk[id][2], stk[id][3], text, tag);

const BEATS = [
  // 0 — ready (pre-play)
  { loopIdx: -1, planIdx: -1, phase: "Ready", brain: "Plan loaded. Read-only mode. Demo tenant demo-04 seeded & reset 1h ago.", sub: "awaiting start", screen: "dashboard", conf: 0.91, activeStk: "s1", cost: 0.00, cite: null, push: [], event: null },
  // 1 — intent
  { loopIdx: 0, planIdx: 0, phase: "Understand intent", brain: "Parsed intent → explain approval delegation. Constraint captured: coverage during approver absence.", sub: "intent: explain_feature(delegation)", screen: "dashboard", conf: 0.91, activeStk: "s1", cost: 0.07, cite: null, push: [] },
  // 2 — retrieve
  { loopIdx: 1, planIdx: 1, phase: "Retrieve (cited)", brain: "Vector search over demo.vin KB (pgvector). One high-confidence, validated, current match.", sub: "1 chunk · v3.4 · conf 0.96", screen: "dashboard", conf: 0.96, activeStk: "s1", cost: 0.19, cite: "k1", push: [] },
  // 3 — navigate (start)
  { loopIdx: 2, planIdx: 2, phase: "Navigate", brain: "Planning shortest path: Dashboard → Approvals → Delegation. Acting in read-only.", sub: "nav → /approvals", screen: "approvals", conf: 0.96, activeStk: "s1", cost: 0.27, cite: "k1",
    hl: { x: 27, y: 30, w: 15, h: 12 }, cursor: { x: 34, y: 36 }, callout: { x: 27, y: 46, label: "Navigating", text: "Opening Approvals → Delegation." },
    push: [aiMsg("Let me show you. I'm opening the Approvals area now.")] },
  // 4 — self-heal
  { loopIdx: 2, warn: true, planIdx: 2, phase: "Recover · self-heal", brain: "Selector [data-pa=delegation-tab] drifted from the demo graph. Re-grounding by role + visible label rather than failing.", sub: "heal: selector → label match", screen: "approvals", conf: 0.93, activeStk: "s1", cost: 0.31, cite: "k1",
    hl: { x: 27, y: 30, w: 15, h: 12 }, cursor: { x: 34, y: 36 }, event: "heal", push: [] },
  // 5 — recovered → delegation screen
  { loopIdx: 2, planIdx: 2, phase: "Navigate", brain: "Recovered. Matched the 'Delegation' control by label and continued — no dead end.", sub: "nav → /approvals/delegation", screen: "delegation", conf: 0.95, activeStk: "s1", cost: 0.36, cite: "k1",
    hl: { x: 50, y: 34, w: 44, h: 14 }, cursor: { x: 70, y: 40 }, callout: { x: 8, y: 16, label: "Delegation rules", text: "Re-grounded by label — here's the Delegation rules screen." }, push: [] },
  // 6 — demonstrate
  { loopIdx: 3, planIdx: 3, phase: "Demonstrate", brain: "Walking the live UI: choose delegate + window; the delegate inherits the original threshold.", sub: "demonstrate: delegation_rule", screen: "delegation", conf: 0.95, activeStk: "s1", cost: 0.46, cite: "k1",
    hl: { x: 50, y: 34, w: 44, h: 14 }, cursor: { x: 72, y: 40 }, callout: { x: 8, y: 56, label: "How it works", text: "Pick a delegate and a window. They inherit the same Tier-2 limit — authority is never widened." },
    push: [aiMsg("An approver hands authority to a delegate for a set window. The delegate inherits the exact same threshold, so limits never loosen.")] },
  // 7 — explain value
  { loopIdx: 4, planIdx: 4, phase: "Explain value", brain: "Connecting the feature to the stated business goal: no stalled POs, audit stays intact.", sub: "explain: value(coverage, audit)", screen: "delegation", conf: 0.95, activeStk: "s1", cost: 0.55, cite: "k1",
    hl: { x: 6, y: 70, w: 60, h: 9 }, cursor: { x: 12, y: 74 }, callout: { x: 8, y: 22, label: "Why it matters", text: "Every delegated approval is logged. When someone's out, POs keep moving and the audit trail stays clean." },
    push: [aiMsg("So when an approver's on leave, purchasing doesn't stall — and because each delegated approval is logged, you stay audit-ready.")] },
  // 8 — interrupt: objection (Developer)
  { loopIdx: 5, planIdx: 5, phase: "Handle interruption", brain: "Interrupt from Developer — technical objection. Pausing the plan; switching active stakeholder.", sub: "interrupt: objection", screen: "delegation", conf: 0.95, activeStk: "s2", cost: 0.61, cite: "k1",
    push: [them("s2", "Hold on — does a delegation event fire a webhook so our downstream systems stay in sync?", "objection")] },
  // 9 — answer objection (persona handoff)
  { loopIdx: 5, planIdx: 5, phase: "Delegate to specialist", brain: "Handing to Integration Engineer persona (scoped: API/SSO). High-confidence, validated source.", sub: "persona: integration_engineer", screen: "audit", conf: 0.91, activeStk: "s2", cost: 0.72, cite: "k7",
    hl: { x: 5, y: 30, w: 90, h: 14 }, cursor: { x: 30, y: 36 }, callout: { x: 8, y: 56, label: "Integration Engineer", text: "Yes — delegation events emit webhooks; the delegate's SSO identity is preserved on the event." },
    push: [aiMsg("Yes. Both delegation.created and delegated.approval fire webhooks, and the delegate's SSO identity is preserved as the acting party. — Integration Engineer")] },
  // 10 — low-confidence follow-up → degrade
  { loopIdx: 5, planIdx: 5, phase: "Confidence gate", brain: "Best match is needs-review (conf 0.71, v3.3) — below the 0.70 assert margin for a live claim. Degrading gracefully.", sub: "degrade: cite_not_assert", screen: "newdelegation", conf: 0.71, activeStk: "s3", cost: 0.81, cite: "k4",
    push: [them("s3", "Can it auto-delegate the moment someone marks themselves out-of-office?", "question"), aiMsg("I'm not fully certain here. There's an out-of-office auto-delegation toggle, but my source is a release note still pending review — so I'd rather show you the doc than overstate it.", null, true)] },
  // 11 — blocked mutation
  { loopIdx: 5, planIdx: 5, phase: "Action blocked", brain: "Action classified MUTATING (submit request). Mode = read-only → denied by the safety gate.", sub: "blocked: submit_request", screen: "delegation", conf: 0.95, activeStk: "s5", cost: 0.85, cite: null,
    event: "block", push: [them("s5", "Just submit REQ-4821 for real so we can see it end-to-end.", "curiosity"), aiMsg("I can't submit a real request in a demo — that's a mutating action and we're in read-only mode on a demo tenant. I'll narrate exactly what would happen, and your team can grant approval mode in your own environment.")] },
  // 12 — return to context
  { loopIdx: 6, planIdx: 6, phase: "Return to context", brain: "Interruptions resolved. Resuming the plan where we paused — recap the delegation rule.", sub: "resume: step 5/7", screen: "delegation", conf: 0.95, activeStk: "s1", cost: 0.91, cite: "k1",
    hl: { x: 50, y: 34, w: 44, h: 14 }, cursor: { x: 70, y: 40 }, callout: { x: 8, y: 16, label: "Back on track", text: "Where we were: Owner → Executive, Tier 2, one week, fully logged." },
    push: [aiMsg("Coming back to our delegation: Owner to Executive, one week, audit on. That's approval delegation end to end.")] },
  // 13 — done
  { loopIdx: 7, loopDone: true, planIdx: 7, phase: "Demo complete", brain: "Scenario complete. Never fired a mutating action. Cost recorded to the session.", sub: "✓ MVP loop · $0.94", screen: "audit", conf: 0.95, activeStk: "s1", cost: 0.94, cite: "k1",
    push: [aiMsg("Here's the audit trail with the delegated approvals logged. Want to go deeper on webhooks, or talk rollout?")] },
];

Object.assign(window, { LOOP, PLAN, QUOTES, SEED, BEATS });
