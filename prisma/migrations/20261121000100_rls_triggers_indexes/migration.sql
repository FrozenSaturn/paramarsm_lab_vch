-- Hand-written: things Prisma's schema language cannot express. Applied after init.
-- Prisma drift note: `prisma migrate dev` may propose dropping the indexes/constraints below.
-- Always use --create-only and delete such lines before applying.

-- CHECK constraints
ALTER TABLE actions ADD CONSTRAINT actions_status_chk CHECK (status IN ('proposed','edited','approved','executed','rejected','failed'));
ALTER TABLE quote_terms ADD CONSTRAINT quote_terms_status_chk CHECK (status IN ('met','not_met','not_stated'));
ALTER TABLE decisions ADD CONSTRAINT decisions_override_reason_chk CHECK (NOT COALESCE(overridden,false) OR reason IS NOT NULL);

-- Indexes on types Prisma cannot model
CREATE INDEX item_codes_embedding ON item_codes USING hnsw (embedding vector_cosine_ops);
CREATE INDEX item_codes_trgm ON item_codes USING gin (description gin_trgm_ops);
CREATE INDEX doc_chunks_embedding ON doc_chunks USING hnsw (embedding vector_cosine_ops);
CREATE UNIQUE INDEX documents_sha_case ON documents (case_id, sha256) WHERE sha256 IS NOT NULL;

-- Roles
CREATE OR REPLACE FUNCTION app_role() RETURNS app_role_t LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT role FROM profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r app_role_t;
BEGIN
  SELECT role INTO r FROM allowed_users WHERE lower(email) = lower(new.email);
  IF r IS NOT NULL THEN INSERT INTO profiles (id, email, role) VALUES (new.id, new.email, r); END IF;
  RETURN new;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Row-level security: on for every table. Signed-in profiles read; writes go through the service key.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF t NOT IN ('allowed_users','mail_tokens','profiles','_prisma_migrations') THEN
      EXECUTE format('CREATE POLICY "read_%1$s" ON %1$I FOR SELECT USING (app_role() IS NOT NULL)', t);
    END IF;
  END LOOP;
END $$;
CREATE POLICY own_profile ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY admin_allowed ON allowed_users FOR SELECT USING (app_role() = 'admin');

-- Realtime for the live activity panel
ALTER PUBLICATION supabase_realtime ADD TABLE agent_steps, actions, messages;
