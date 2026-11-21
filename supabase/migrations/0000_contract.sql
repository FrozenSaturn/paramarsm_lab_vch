-- Day-0 contract: every table in PLAN.md section 12. After this, each owner changes only their own tables.
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create type app_role_t as enum ('contracts_engineer','hod','site_engineer','management','admin');

-- ===== A: identity =====
create table allowed_users (email text primary key, role app_role_t not null, is_demo boolean default true);
create table profiles (id uuid primary key references auth.users on delete cascade, email text unique not null, role app_role_t not null, created_at timestamptz default now());

create or replace function app_role() returns app_role_t language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare r app_role_t;
begin
  select role into r from allowed_users where lower(email) = lower(new.email);
  if r is not null then insert into profiles (id, email, role) values (new.id, new.email, r); end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ===== A: master data =====
create table projects (id uuid primary key default gen_random_uuid(), name text not null, is_demo boolean default true, source text);
create table people (id uuid primary key default gen_random_uuid(), name text not null, title text, project_id uuid references projects, email text, phone text, is_demo boolean default true, source text);
create table vendors (id uuid primary key default gen_random_uuid(), name text not null, gstin text, address text, is_demo boolean default true, source text);
create table vendor_contacts (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references vendors, name text, email text, phone text);
create table vendor_categories (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references vendors, category text not null, inferred boolean default false);

-- ===== A: cases and messages =====
create table cases (id uuid primary key default gen_random_uuid(), project_id uuid references projects, title text not null, stage text not null default 'requirement', status text not null default 'open', created_at timestamptz default now(), is_demo boolean default true);
create table messages (id uuid primary key default gen_random_uuid(), case_id uuid references cases, channel text not null, direction text not null default 'in', external_id text unique, thread_id text, sender text, recipients text[], subject text, body text, body_en text, language text, classification text, raw_path text, created_at timestamptz default now());
create table documents (id uuid primary key default gen_random_uuid(), case_id uuid references cases, message_id uuid references messages, filename text, mime text, storage_path text not null, sha256 text, kind text, created_at timestamptz default now());
create unique index documents_sha_case on documents (case_id, sha256) where sha256 is not null;

-- ===== B: evidence & search (referenced by both) =====
create table extracted_fields (id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null, field text not null, value jsonb, document_id uuid references documents, page int, snippet text, confidence numeric, confirmed_by uuid references profiles, created_at timestamptz default now());
create table doc_chunks (id uuid primary key default gen_random_uuid(), document_id uuid references documents, message_id uuid references messages, case_id uuid references cases, page int, content text not null, embedding vector(384));
create index doc_chunks_embedding on doc_chunks using hnsw (embedding vector_cosine_ops);

-- ===== A: BOQ and codes =====
create table boq_versions (id uuid primary key default gen_random_uuid(), case_id uuid not null references cases, version int not null, status text default 'draft', source_document_id uuid references documents, created_at timestamptz default now(), unique (case_id, version));
create table boq_lines (id uuid primary key default gen_random_uuid(), boq_version_id uuid not null references boq_versions, serial text, description text not null, unit text, quantity numeric, item_code text, flags jsonb default '[]');
create table item_codes (id uuid primary key default gen_random_uuid(), code text not null, description text not null, unit text, erp_serial int, normalized_code text, embedding vector(384), is_demo boolean default true, source text);
create index item_codes_embedding on item_codes using hnsw (embedding vector_cosine_ops);
create index item_codes_trgm on item_codes using gin (description gin_trgm_ops);
create table code_aliases (id uuid primary key default gen_random_uuid(), alias_text text not null, item_code_id uuid not null references item_codes, confirmed_by uuid references profiles, created_at timestamptz default now());
create table code_proposals (id uuid primary key default gen_random_uuid(), case_id uuid references cases, boq_line_id uuid references boq_lines, proposed_code text, description text, nearest jsonb, status text default 'proposed');

