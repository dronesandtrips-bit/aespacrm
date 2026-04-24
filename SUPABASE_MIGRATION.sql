-- =====================================================================
-- ZapCRM — Migração total para Supabase (schema aespacrm)
-- =====================================================================
-- ISOLAMENTO: Tudo vive no schema `aespacrm` com prefixo `crm_` nas
-- tabelas. Cada linha tem `user_id` (referência a auth.users) e RLS
-- por usuário. Outros projetos no seu Supabase NÃO conseguem ver
-- nem modificar nenhum dado deste app.
--
-- Rode este SQL UMA VEZ no SQL Editor do seu Supabase self-hosted.
-- É idempotente (pode rodar de novo sem quebrar nada existente).
-- =====================================================================

-- 0) Schema (já existe, mas garantimos)
create schema if not exists aespacrm;

-- =====================================================================
-- 1) CATEGORIAS
-- =====================================================================
create table if not exists aespacrm.crm_categories (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  color       text        not null default '#3B82F6',
  created_at  timestamptz not null default now()
);
create index if not exists idx_crm_categories_user on aespacrm.crm_categories(user_id);

-- =====================================================================
-- 2) CONTATOS
-- =====================================================================
create table if not exists aespacrm.crm_contacts (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  phone        text        not null,
  phone_norm   text        generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  email        text,
  notes        text,
  category_id  uuid        references aespacrm.crm_categories(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_crm_contacts_user on aespacrm.crm_contacts(user_id);
create index if not exists idx_crm_contacts_user_phone on aespacrm.crm_contacts(user_id, phone_norm);
create unique index if not exists uq_crm_contacts_user_phone on aespacrm.crm_contacts(user_id, phone_norm)
  where phone_norm <> '';

-- =====================================================================
-- 3) ETAPAS DO PIPELINE + POSICIONAMENTO
-- =====================================================================
create table if not exists aespacrm.crm_pipeline_stages (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  color       text        not null default '#3B82F6',
  "order"     int         not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_crm_stages_user on aespacrm.crm_pipeline_stages(user_id);

create table if not exists aespacrm.crm_pipeline_placements (
  contact_id  uuid        not null references aespacrm.crm_contacts(id) on delete cascade,
  stage_id    uuid        not null references aespacrm.crm_pipeline_stages(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  moved_at    timestamptz not null default now(),
  primary key (contact_id)
);
create index if not exists idx_crm_placements_user on aespacrm.crm_pipeline_placements(user_id);
create index if not exists idx_crm_placements_stage on aespacrm.crm_pipeline_placements(stage_id);

-- =====================================================================
-- 4) MENSAGENS (Inbox)
-- =====================================================================
create table if not exists aespacrm.crm_messages (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  contact_id  uuid        not null references aespacrm.crm_contacts(id) on delete cascade,
  body        text        not null,
  from_me     boolean     not null default false,
  at          timestamptz not null default now()
);
create index if not exists idx_crm_messages_user on aespacrm.crm_messages(user_id);
create index if not exists idx_crm_messages_contact_at on aespacrm.crm_messages(contact_id, at desc);

-- =====================================================================
-- 5) DISPAROS EM MASSA
-- =====================================================================
create table if not exists aespacrm.crm_bulk_sends (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  name              text        not null,
  message           text        not null,
  interval_seconds  int         not null default 3,
  total_contacts    int         not null default 0,
  sent_count        int         not null default 0,
  status            text        not null default 'pending'
                              check (status in ('pending','in_progress','completed','error')),
  created_at        timestamptz not null default now()
);
create index if not exists idx_crm_bulk_user on aespacrm.crm_bulk_sends(user_id, created_at desc);

-- =====================================================================
-- 6) SEQUÊNCIAS DE FOLLOW-UP
-- =====================================================================
create table if not exists aespacrm.crm_sequences (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  name            text        not null,
  description     text,
  is_active       boolean     not null default true,
  trigger_type    text        not null default 'manual'
                            check (trigger_type in ('manual','category','pipeline_stage')),
  trigger_value   uuid,        -- category_id ou stage_id quando aplicável
  -- Janela horária de envio (default: 9h-18h, seg-sex)
  window_start_hour int not null default 9 check (window_start_hour between 0 and 23),
  window_end_hour   int not null default 18 check (window_end_hour between 0 and 23),
  window_days       int[] not null default '{1,2,3,4,5}', -- 0=dom,1=seg...6=sab
  created_at      timestamptz not null default now()
);
create index if not exists idx_crm_seq_user on aespacrm.crm_sequences(user_id);
create index if not exists idx_crm_seq_trigger on aespacrm.crm_sequences(user_id, trigger_type, trigger_value)
  where is_active = true;

