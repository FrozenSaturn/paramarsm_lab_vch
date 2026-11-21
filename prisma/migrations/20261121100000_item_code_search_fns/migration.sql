-- Hand-written. Search helpers for item-code mapping (W2). Prisma cannot see functions; do not drop them.
CREATE OR REPLACE FUNCTION match_item_codes_by_embedding(q vector(384), n int DEFAULT 10)
RETURNS TABLE (id uuid, code text, description text, erp_serial int, score double precision)
LANGUAGE sql STABLE AS $$
  SELECT i.id, i.code, i.description, i.erp_serial, 1 - (i.embedding <=> q)
  FROM item_codes i WHERE i.embedding IS NOT NULL ORDER BY i.embedding <=> q LIMIT n
$$;

CREATE OR REPLACE FUNCTION match_item_codes_by_trigram(q text, n int DEFAULT 10)
RETURNS TABLE (id uuid, code text, description text, erp_serial int, score double precision)
LANGUAGE sql STABLE AS $$
  SELECT i.id, i.code, i.description, i.erp_serial, similarity(i.description, q)::double precision
  FROM item_codes i ORDER BY similarity(i.description, q) DESC LIMIT n
$$;
