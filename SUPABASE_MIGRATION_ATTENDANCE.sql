-- Confirmação automática de presença — ZapCRM
-- Aditivo: apenas adiciona colunas de controle na tabela de lembretes.
-- Rodar no Supabase self-hosted (SQL Editor) e depois:
--   docker service update --force supabase_supabase_rest

alter table aespacrm.crm_appointment_reminders
  add column if not exists attendance_status text not null default 'unknown',
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists attendance_answered_at timestamptz,
  add column if not exists attendance_reply text;

alter table aespacrm.crm_appointment_reminders
  drop constraint if exists crm_appt_reminders_attendance_check;

alter table aespacrm.crm_appointment_reminders
  add constraint crm_appt_reminders_attendance_check
  check (attendance_status in ('unknown', 'awaiting', 'confirmed', 'declined'));

create index if not exists idx_crm_appt_reminders_attendance
  on aespacrm.crm_appointment_reminders (phone, attendance_status, start_at);

notify pgrst, 'reload schema';
