create table mail_tokens (user_id uuid primary key references auth.users on delete cascade, refresh_token text not null, history_id text, updated_at timestamptz default now());
alter table mail_tokens enable row level security; -- no policies: service key only
