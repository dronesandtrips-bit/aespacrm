-- Aditivo: persistir contact_ids para que o runner cron de disparos
-- agendados (/api/public/evolution/bulk-tick) consiga executar mesmo
-- depois que o request HTTP original do agendamento já foi encerrado.

set search_path = aespacrm;

alter table crm_bulk_sends
  add column if not exists contact_ids uuid[];

create index if not exists crm_bulk_sends_tick_idx
  on crm_bulk_sends (status, scheduled_at)
  where status = 'scheduled';

notify pgrst, 'reload schema';
