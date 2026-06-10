# Buying-Committee Intelligence — Authoring Spec (shared)

You are authoring **buying-committee intelligence + business outcomes** for the VIN AI Demo Platform.
This data is loaded into the platform and used by an AI to build demo narratives, select journeys/evidence,
simulate stakeholder concerns, generate objections, run buying-committee discussions, write executive
summaries, and coach demos. **It must be real, specific, and product-aware — never placeholder, never generic.**

Your task assignment (the message that points you here) tells you: the **product**, an accurate **product
description**, a **grounding file to read first**, your assigned **committee roles** (with `sortOrder`), and —
for part `a` only — the **20 business-outcome titles** to enrich. Read the grounding file before writing so
your vocabulary matches the real screens/capabilities/terminology of that product.

---

## CRITICAL RULES (this is the whole point)

1. **Product-specific.** Every item must make sense for THIS product. Reference its real capabilities, screens,
   workflows, and terminology (from the grounding file). A concern that could be pasted onto any SaaS tool is a failure.
2. **Role-specific.** A Comptroller's concerns ≠ an Operations Manager's concerns. Each role evaluates from its own seat.
3. **Unique.** No two stakeholders share the same items. No filler, no near-duplicates within a list.
4. **The same role differs by product.** (You only see one product — just make yours genuinely about it.)
5. **Realistic buyers.** These are **SMB / mid-market / operational organizations** (the kind in a BambooHR import) —
   owners, operators, managers. **Avoid Fortune-500 assumptions and enterprise-only clichés** (no "board mandate",
   "global rollout", "digital transformation office", CIO/CISO/CDO theater). Plain operational language.
6. **Business-facing only (FIREWALL).** Never reference file names, table/SQL identifiers, HTTP routes as
   identifiers, env-var names, internal codes, or engineering jargon. Write what a buyer would actually say.
7. **Identify by ROLE — no fabricated people.** Set `name` to the role string (identical to `role`). Do NOT
   invent person names; the buying committee is identified by role. Real names, if ever used, come only from the
   customer's actual org chart — never invented.

---

## FIELD REQUIREMENTS

### Business Outcomes (part `a` only — enrich the 20 titles you're given)
For **each** of the 20 titles (keep the title **verbatim** — it's the match key):
- `title` — exactly as given.
- `description` — 1–2 sentences, **business/executive** framing, measurable, outcome-focused (not a feature). Product-specific.
- `successIndicators` — **3–5** measurable signals an executive would track for this outcome (specific to this product's reality).

### Committee stakeholders (each assigned role)
- `name` — set to the role string (no invented person names; see rule 7).
- `role` — **exactly** the assigned role string.
- `influence` — one of `high` | `medium` | `low`. Realistic influence on the purchase decision.
- `riskLevel` — one of `high` | `medium` | `low`. Perceived exposure to this person if the project fails.
- `decisionAuthority` — one of `decision_maker` | `approver` | `champion` | `influencer` | `evaluator`.
  - `decision_maker`: signs off / owns the budget (Owner / Managing Director / CEO).
  - `approver`: must approve (COO / Comptroller / Finance Director-level).
  - `champion`: the internal advocate who owns the product day-to-day and pushes adoption.
  - `evaluator`: hands-on assessor who pressure-tests it (SME / QA / reviewer / specialist manager).
  - `influencer`: shapes the decision without formal authority.
  - The **Owner / Managing Director** in your set (sortOrder 0, part `a`) must be `decision_maker`.
- `sortOrder` — the integer given for that role.
- `interests` — **≥10**: what this person genuinely cares about re: this product.
- `decisionCriteria` — **≥10**: how this person evaluates the product (what would make them a yes/no).
- `goals` — **≥10**: the business outcomes this person wants, in their own terms.
- `objections` — **≥10**: realistic pushback. Cover, where relevant: budget, adoption/change-management,
  implementation/effort, reporting/visibility, governance/control, and integration/data.
- `openQuestions` — **≥15**: questions this person would actually ask during a demo. Specific enough to **drive demo paths**.

Hit the minimums; exceeding them is welcome where natural. Quality over padding — but never go under.

---

## OUTPUT — write valid JSON ONLY to the path you're given (use the Write tool)

```json
{
  "product": "<exact product name from your assignment>",
  "outcomes": [
    { "title": "<verbatim>", "description": "...", "successIndicators": ["...", "...", "..."] }
  ],
  "committee": [
    {
      "name": "<same as role>", "role": "<assigned role>", "influence": "high", "riskLevel": "medium",
      "decisionAuthority": "approver", "sortOrder": 3,
      "interests": ["...", "..."],
      "decisionCriteria": ["...", "..."],
      "goals": ["...", "..."],
      "objections": ["...", "..."],
      "openQuestions": ["...", "..."]
    }
  ]
}
```

- Part `a`: include all 20 `outcomes` + your assigned committee roles.
- Part `b`: `"outcomes": []` + your assigned committee roles only.
- Strings only inside arrays. No comments, no markdown, no trailing prose. **Valid JSON only.**
- After writing the file, reply with a single line: `wrote <product> part <a|b>: <N> stakeholders, <M> outcomes`.

---

## CALIBRATION

**GOOD** (objection, Comptroller, PO.vin — concrete, product-aware, role-true):
> "If a manager is out, does an approval just sit in their queue — or can I see and reassign aging approvals before month-end close slips?"

**BAD** (generic, could be any tool — never write like this):
> "Is it secure?" · "Will it save time?" · "What's the ROI?" · "Is it easy to use?"

Specific beats broad every time. Make every line unmistakably about THIS product and THIS role.
