-- Bling: disparo automático de novas propostas comerciais
-- Aditivo — não altera nada existente.

create table if not exists aespacrm.crm_bling_auto_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  proposal_id text not null,
  contact_id uuid,
  phone text,
  status text not null default 'sent',   -- sent | skipped | error
  detail text,
  created_at timestamptz not null default now(),
  unique (user_id, proposal_id)
);

create index if not exists idx_crm_bling_auto_log_user_created
  on aespacrm.crm_bling_auto_log (user_id, created_at desc);

alter table aespacrm.crm_bling_auto_log enable row level security;

grant select on aespacrm.crm_bling_auto_log to authenticated;
grant all on aespacrm.crm_bling_auto_log to service_role;

drop policy if exists "own bling auto log" on aespacrm.crm_bling_auto_log;
create policy "own bling auto log"
  on aespacrm.crm_bling_auto_log
  for select
  to authenticated
  using (auth.uid() = user_id);
