-- Agendamento automático pelo Robô — ZapCRM
-- Aditivo: apenas permite o status 'paused' nos lembretes (lembretes do
-- cliente ficam pausados até você confirmar o compromisso na Agenda).
--
-- Rodar no Supabase self-hosted (SQL Editor) e depois:
--   docker service update --force supabase_supabase_rest

alter table aespacrm.crm_appointment_reminders
  drop constraint if exists crm_appointment_reminders_status_check;

alter table aespacrm.crm_appointment_reminders
  add constraint crm_appointment_reminders_status_check
  check (status in ('pending', 'paused', 'sent', 'error', 'canceled'));

notify pgrst, 'reload schema';
