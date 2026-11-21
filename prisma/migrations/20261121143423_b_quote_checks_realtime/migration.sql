-- B, hand-written: what Prisma's schema language cannot express for B's quote tables.
-- Prisma drift note: `prisma migrate dev` may propose dropping these CHECKs; delete such lines before applying.

ALTER TABLE quotes ADD CONSTRAINT quotes_status_chk
  CHECK (status IN ('extracting', 'needs_review', 'ready', 'failed', 'superseded'));
ALTER TABLE quotes ADD CONSTRAINT quotes_scope_chk
  CHECK (scope IN ('matches', 'close', 'different', 'unknown'));

-- The case page shows quotes arriving and being read live.
ALTER PUBLICATION supabase_realtime ADD TABLE quotes;
