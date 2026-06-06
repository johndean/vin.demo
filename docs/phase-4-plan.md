# Phase 4 — Self-service onboarding (plan)

**Goal (impl plan §Phase 4):** turn the learned adapter contract into **"Add → Train → Demo"** — onboard a product from DATA, not code. **Trigger met:** the `InteractionAdapter` contract is stable across **5** manually onboarded products (P3).

**Still engine-only.** "Self-service" here = a declarative **manifest** + a CLI **`onboard`** command (config-not-code), NOT a UI. Interaction modality / deployment stays deferred to **P5+**.

**The shift:** today adding a product needs CODE — a `CONFIGS` entry in `driver.ts` + a `seed-<product>.ts`. P4 makes both DATA.

## Increments
- [x] **P4.1 — Adapter config as data.** **Done.** Migration `0005` adds `environments.adapter_config` (jsonb); `getAdapter` is now async and prefers the product's DB config, falling back to the in-code `CONFIGS` registry — so the 5 hand-configured products keep working **untouched** (migration-agnostic). Made `ProductWebConfig` JSON/jsonb-serializable (`recordRowFilterText` RegExp → string pattern, compiled at use). `eval:phase1` 8/8 (po.vin falls back cleanly; regex-as-string row filter still opens a PO).
- [x] **P4.2 — Onboarding manifest + `npm run onboard <manifest.json>`.** One declarative manifest per product (name, version, base URL, login config, personas, DemoGraph nodes, expected intents, knowledge sources) → provisions product + version + environment + adapter config + DemoGraph + expected intents — generalizing the five `seed-<product>.ts` scripts into one data-driven onboarder.
- [x] **P4.3 — "Train" (knowledge ingestion).** Ingest the manifest's knowledge — provided text and/or a read-only recon/dump of a docs URL — into chunks with trust metadata (source · confidence · version · validation) + embeddings. Report coverage post-onboard.
- [x] **P4.4 — "Demo" parity.** **Done (P4.2–P4.4).** `src/core/onboard.ts` (`npm run onboard <manifest.json>`) provisions product + version + environment (with `adapter_config`) + KB (embeds trust-tagged knowledge; optional read-only recon of a public docs URL) + DemoGraph + expected intents from a declarative manifest — generalizing the five seed scripts. Proved on `manifests/expense.vin.json`: onboarding it set expense.vin's `adapter_config` (config-as-data) and the loop drives it **live read-only via the DB config** — parity with the hand-written seed, zero new code. The other 4 products stay on the code-registry fallback (untouched — low churn). Founder scope: **both** a manifest (done) **and** an interactive wizard (P4.2 wizard — pending); train = manifest + optional recon (done).
- [x] **P4.5 — `eval:phase4`** (**4/4**) — a product onboarded purely from a manifest is provisioned, its adapter config is stored as DATA + resolved by `getAdapter`, and its trained knowledge retrieves ungated + cited. Plus the **interactive wizard** (`npm run onboard:wizard`) — authors a manifest from prompts (works interactively *and* piped/scriptable), the "both" option.

## Open scope decisions (founder)
1. **"Add" input format** — a declarative JSON manifest (+ `onboard` CLI), or an interactive CLI wizard.
2. **"Train" knowledge source** — from the manifest (explicit text/sources) only, or also auto-ingest from a read-only recon/dump of the product's docs URL.
3. **Migration scope** — re-onboard all 5 existing products via manifests (full code→data migration), or only NEW products self-serve + one parity proof (keep the 5 working products as code).

## Deferral discipline (unchanged)
Interaction modality / new deployment targets → **P5+** (demand-driven). No UI (engine-only). Competitive content (D), billing (A) — still deferred.

## Done =
A new product is onboarded end-to-end from a single manifest (Add → Train → Demo) with NO code change; `eval:phase1/2/3` stay green; `eval:phase4` green; one existing product re-onboarded via manifest at parity.

**STATUS — 2026-06-07: P4 COMPLETE.** Self-service onboarding works: a product is added end-to-end from a declarative **manifest** (`npm run onboard <manifest>`) or the interactive **wizard** (`npm run onboard:wizard`) — **Add** (product/version/env/adapter-config) → **Train** (embed trust-tagged knowledge ± optional recon) → **Demo** (the existing loop, no code). Config-as-data via `environments.adapter_config` (code registry = fallback). Parity proven on expense.vin. Gates: `eval:phase1` 8/8 · `eval:phase2` 7/7 · `eval:phase3` 7/7 · `eval:phase4` 4/4. Migration (founder): new products self-serve; the 4 originals stay on the code fallback (low churn).
