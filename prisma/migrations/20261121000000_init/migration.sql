-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "app_role_t" AS ENUM ('contracts_engineer', 'hod', 'site_engineer', 'management', 'admin');

-- CreateTable
CREATE TABLE "allowed_users" (
    "email" TEXT NOT NULL,
    "role" "app_role_t" NOT NULL,
    "is_demo" BOOLEAN DEFAULT true,

    CONSTRAINT "allowed_users_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "app_role_t" NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_tokens" (
    "user_id" UUID NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "history_id" TEXT,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_tokens_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_demo" BOOLEAN DEFAULT true,
    "source" TEXT,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "title" TEXT,
    "project_id" UUID,
    "email" TEXT,
    "phone" TEXT,
    "is_demo" BOOLEAN DEFAULT true,
    "source" TEXT,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "address" TEXT,
    "is_demo" BOOLEAN DEFAULT true,
    "source" TEXT,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,

    CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "inferred" BOOLEAN DEFAULT false,

    CONSTRAINT "vendor_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'requirement',
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "is_demo" BOOLEAN DEFAULT true,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'in',
    "external_id" TEXT,
    "thread_id" TEXT,
    "sender" TEXT,
    "recipients" TEXT[],
    "subject" TEXT,
    "body" TEXT,
    "body_en" TEXT,
    "language" TEXT,
    "classification" TEXT,
    "raw_path" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID,
    "message_id" UUID,
    "filename" TEXT,
    "mime" TEXT,
    "storage_path" TEXT NOT NULL,
    "sha256" TEXT,
    "kind" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT DEFAULT 'draft',
    "source_document_id" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boq_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "boq_version_id" UUID NOT NULL,
    "serial" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(65,30),
    "item_code" TEXT,
    "flags" JSONB DEFAULT '[]',

    CONSTRAINT "boq_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "erp_serial" INTEGER,
    "normalized_code" TEXT,
    "embedding" vector(384),
    "is_demo" BOOLEAN DEFAULT true,
    "source" TEXT,

    CONSTRAINT "item_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "alias_text" TEXT NOT NULL,
    "item_code_id" UUID NOT NULL,
    "confirmed_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID,
    "boq_line_id" UUID,
    "proposed_code" TEXT,
    "description" TEXT,
    "nearest" JSONB,
    "status" TEXT DEFAULT 'proposed',

    CONSTRAINT "code_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfqs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "ref" TEXT,
    "due_date" DATE,
    "terms" JSONB,
    "status" TEXT DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_recipients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rfq_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "email" TEXT,
    "gmail_thread_id" TEXT,
    "gmail_draft_id" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "reminders_sent" INTEGER DEFAULT 0,
    "status" TEXT DEFAULT 'draft',

    CONSTRAINT "rfq_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "payload" JSONB NOT NULL,
    "original_payload" JSONB,
    "proposed_by" TEXT,
    "approved_by" UUID,
    "edited_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action_id" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "executed_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "provider_id" TEXT,
    "result" JSONB,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "case_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actor" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID,
    "workflow" TEXT,
    "step" TEXT NOT NULL,
    "status" TEXT DEFAULT 'running',
    "input" JSONB,
    "output" JSONB,
    "model" TEXT,
    "prompt_version" TEXT,
    "evidence" JSONB,
    "reasoning" TEXT,
    "cost_usd" DECIMAL(65,30),
    "started_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_fields" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB,
    "document_id" UUID,
    "page" INTEGER,
    "snippet" TEXT,
    "confidence" DECIMAL(65,30),
    "confirmed_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID,
    "message_id" UUID,
    "case_id" UUID,
    "page" INTEGER,
    "content" TEXT NOT NULL,
    "embedding" vector(384),

    CONSTRAINT "doc_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_performance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "case_id" UUID,
    "quality" INTEGER,
    "timeliness" INTEGER,
    "disputes" INTEGER,
    "safety" INTEGER,
    "note" TEXT,
    "source_message_id" UUID,
    "confirmed_by" UUID,
    "is_demo" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_refs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mem0_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "message_id" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "rfq_id" UUID,
    "vendor_id" UUID NOT NULL,
    "document_id" UUID,
    "version" INTEGER DEFAULT 1,
    "quote_date" DATE,
    "reference" TEXT,
    "validity" TEXT,
    "gst_treatment" TEXT,
    "freight" TEXT,
    "payment_terms" TEXT,
    "advance" TEXT,
    "completion_time" TEXT,
    "warranty" TEXT,
    "status" TEXT DEFAULT 'extracting',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "boq_line_id" UUID,
    "unit" TEXT,
    "quantity" DECIMAL(65,30),
    "rate" DECIMAL(65,30),
    "amount" DECIMAL(65,30),
    "make" TEXT,
    "normalized_rate" DECIMAL(65,30),
    "flags" JSONB DEFAULT '[]',

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_terms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "term" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,

    CONSTRAINT "quote_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparatives" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "matrix" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "comparative_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "total" DECIMAL(65,30),
    "breakdown" JSONB,
    "flags" JSONB,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "comparative_id" UUID NOT NULL,
    "ranking" JSONB,
    "explanation" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recommendation_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "decided_by" UUID NOT NULL,
    "overridden" BOOLEAN DEFAULT false,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "messages_external_id_key" ON "messages"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "boq_versions_case_id_version_key" ON "boq_versions"("case_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_ref_key" ON "rfqs"("ref");

-- CreateIndex
CREATE INDEX "extracted_fields_entity_type_entity_id_idx" ON "extracted_fields"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "doc_chunks_case_id_idx" ON "doc_chunks"("case_id");

-- CreateIndex
CREATE INDEX "vendor_performance_vendor_id_idx" ON "vendor_performance"("vendor_id");

-- CreateIndex
CREATE INDEX "quotes_case_id_idx" ON "quotes"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "comparatives_case_id_version_key" ON "comparatives"("case_id", "version");

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_categories" ADD CONSTRAINT "vendor_categories_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_versions" ADD CONSTRAINT "boq_versions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_versions" ADD CONSTRAINT "boq_versions_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_boq_version_id_fkey" FOREIGN KEY ("boq_version_id") REFERENCES "boq_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_aliases" ADD CONSTRAINT "code_aliases_item_code_id_fkey" FOREIGN KEY ("item_code_id") REFERENCES "item_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_aliases" ADD CONSTRAINT "code_aliases_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_proposals" ADD CONSTRAINT "code_proposals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_proposals" ADD CONSTRAINT "code_proposals_boq_line_id_fkey" FOREIGN KEY ("boq_line_id") REFERENCES "boq_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_recipients" ADD CONSTRAINT "rfq_recipients_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_recipients" ADD CONSTRAINT "rfq_recipients_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_terms" ADD CONSTRAINT "quote_terms_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_comparative_id_fkey" FOREIGN KEY ("comparative_id") REFERENCES "comparatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_comparative_id_fkey" FOREIGN KEY ("comparative_id") REFERENCES "comparatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

