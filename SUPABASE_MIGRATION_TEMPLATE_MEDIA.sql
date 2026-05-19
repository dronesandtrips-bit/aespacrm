-- Aditivo: campos de mídia em templates de mensagem e passos de sequência.
-- Permite anexar imagem/vídeo/áudio/documento ao template; o passo herda
-- ao carregar o template e o endpoint /api/public/sequences/due passa a
-- expor `media` para o n8n disparar via /api/public/evolution/send-media.
-- INTEGRIDADE: todas as colunas são nullable, nada existente é alterado.

set search_path = aespacrm;

alter table crm_message_templates
  add column if not exists media_base64   text,
  add column if not exists media_type     text,
  add column if not exists media_mime     text,
  add column if not exists media_filename text,
  add column if not exists media_caption  text;

alter table crm_sequence_steps
  add column if not exists media_base64   text,
  add column if not exists media_type     text,
  add column if not exists media_mime     text,
  add column if not exists media_filename text,
  add column if not exists media_caption  text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_message_templates_media_type_check'
  ) then
    alter table crm_message_templates
      add constraint crm_message_templates_media_type_check
      check (media_type is null or media_type in ('image','document','video','audio'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_sequence_steps_media_type_check'
  ) then
    alter table crm_sequence_steps
      add constraint crm_sequence_steps_media_type_check
      check (media_type is null or media_type in ('image','document','video','audio'));
  end if;
end $$;

notify pgrst, 'reload schema';
