-- Per-step demo script (guided/scripted demo runner). A workflow's node_sequence is the ordered SCREENS;
-- step_script is an operator-authored caption / talking-point per screen (keyed by intent_label), shown as
-- the consultant walks the journey in the DETERMINISTIC scripted runner. Additive + idempotent.
-- The autonomous AI loop ignores this (it composes narration from knowledge live); ONLY the scripted
-- runner reads it. Keyed by intent_label so it survives reordering; a label with no entry just shows the
-- screen name. Org/Site scoping still deferred (1-of-each today).
ALTER TABLE demo_graph_workflows ADD COLUMN IF NOT EXISTS step_script jsonb NOT NULL DEFAULT '{}';