-- ===== A: RFQs =====
create table rfqs (id uuid primary key default gen_random_uuid(), case_id uuid not null references cases, ref text unique, due_date date, terms jsonb, status text default 'draft', created_at timestamptz default now());
create table rfq_recipients (id uuid primary key default gen_random_uuid(), rfq_id uuid not null references rfqs, vendor_id uuid not null references vendors, email text, gmail_thread_id text, gmail_draft_id text, sent_at timestamptz, reminders_sent int default 0, status text default 'draft');

-- ===== A: actions, receipts, events, steps =====
create table actions (
  id uuid primary key default gen_random_uuid(), case_id uuid references cases, kind text not null,
  status text not null default 'proposed' check (status in ('proposed','edited','approved','executed','rejected','failed')),
  payload jsonb not null, original_payload jsonb, proposed_by text, approved_by uuid references profiles,
  approved_at timestamptz, reject_reason text, error text, created_at timestamptz default now(), updated_at timestamptz default now());
create table receipts (id uuid primary key default gen_random_uuid(), action_id uuid not null references actions, payload_hash text not null, payload jsonb not null, approved_by uuid references profiles, approved_at timestamptz, executed_at timestamptz default now(), provider_id text, result jsonb);
create table events (id uuid primary key default gen_random_uuid(), name text not null, case_id uuid, payload jsonb not null default '{}', actor text, created_at timestamptz default now());
create table agent_steps (id uuid primary key default gen_random_uuid(), case_id uuid references cases, workflow text, step text not null, status text default 'running', input jsonb, output jsonb, model text, prompt_version text, evidence jsonb, reasoning text, cost_usd numeric, started_at timestamptz default now(), finished_at timestamptz);

-- ===== B: quotes, comparison, decision, memory =====
create table vendor_performance (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references vendors, case_id uuid references cases, quality int, timeliness int, disputes int, safety int, note text, source_message_id uuid references messages, confirmed_by uuid references profiles, is_demo boolean default true, created_at timestamptz default now());
create table memory_refs (id uuid primary key default gen_random_uuid(), mem0_id text not null, entity text not null, message_id uuid references messages, created_at timestamptz default now());
create table quotes (id uuid primary key default gen_random_uuid(), case_id uuid not null references cases, rfq_id uuid references rfqs, vendor_id uuid not null references vendors, document_id uuid references documents, version int default 1, quote_date date, reference text, validity text, gst_treatment text, freight text, payment_terms text, advance text, completion_time text, warranty text, status text default 'extracting', created_at timestamptz default now());
create table quote_lines (id uuid primary key default gen_random_uuid(), quote_id uuid not null references quotes, boq_line_id uuid references boq_lines, unit text, quantity numeric, rate numeric, amount numeric, make text, normalized_rate numeric, flags jsonb default '[]');
create table quote_terms (id uuid primary key default gen_random_uuid(), quote_id uuid not null references quotes, term text not null, status text not null check (status in ('met','not_met','not_stated')), detail text);
create table comparatives (id uuid primary key default gen_random_uuid(), case_id uuid not null references cases, version int not null, matrix jsonb not null, created_at timestamptz default now(), unique (case_id, version));
create table scores (id uuid primary key default gen_random_uuid(), comparative_id uuid not null references comparatives, vendor_id uuid not null references vendors, total numeric, breakdown jsonb, flags jsonb);
create table recommendations (id uuid primary key default gen_random_uuid(), comparative_id uuid not null references comparatives, ranking jsonb, explanation jsonb, created_at timestamptz default now());
create table decisions (id uuid primary key default gen_random_uuid(), recommendation_id uuid not null references recommendations, vendor_id uuid not null references vendors, decided_by uuid not null references profiles, overridden boolean default false, reason text, created_at timestamptz default now(), check (not overridden or reason is not null));

-- ===== RLS: on everywhere; reads by any signed-in profile, writes via service key =====
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table %I enable row level security', t);
    if t not in ('allowed_users') then
      execute format('create policy "read_%1$s" on %1$I for select using (app_role() is not null)', t);
    end if;
  end loop;
end $$;
create policy "own_profile" on profiles for select using (id = auth.uid());
create policy "admin_allowed" on allowed_users for select using (app_role() = 'admin');

alter publication supabase_realtime add table agent_steps, actions, messages;
