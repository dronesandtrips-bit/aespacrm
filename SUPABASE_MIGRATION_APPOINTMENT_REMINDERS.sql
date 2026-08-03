-- Lembretes automáticos de compromissos (WhatsApp) — ZapCRM
-- Aditivo: cria apenas uma nova tabela no schema aespacrm.
-- Rodar no Supabase self-hosted (SQL Editor) e depois:
--   docker service update --force supabase_supabase_rest

create table if not exists aespacrm.crm_appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_id text,
  title text not null,
  start_at timestamptz not null,
  location text,
  html_link text,
  maps_link text,
  -- destino
  target text not null check (target in ('client', 'owner')),
  phone text not null,
  contact_name text,
  -- disparo
  remind_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'error', 'canceled')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_appt_reminders_due
  on aespacrm.crm_appointment_reminders (status, remind_at);
create index if not exists idx_crm_appt_reminders_user
  on aespacrm.crm_appointment_reminders (user_id, start_at desc);

alter table aespacrm.crm_appointment_reminders enable row level security;

grant select, insert, update, delete on aespacrm.crm_appointment_reminders to authenticated;
grant all on aespacrm.crm_appointment_reminders to service_role;

drop policy if exists "own appointment reminders" on aespacrm.crm_appointment_reminders;
create policy "own appointment reminders"
  on aespacrm.crm_appointment_reminders
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
