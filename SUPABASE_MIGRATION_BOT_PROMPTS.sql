-- =====================================================================
-- ZapCRM — System Prompt do Robô versionado
-- Schema: aespacrm  (NUNCA tocar em public ou outros schemas)
-- Rodar 1x no Supabase self-hosted do usuário (VPS).
-- =====================================================================

set search_path = aespacrm, public;

create table if not exists aespacrm.crm_bot_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  title text not null default '',
  content text not null default '',
  notes text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, version)
);

create index if not exists crm_bot_prompts_user_idx
  on aespacrm.crm_bot_prompts (user_id, version desc);

-- Só uma versão ativa por usuário
create unique index if not exists crm_bot_prompts_one_active_idx
  on aespacrm.crm_bot_prompts (user_id)
  where is_active;

grant select, insert, update, delete on aespacrm.crm_bot_prompts to authenticated;
grant all on aespacrm.crm_bot_prompts to service_role;

alter table aespacrm.crm_bot_prompts enable row level security;

drop policy if exists "bot_prompts_select_own" on aespacrm.crm_bot_prompts;
create policy "bot_prompts_select_own" on aespacrm.crm_bot_prompts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "bot_prompts_insert_own" on aespacrm.crm_bot_prompts;
create policy "bot_prompts_insert_own" on aespacrm.crm_bot_prompts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "bot_prompts_update_own" on aespacrm.crm_bot_prompts;
create policy "bot_prompts_update_own" on aespacrm.crm_bot_prompts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "bot_prompts_delete_own" on aespacrm.crm_bot_prompts;
create policy "bot_prompts_delete_own" on aespacrm.crm_bot_prompts
  for delete to authenticated using (user_id = auth.uid());

create or replace function aespacrm.set_bot_prompts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_bot_prompts_updated_at on aespacrm.crm_bot_prompts;
create trigger trg_bot_prompts_updated_at
  before update on aespacrm.crm_bot_prompts
  for each row execute function aespacrm.set_bot_prompts_updated_at();

-- Após rodar: NOTIFY pgrst, 'reload schema';  (ou docker service update --force supabase_supabase_rest)
