# Deferral Register

This is the **zero-untracked-gaps guarantee**: every gap is named, and either built now or deferred here with a revisit trigger. Do not build a deferred item until its trigger fires. The trigger column is the operational form of the ADR "Revisit trigger" field (see [adr/](adr/)).

| Deferred item | Trigger to revisit | Status |
|---|---|---|
| Multi-agent split | Tool needs independent scaling/owner, or single loop exceeds latency/complexity budget | Deferred |
| Desktop / Citrix / vision automation | Signed customer requiring a non-web target | Deferred |
| Self-service product onboarding | Adapter contract stable across 3 manually onboarded products | Deferred |
| pgvector → Pinecone | Retrieval scale/latency exceeds pgvector | Deferred |
| Air-gapped / on-prem / government | Signed customer + security requirement | Deferred |
| Voice / Avatars | Core text loop hits target reliability + customer pull | Deferred |
| Product Lifecycle engine (B) | Onboarding product #3 / first product version bump | Deferred |
| Active discovery behavior (E) | Phase 1 loop reliable; fields already captured | Deferred |
| Competitive content (D) | Sales/customer asks; category already in schema | Deferred |
| Billing/metering system (A) | Pricing validated + first paying customer; entity already modeled | Deferred |
| `execution` (full-write) mode (G) | Customer explicitly authorizes mutating actions in their env | Deferred |
