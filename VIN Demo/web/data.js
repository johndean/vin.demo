/* VIN Demo — shared demo dataset (internally consistent across all console views)
   The portfolio VIN Demo can demonstrate is VIN's veterinary-professional
   software suite. Prospects are veterinary practices & hospital groups. */

window.VD = (function () {
  const products = [
    {
      id: "demo", name: "demo.vin", domain: "demo.vin", tagline: "Approvals & requests",
      version: "3.4", versions: ["3.4 (current)", "3.3", "3.2", "3.1"],
      mk: "DV", color: "#002855",
      status: "Ready", coverage: 93, chunks: 1342, demos: 52,
      kbValidated: 88, kbReview: 8, kbStale: 4,
      env: "demo-04", envStatus: "Healthy", lastReset: "1h ago",
      graphNodes: 41, graphFlows: 7,
    },
    {
      id: "expense", name: "expense.vin", domain: "expense.vin", tagline: "Staff expense capture & reimbursement",
      version: "2.1", versions: ["2.1 (current)", "2.0", "1.9"],
      mk: "EX", color: "#0097A9",
      status: "Ready", coverage: 81, chunks: 690, demos: 23,
      kbValidated: 76, kbReview: 15, kbStale: 9,
      env: "expense-demo-02", envStatus: "Healthy", lastReset: "4h ago",
      graphNodes: 26, graphFlows: 4,
    },
    {
      id: "ce", name: "ce.vin", domain: "ce.vin", tagline: "Continuing-education credits & compliance tracking",
      version: "5.0", versions: ["5.0 (current)", "4.8", "4.7"],
      mk: "CE", color: "#007D61",
      status: "Ready", coverage: 87, chunks: 910, demos: 31,
      kbValidated: 82, kbReview: 12, kbStale: 6,
      env: "ce-demo-01", envStatus: "Healthy", lastReset: "1d ago",
      graphNodes: 33, graphFlows: 5,
    },
    {
      id: "rounds", name: "rounds.vin", domain: "rounds.vin", tagline: "Case rounds & team discussion boards",
      version: "1.6", versions: ["1.6 (current)", "1.5"],
      mk: "RD", color: "#4D6995",
      status: "Training", coverage: 58, chunks: 402, demos: 6,
      kbValidated: 49, kbReview: 34, kbStale: 17,
      env: "rounds-demo-01", envStatus: "Reset pending", lastReset: "5d ago",
      graphNodes: 18, graphFlows: 3,
    },
    {
      id: "modelcontract", name: "modelcontract.software", domain: "modelcontract.software", tagline: "Employment-contract builder + embeddable wizard",
      version: "4.0", versions: ["4.0 (current)", "3.9", "3.8"],
      mk: "MC", color: "#0861CE",
      status: "Ready", coverage: 79, chunks: 558, demos: 14,
      kbValidated: 70, kbReview: 20, kbStale: 10,
      env: "mc-demo-03", envStatus: "Healthy", lastReset: "2d ago",
      graphNodes: 22, graphFlows: 4,
    },
    {
      id: "defensive", name: "defensive.software", domain: "defensive.software", tagline: "Defensible record documentation",
      version: "2.3", versions: ["2.3 (current)", "2.2"],
      mk: "DF", color: "#B9975B",
      status: "Training", coverage: 47, chunks: 240, demos: 3,
      kbValidated: 38, kbReview: 40, kbStale: 22,
      env: "defensive-demo-01", envStatus: "Reset pending", lastReset: "8d ago",
      graphNodes: 14, graphFlows: 2,
    },
  ];

  const knowledge = [
    { id: "k1", title: "Approval delegation — setup & rules", type: "sop", conf: 0.96, source: "demo.vin Admin Guide §7.3", verified: "4 days ago", ver: "3.4", status: "validated" },
    { id: "k2", title: "Multi-tier approval thresholds", type: "docs", conf: 0.93, source: "demo.vin Admin Guide §7.1", verified: "4 days ago", ver: "3.4", status: "validated" },
    { id: "k3", title: "Delegation vs. substitute approver — when to use", type: "faq", conf: 0.88, source: "Support KB #2241", verified: "11 days ago", ver: "3.4", status: "validated" },
    { id: "k4", title: "Out-of-office auto-delegation", type: "release_note", conf: 0.71, source: "Release 3.4 notes", verified: "2 days ago", ver: "3.4", status: "needs-review" },
    { id: "k5", title: "Bulk approval for inventory restock", type: "sop", conf: 0.62, source: "demo.vin Admin Guide §7.8", verified: "84 days ago", ver: "3.2", status: "stale" },
    { id: "k6", title: "vs. Coupa — approval flexibility", type: "competitor_positioning", conf: 0.84, source: "Sales battlecard Q1", verified: "21 days ago", ver: "3.4", status: "validated" },
    { id: "k7", title: "Approval audit trail & compliance log", type: "docs", conf: 0.91, source: "demo.vin Admin Guide §9.2", verified: "9 days ago", ver: "3.4", status: "validated" },
    { id: "k8", title: "Mobile approvals for managers on the go", type: "faq", conf: 0.79, source: "Support KB #1980", verified: "30 days ago", ver: "3.3", status: "needs-review" },
  ];

  const kbTypes = {
    docs: { label: "Docs", cls: "pill-info" },
    faq: { label: "FAQ", cls: "pill-steel" },
    sop: { label: "SOP", cls: "pill-navy" },
    release_note: { label: "Release note", cls: "pill-success" },
    competitor_positioning: { label: "Competitive", cls: "pill-warn" },
  };

  const personas = [
    { id: "p1", name: "Compliance Specialist", scope: "Audit trails, SOC 2, segregation of duties", calls: 12, brand: "Approved", color: "#4D6995", limits: "No legal commitments · cites docs only" },
    { id: "p2", name: "Integration Engineer", scope: "REST API, ERP/SSO/SCIM connectors, webhooks", calls: 8, brand: "Approved", color: "#0097A9", limits: "No custom-dev promises" },
    { id: "p3", name: "Pricing Specialist", scope: "Packaging, volume discounts, ROI framing", calls: 5, brand: "Approved", color: "#B9975B", limits: "No binding quotes · ranges only" },
  ];

  // The demo audience: a prospect's buying committee, modeled as a collection.
  const stakeholders = [
    { id: "s1", name: "Maya Chen", role: "Product Owner", initials: "MC", color: "#002855", active: true, interest: "Does delegation fit our real approval workflow and its edge cases?", open: 2, asked: 3 },
    { id: "s2", name: "Daniel Okafor", role: "Developer", initials: "DO", color: "#0097A9", active: false, interest: "API surface, SSO/SCIM, and how delegation events hit our systems.", open: 1, asked: 1 },
    { id: "s3", name: "Priya Raman", role: "Manager", initials: "PR", color: "#007D61", active: false, interest: "Team adoption and day-to-day overhead for approvers.", open: 0, asked: 2 },
    { id: "s4", name: "Robert Vance", role: "Executive", initials: "RV", color: "#4D6995", active: false, interest: "ROI and rollout risk across the org.", open: 1, asked: 0 },
    { id: "s5", name: "Susan Albright", role: "Owner", initials: "SA", color: "#B9975B", active: false, interest: "Total cost and strategic value before sign-off.", open: 1, asked: 0 },
  ];

  // Prospects: departments evaluating the products.
  const customers = [
    { id: "c1", name: "Procurement", seg: "12 approvers · evaluating demo.vin", stage: "Live demo", product: "demo.vin", sessions: 3, stakeholders: 5, next: "In session now", color: "#002855", hot: true },
    { id: "c2", name: "Finance & Accounting", seg: "evaluating expense.vin", stage: "Demo scheduled", product: "expense.vin", sessions: 1, stakeholders: 3, next: "Jun 11, 2:00 PM CT", color: "#0097A9" },
    { id: "c3", name: "People & L&D", seg: "evaluating ce.vin", stage: "Follow-up", product: "ce.vin", sessions: 2, stakeholders: 5, next: "Jun 13, 10:30 AM CT", color: "#007D61" },
    { id: "c4", name: "Engineering", seg: "technical buyer · evaluating rounds.vin", stage: "Qualifying", product: "rounds.vin", sessions: 0, stakeholders: 2, next: "Unscheduled", color: "#4D6995" },
  ];

  const sessions = [
    { id: "d1", customer: "Procurement", product: "demo.vin", scenario: "Approval delegation", when: "Now · live", mode: "read-only", status: "Live", dur: "12:04", cost: 0.83, conf: 0.91, stakeholders: 5 },
    { id: "d2", customer: "People & L&D", product: "ce.vin", scenario: "CE compliance audit", when: "Jun 4", mode: "safe", status: "Completed", dur: "27:41", cost: 1.92, conf: 0.88, stakeholders: 5 },
    { id: "d3", customer: "Procurement", product: "demo.vin", scenario: "Request lifecycle", when: "Jun 2", mode: "read-only", status: "Completed", dur: "19:08", cost: 1.21, conf: 0.94, stakeholders: 3 },
    { id: "d4", customer: "Finance & Accounting", product: "expense.vin", scenario: "Reimbursement controls", when: "May 28", mode: "read-only", status: "Completed", dur: "15:33", cost: 0.97, conf: 0.9, stakeholders: 5 },
    { id: "d5", customer: "Engineering", product: "rounds.vin", scenario: "Case rounds setup", when: "May 24", mode: "read-only", status: "Recovered", dur: "22:10", cost: 1.44, conf: 0.76, stakeholders: 2 },
  ];

  const evals = [
    { id: "e1", name: "Intent recognition", score: 0.94, target: 0.90, runs: 312, trend: "up" },
    { id: "e2", name: "Navigation success", score: 0.91, target: 0.92, runs: 287, trend: "down" },
    { id: "e3", name: "Hallucination rate", score: 0.018, target: 0.02, runs: 312, trend: "up", invert: true, fmt: "pct" },
    { id: "e4", name: "Recovery success", score: 0.87, target: 0.85, runs: 64, trend: "up" },
    { id: "e5", name: "Context retention", score: 0.89, target: 0.88, runs: 198, trend: "flat" },
  ];

  const costBreakdown = [
    { k: "LLM tokens", v: 0.41, color: "#002855", pct: 49 },
    { k: "Embeddings", v: 0.06, color: "#4D6995", pct: 7 },
    { k: "Navigation / compute", v: 0.28, color: "#0097A9", pct: 34 },
    { k: "Storage", v: 0.08, color: "#B9975B", pct: 10 },
  ];

  return { products, knowledge, kbTypes, personas, stakeholders, customers, sessions, evals, costBreakdown };
})();
