# PO.vin Knowledge — Provenance

The PO.vin Knowledge + Demo Graph **100% coverage** is generated deterministically from a single,
reviewable, code-grounded dataset:

- **Source of truth (in-repo):** [`src/core/povin-sitemap.ts`](../../../src/core/povin-sitemap.ts) — every PO.vin
  page (27 routes / 32+ surfaces) with its purpose, fields, buttons, actions, tabs, errors, FAQs, and the
  documented end-to-end workflows. Business-facing only (no RPC/file/SQL — the firewall).
- **Origin:** transcribed from the forensic PO.VIN Knowledge Center (a master Knowledge Center + 5 page-
  decomposition group files, v0.2.5, generated 2026-06-09) — itself a zero-assumption, file:line-cited
  decomposition of the `po-vin` Vue 3 / Hono codebase. Honesty markers (DEAD UI / UNWIRED / PARTIAL /
  UNKNOWN) are preserved per element via `implementation_status`.

## How it flows in
- `npm run seed:povin-coverage` → validated `knowledge_chunks` (one business-facing fact per page + each FAQ
  + cross-page facts: lifecycle, approval matrix, separation-of-duties, roles) **and** demo-graph nodes +
  `demo_graph_node_elements` + `page_facts` + approved workflows, all on the product's active graph.
- `npm run eval:povin-coverage` → asserts zero gaps (every page is a routed node with elements + page_facts;
  every workflow approved; ≥1 validated knowledge chunk per page).

The raw forensic markdown (master `povin-knowledge-base.md` + `pages/01-high-traffic.md` … `05-misc-dashboards.md`)
is the external origin; the in-repo structured dataset above is the maintained source going forward. To
re-ingest the raw prose through the general gate instead, use `npm run ingest:docs -- PO.vin <file>`.
