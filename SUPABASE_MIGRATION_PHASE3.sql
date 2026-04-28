-- =====================================================================
-- ZapCRM — Fase 3: Webhooks da Evolution API
-- =====================================================================
-- Estende `aespacrm.crm_messages` com campos vindos do WhatsApp e
-- adiciona uma tabela `crm_webhook_events` pra log bruto + idempotência.
--
-- Idempotente — pode rodar várias vezes.
-- =====================================================================

-- =====================================================================
-- 1) Estender crm_messages com campos do WhatsApp
-- =====================================================================
alter table aespacrm.crm_messages
  add column if not exists message_id   text,                 -- key.id da Evolution
  add column if not exists remote_jid   text,                 -- 5511...@s.whatsapp.net
  add column if not exists type         text not null default 'text'
    check (type in ('text','image','video','audio','document','sticker','location','contact','reaction','unknown')),
  add column if not exists media_url    text,
  add column if not exists media_mime   text,
  add column if not exists media_caption text,
  add column if not exists status       text,                 -- sent | delivered | read | failed
  add column if not exists raw          jsonb;                -- payload bruto pra debug

-- Idempotência: mesmo message_id não entra duas vezes pro mesmo usuário
create unique index if not exists uq_crm_messages_user_msgid
  on aespacrm.crm_messages(user_id, message_id)
  where message_id is not null;

create index if not exists idx_crm_messages_remote_jid
  on aespacrm.crm_messages(user_id, remote_jid);

-- =====================================================================
-- 2) Log bruto de eventos (auditoria + replay)
-- =====================================================================
create table if not exists aespacrm.crm_webhook_events (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete set null,  -- pode ser null se não conseguirmos resolver
  instance    text        not null,
  event       text        not null,         -- messages.upsert, connection.update, etc
  payload     jsonb       not null,
  processed   boolean     not null default false,
  error       text,
  received_at timestamptz not null default now()
);
create index if not exists idx_crm_webhook_received on aespacrm.crm_webhook_events(received_at desc);
create index if not exists idx_crm_webhook_event on aespacrm.crm_webhook_events(event, received_at desc);

-- =====================================================================
-- 3) Estado da conexão da instância (CONNECTION_UPDATE)
-- =====================================================================
create table if not exists aespacrm.crm_instance_state (
  user_id       uuid        primary key references auth.users(id) on delete cascade,
  instance      text        not null,
  state         text,                          -- open | connecting | close
  last_event_at timestamptz not null default now()
);

-- =====================================================================
-- 4) RLS — webhook table é só admin (service role bypass), mas
--     instance_state o usuário lê o próprio estado
-- =====================================================================
alter table aespacrm.crm_webhook_events enable row level security;
alter table aespacrm.crm_instance_state enable row level security;

drop policy if exists "own_select" on aespacrm.crm_webhook_events;
create policy "own_select" on aespacrm.crm_webhook_events
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own_select" on aespacrm.crm_instance_state;
create policy "own_select" on aespacrm.crm_instance_state
  for select to authenticated
  using (user_id = auth.uid());

-- (insert/update/delete só via service role — webhook handler)

grant select, insert, update, delete on aespacrm.crm_webhook_events to authenticated;
grant select, insert, update, delete on aespacrm.crm_instance_state to authenticated;

-- =====================================================================
-- FIM
-- =====================================================================
