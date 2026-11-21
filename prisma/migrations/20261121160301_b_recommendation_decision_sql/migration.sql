-- B, hand-written: stage 4 rules that Prisma's schema language cannot express.
-- Prisma drift note: a generated migration may propose dropping these; delete such lines before applying.

ALTER TABLE recommendations ADD CONSTRAINT recommendations_status_chk
  CHECK (status IN ('draft', 'with_hod', 'decided', 'sent_back', 'superseded'));

-- A decision is one of three kinds. An override or a send-back cannot be saved without a reason.
ALTER TABLE decisions ADD CONSTRAINT decisions_kind_chk CHECK (kind IN ('approve', 'override', 'send_back'));
ALTER TABLE decisions ADD CONSTRAINT decisions_vendor_chk CHECK ((kind = 'send_back') = (vendor_id IS NULL));
ALTER TABLE decisions ADD CONSTRAINT decisions_override_flag_chk CHECK (overridden = (kind = 'override'));
ALTER TABLE decisions ADD CONSTRAINT decisions_reason_chk
  CHECK (kind = 'approve' OR length(btrim(coalesce(reason, ''))) >= 5);

-- Only a HOD records a decision. The server action checks the role; this trigger checks it again in the database,
-- so no agent or other code path can write a decision under another login.
CREATE OR REPLACE FUNCTION decisions_require_hod() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.decided_by AND role = 'hod') THEN
    RAISE EXCEPTION 'only a HOD can record a decision';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER decisions_require_hod BEFORE INSERT OR UPDATE ON decisions FOR EACH ROW EXECUTE FUNCTION decisions_require_hod();

-- One decision per recommendation.
CREATE UNIQUE INDEX decisions_one_per_recommendation ON decisions (recommendation_id);

-- The Approvals page and the Recommendation panel update live.
ALTER PUBLICATION supabase_realtime ADD TABLE recommendations;
ALTER PUBLICATION supabase_realtime ADD TABLE decisions;
