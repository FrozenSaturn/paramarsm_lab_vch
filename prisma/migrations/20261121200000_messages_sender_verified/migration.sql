-- True only when the poller checked the sender: one From address, DMARC pass for that domain (see auth-results.ts).
-- Triage opens a case on its own only for a verified sender.
ALTER TABLE "messages" ADD COLUMN "sender_verified" BOOLEAN NOT NULL DEFAULT false;
