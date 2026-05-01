-- =====================================================================
-- ZapCRM — Fase 6: Termos de Interesse para IA
-- Schema: aespacrm  (NUNCA tocar em public ou outros schemas)
-- Rodar 1x no Supabase self-hosted do usuário (VPS).
-- =====================================================================

set search_path = aespacrm, public;

-- 1) Tabela de configurações por usuário ------------------------------
create table if not exists aespacrm.crm_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  interest_terms text[] not null default '{}',
  rescan_webhook_url text,
  updated_at timestamptz not null default now()
);

-- 2) RLS — cada usuário só lê/grava as próprias configs ---------------
alter table aespacrm.crm_user_settings enable row level security;

drop policy if exists "user_settings_select_own" on aespacrm.crm_user_settings;
create policy "user_settings_select_own"
  on aespacrm.crm_user_settings
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_settings_insert_own" on aespacrm.crm_user_settings;
create policy "user_settings_insert_own"
  on aespacrm.crm_user_settings
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_settings_update_own" on aespacrm.crm_user_settings;
create policy "user_settings_update_own"
  on aespacrm.crm_user_settings
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3) Trigger updated_at ------------------------------------------------
create or replace function aespacrm.set_user_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_settings_updated_at on aespacrm.crm_user_settings;
create trigger trg_user_settings_updated_at
  before update on aespacrm.crm_user_settings
  for each row execute function aespacrm.set_user_settings_updated_at();

-- 4) Confirmação ------------------------------------------------------
-- select column_name, data_type from information_schema.columns
--   where table_schema='aespacrm' and table_name='crm_user_settings';
