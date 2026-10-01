-- ZapCRM: pausa entre destinatários da mesma sequência.
-- Aplicar somente no schema dedicado aespacrm, antes de habilitar o novo disparador.
alter table aespacrm.crm_sequences
  add column if not exists client_interval_seconds integer not null default 60;

alter table aespacrm.crm_sequences
  drop constraint if exists crm_sequences_client_interval_seconds_check;

alter table aespacrm.crm_sequences
  add constraint crm_sequences_client_interval_seconds_check
  check (client_interval_seconds between 60 and 300);