create table if not exists aespacrm.crm_sequence_steps (
  id           uuid        primary key default gen_random_uuid(),
  sequence_id  uuid        not null references aespacrm.crm_sequences(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  "order"      int         not null,
  message      text        not null,
  delay_value  int         not null default 1 check (delay_value >= 0),
  delay_unit   text        not null default 'days' check (delay_unit in ('hours','days')),
  created_at   timestamptz not null default now(),
  unique (sequence_id, "order")
);
create index if not exists idx_crm_seq_steps_seq on aespacrm.crm_sequence_steps(sequence_id, "order");

create table if not exists aespacrm.crm_contact_sequences (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  contact_id    uuid        not null references aespacrm.crm_contacts(id) on delete cascade,
  sequence_id   uuid        not null references aespacrm.crm_sequences(id) on delete cascade,
  current_step  int         not null default 0,    -- próximo step a enviar
  status        text        not null default 'active'
                          check (status in ('active','paused','completed','cancelled')),
  next_send_at  timestamptz,                       -- quando enviar a próxima msg
  started_at    timestamptz not null default now(),
  paused_at     timestamptz,
  pause_reason  text,                              -- 'inbound_reply','manual','etc'
  unique (contact_id, sequence_id)
);
create index if not exists idx_crm_cs_user on aespacrm.crm_contact_sequences(user_id);
create index if not exists idx_crm_cs_due on aespacrm.crm_contact_sequences(next_send_at)
  where status = 'active' and next_send_at is not null;

create table if not exists aespacrm.crm_sequence_send_log (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,
  contact_sequence_id   uuid        not null references aespacrm.crm_contact_sequences(id) on delete cascade,
  step_order            int         not null,
  message               text        not null,
  sent_at               timestamptz not null default now(),
  status                text        not null default 'sent'
                                  check (status in ('sent','failed')),
  error                 text
);
create index if not exists idx_crm_send_log_user on aespacrm.crm_sequence_send_log(user_id, sent_at desc);

-- =====================================================================
-- 7) updated_at trigger para crm_contacts
-- =====================================================================
create or replace function aespacrm.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_crm_contacts_updated on aespacrm.crm_contacts;
create trigger trg_crm_contacts_updated
  before update on aespacrm.crm_contacts
  for each row execute function aespacrm.set_updated_at();

-- =====================================================================
-- 8) RLS — ISOLAMENTO POR USUÁRIO
-- =====================================================================
-- Helper genérico: cada usuário vê e mexe APENAS nas próprias linhas.
-- Nenhuma policy permite cross-user — isolamento total.

do $$
declare
  t text;
  tables text[] := array[
    'crm_categories',
    'crm_contacts',
    'crm_pipeline_stages',
    'crm_pipeline_placements',
    'crm_messages',
    'crm_bulk_sends',
    'crm_sequences',
    'crm_sequence_steps',
    'crm_contact_sequences',
    'crm_sequence_send_log'
  ];
begin
  foreach t in array tables loop
    execute format('alter table aespacrm.%I enable row level security', t);

    -- limpa policies antigas com mesmo nome
    execute format('drop policy if exists "own_select" on aespacrm.%I', t);
    execute format('drop policy if exists "own_insert" on aespacrm.%I', t);
    execute format('drop policy if exists "own_update" on aespacrm.%I', t);
    execute format('drop policy if exists "own_delete" on aespacrm.%I', t);

    execute format($p$
      create policy "own_select" on aespacrm.%I
        for select to authenticated
        using (user_id = auth.uid())
    $p$, t);

    execute format($p$
      create policy "own_insert" on aespacrm.%I
        for insert to authenticated
        with check (user_id = auth.uid())
    $p$, t);

    execute format($p$
      create policy "own_update" on aespacrm.%I
        for update to authenticated
        using (user_id = auth.uid())
        with check (user_id = auth.uid())
    $p$, t);

    execute format($p$
      create policy "own_delete" on aespacrm.%I
        for delete to authenticated
        using (user_id = auth.uid())
    $p$, t);
  end loop;
end $$;

-- =====================================================================
-- 9) GRANTS no schema (necessário para o anon key acessar via API)
-- =====================================================================
grant usage on schema aespacrm to anon, authenticated;
grant all on all tables in sequence aespacrm to authenticated;
grant select, insert, update, delete on all tables in schema aespacrm to authenticated;
grant usage on all sequences in schema aespacrm to authenticated;

alter default privileges in schema aespacrm
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema aespacrm
  grant usage on sequences to authenticated;

-- =====================================================================
-- FIM. Tudo isolado por user_id, RLS ativo, schema próprio.
-- =====================================================================
