-- 0019: Navigation-attempt telemetry (V3.2 Experience Registry, Phase 2). One row per navigation attempt
-- from EITHER engine, recorded AGAINST the demo-graph node it targets:
--   • source='path-a'     — the LangGraph driveTo (conversational Ask / Voice / Reel). Server-side gotoNode
--                           rows carry a real ok/healed_via; client-driven (clientNav) rows have ok=NULL
--                           (the DOM outcome isn't observed server-side) but still capture node+intent.
--   • source='agent-step' — the desktop's DOM-driven /agent/step loop, resolved back onto a node (the bridge:
--                           the DOM engine now FEEDS the graph). ok = an executable action was issued (not
--                           blocked/done) — true DOM-success reporting is a later enhancement.
-- This is the data Phase 3 turns into per-node success/failure rates + the empirical intent→node registry;
-- until then it powers the Node Studio "Diagnostics" list. node/graph/session/product ids are DENORMALIZED
-- (no FK) so the trail survives a hard-delete — same posture as graph_events / knowledge_events. Additive + idempotent.
CREATE TABLE IF NOT EXISTS navigation_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         uuid,                                            -- resolved demo-graph node (NULL = navigated somewhere not on the graph)
  demo_graph_id   uuid,
  demo_session_id uuid,
  product_id      uuid,
  intent          text,                                            -- the goal/utterance that drove this navigation
  url             text,
  ok              boolean,                                         -- NULL = outcome not observed server-side (client-driven)
  healed_via      text,                                            -- self-heal strategy that resolved it (Path A server-side)
  selector_used   text,
  source          text NOT NULL CHECK (source IN ('path-a','agent-step')),
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nav_attempts_node ON navigation_attempts(node_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_nav_attempts_product_at ON navigation_attempts(product_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_nav_attempts_intent ON navigation_attempts(product_id, lower(intent)); -- Phase 3 intent→node group-by
