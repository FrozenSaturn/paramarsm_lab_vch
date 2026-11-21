-- B, hand-written: stage 5 objects that Prisma's schema language cannot express.
-- Prisma drift note: a generated migration may propose dropping these; delete such lines before applying.

ALTER TABLE doc_chunks ADD CONSTRAINT doc_chunks_source_type_chk CHECK (source_type IN ('document', 'message'));

-- Keyword half of hybrid search. 'simple' keeps Bengali and Hindi words as they are (no English stemming).
ALTER TABLE doc_chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;
CREATE INDEX doc_chunks_tsv ON doc_chunks USING gin (tsv);
CREATE INDEX doc_chunks_trgm ON doc_chunks USING gin (content gin_trgm_ops);
-- One copy of each chunk: re-indexing a document replaces its chunks.
CREATE UNIQUE INDEX doc_chunks_document_chunk ON doc_chunks (document_id, chunk_index) WHERE document_id IS NOT NULL;
CREATE UNIQUE INDEX doc_chunks_message_chunk ON doc_chunks (message_id, chunk_index) WHERE message_id IS NOT NULL AND document_id IS NULL;

ALTER TABLE vendor_performance ADD CONSTRAINT vendor_performance_source_chk
  CHECK (source IS NULL OR source IN ('demo', 'confirmed', 'import'));
ALTER TABLE vendor_performance ADD CONSTRAINT vendor_performance_ratings_chk CHECK (
  (quality IS NULL OR quality BETWEEN 1 AND 5) AND (timeliness IS NULL OR timeliness BETWEEN 1 AND 5) AND
  (disputes IS NULL OR disputes BETWEEN 1 AND 5) AND (safety IS NULL OR safety BETWEEN 1 AND 5));

-- Hybrid search: vector similarity and keyword rank, merged by reciprocal rank fusion (k = 60).
-- The app calls it with the service key from the server only.
CREATE OR REPLACE FUNCTION search_doc_chunks(
  query_embedding vector(384), query_text text, match_count int DEFAULT 10,
  filter_case uuid DEFAULT NULL, filter_vendor uuid DEFAULT NULL)
RETURNS TABLE (id uuid, document_id uuid, message_id uuid, case_id uuid, vendor_id uuid, page int,
               content text, source_type text, vector_score double precision, keyword_score double precision, score double precision)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH f AS (
    SELECT * FROM doc_chunks c
    WHERE (filter_case IS NULL OR c.case_id = filter_case) AND (filter_vendor IS NULL OR c.vendor_id = filter_vendor)
  ), q AS (SELECT websearch_to_tsquery('simple', coalesce(query_text, '')) AS tsq),
  vec AS (
    SELECT f.id, 1 - (f.embedding <=> query_embedding) AS sim,
           row_number() OVER (ORDER BY f.embedding <=> query_embedding) AS r
    FROM f WHERE f.embedding IS NOT NULL AND query_embedding IS NOT NULL
    ORDER BY f.embedding <=> query_embedding LIMIT greatest(match_count, 1) * 4
  ), kw AS (
    SELECT f.id, ts_rank_cd(f.tsv, q.tsq) + similarity(f.content, coalesce(query_text, '')) AS ks,
           row_number() OVER (ORDER BY ts_rank_cd(f.tsv, q.tsq) + similarity(f.content, coalesce(query_text, '')) DESC) AS r
    FROM f, q WHERE coalesce(query_text, '') <> '' AND (f.tsv @@ q.tsq OR f.content % query_text)
    ORDER BY ks DESC LIMIT greatest(match_count, 1) * 4
  )
  SELECT f.id, f.document_id, f.message_id, f.case_id, f.vendor_id, f.page, f.content, f.source_type,
         vec.sim, kw.ks, coalesce(1.0 / (60 + vec.r), 0) + coalesce(1.0 / (60 + kw.r), 0) AS score
  FROM f LEFT JOIN vec ON vec.id = f.id LEFT JOIN kw ON kw.id = f.id
  WHERE vec.id IS NOT NULL OR kw.id IS NOT NULL
  ORDER BY score DESC, f.id
  LIMIT greatest(match_count, 1);
$$;
REVOKE ALL ON FUNCTION search_doc_chunks(vector, text, int, uuid, uuid) FROM PUBLIC, anon, authenticated;
