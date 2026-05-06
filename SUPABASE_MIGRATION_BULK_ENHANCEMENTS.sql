-- Aditivo: melhorias do módulo Disparos (variáveis, mídia, agendamento, controle).
-- Não altera dados existentes nem quebra colunas em uso.

set search_path = aespacrm;

alter table crm_bulk_sends
  add column if not exists scheduled_at  timestamptz,
  add column if not exists media_base64  text,
  add column if not exists media_type    text,         -- 'image' | 'document' | 'video' | 'audio'
  add column if not exists media_mime    text,
  add column if not exists media_filename text,
  add column if not exists media_caption text,
  add column if not exists control       text not null default 'run'; -- 'run' | 'paused' | 'cancelled'

-- Remove eventual CHECK antigo no status e recria aceitando novos valores.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'aespacrm.crm_bulk_sends'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table aespacrm.crm_bulk_sends drop constraint %I', c);
  end loop;
end $$;

alter table crm_bulk_sends
  add constraint crm_bulk_sends_status_check
  check (status in ('pending','scheduled','in_progress','paused','completed','error','cancelled'));

alter table crm_bulk_sends
  add constraint crm_bulk_sends_control_check
  check (control in ('run','paused','cancelled'));

create index if not exists crm_bulk_sends_scheduled_idx
  on crm_bulk_sends (status, scheduled_at)
  where status = 'scheduled';

notify pgrst, 'reload schema';
