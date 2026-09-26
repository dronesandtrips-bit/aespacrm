-- ZapCRM: progresso durável por publicação, isolado no schema aespacrm.
-- Execute após SUPABASE_MIGRATION_STATUS_ROTATION.sql. Idempotente.
create table if not exists aespacrm.crm_status_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id uuid references aespacrm.crm_status_media(id) on delete set null,
  status text not null check (status in ('running','uncertain','completed','cancelled')),
  recipients jsonb not null,
  payload jsonb not null,
  next_index integer not null default 0,
  in_flight_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (jsonb_typeof(recipients) = 'array')
);
grant select on aespacrm.crm_status_runs to authenticated;
grant all on aespacrm.crm_status_runs to service_role;
alter table aespacrm.crm_status_runs enable row level security;
drop policy if exists "own_status_runs" on aespacrm.crm_status_runs;
create policy "own_status_runs" on aespacrm.crm_status_runs for select to authenticated
  using (user_id = auth.uid() and aespacrm.is_allowed_user(auth.uid()));
create unique index if not exists crm_status_runs_one_open_per_user
  on aespacrm.crm_status_runs(user_id) where status in ('running','uncertain');
create index if not exists crm_status_runs_recent
  on aespacrm.crm_status_runs(user_id, created_at desc);
notify pgrst, 'reload schema';