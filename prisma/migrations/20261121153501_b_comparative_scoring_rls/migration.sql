-- B, hand-written: what Prisma's schema language cannot express for B's W6 tables.
-- Prisma drift note: a generated migration may propose dropping these; delete such lines before applying.

-- Row-level security is on for every table (CLAUDE.md). Signed-in, allow-listed users read; the server writes with the service key.
ALTER TABLE scoring_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_scoring_weights" ON scoring_weights FOR SELECT USING (app_role() IS NOT NULL);

ALTER TABLE comparatives ADD CONSTRAINT comparatives_trigger_chk
  CHECK (trigger IS NULL OR trigger IN ('button', 'all_quoted', 'due_date', 'revised_quote', 'script'));

-- PLAN.md section 7.4 default weights. The HOD edits them per category; "default" is the fallback.
INSERT INTO scoring_weights (category, weights)
VALUES ('default', '{"price": 40, "past_performance": 20, "delivery_fit": 15, "compliance": 10, "responsiveness": 10, "commercial": 5}')
ON CONFLICT (category) DO NOTHING;

-- The case page shows a new comparative version arriving live.
ALTER PUBLICATION supabase_realtime ADD TABLE comparatives;
