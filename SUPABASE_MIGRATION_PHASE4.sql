-- ============================================================
-- ZapCRM Phase 4: Auto-stop avançado + Templates de mensagem
-- Schema: aespacrm
-- Idempotente — pode ser executado múltiplas vezes.
-- ============================================================

set search_path = aespacrm;

-- ---------- 1. Auto-stop avançado em crm_sequences ----------
-- Pausar automaticamente quando o contato entra em uma destas etapas do pipeline.
-- Auto-retomar após N dias sem resposta (0 = desativado).
alter table aespacrm.crm_sequences
  add column if not exists stop_on_stage_ids uuid[] not null default '{}'::uuid[];

alter table aespacrm.crm_sequences
  add column if not exists auto_resume_after_days integer not null default 0
  check (auto_resume_after_days >= 0 and auto_resume_after_days <= 365);

comment on column aespacrm.crm_sequences.stop_on_stage_ids is
  'IDs de etapas do pipeline que pausam a sequência quando o contato entra nelas (ex.: Cliente, Perdido)';
comment on column aespacrm.crm_sequences.auto_resume_after_days is
  'Retomar automaticamente após X dias pausada por inbound_reply. 0 = desativado.';

-- ---------- 2. Tabela de templates de mensagem ----------
create table if not exists aespacrm.crm_message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  content text not null,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists idx_crm_message_templates_user
  on aespacrm.crm_message_templates(user_id);

alter table aespacrm.crm_message_templates enable row level security;

drop policy if exists "templates_select_own" on aespacrm.crm_message_templates;
create policy "templates_select_own" on aespacrm.crm_message_templates
  for select using (user_id = auth.uid());

drop policy if exists "templates_insert_own" on aespacrm.crm_message_templates;
create policy "templates_insert_own" on aespacrm.crm_message_templates
  for insert with check (user_id = auth.uid());

drop policy if exists "templates_update_own" on aespacrm.crm_message_templates;
create policy "templates_update_own" on aespacrm.crm_message_templates
  for update using (user_id = auth.uid());

drop policy if exists "templates_delete_own" on aespacrm.crm_message_templates;
create policy "templates_delete_own" on aespacrm.crm_message_templates
  for delete using (user_id = auth.uid());

-- updated_at trigger
create or replace function aespacrm.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_templates_updated_at on aespacrm.crm_message_templates;
create trigger trg_templates_updated_at
  before update on aespacrm.crm_message_templates
  for each row execute function aespacrm.set_updated_at();
