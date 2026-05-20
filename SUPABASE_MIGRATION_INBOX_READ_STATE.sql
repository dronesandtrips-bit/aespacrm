-- =====================================================================
-- ZapCRM — Inbox unread state
-- Adiciona last_read_at em aespacrm.crm_contacts para o WhatsWeb
-- mostrar contagem de mensagens não lidas (badge verde com número).
-- Aditivo: coluna nullable, não quebra nada existente.
-- =====================================================================

set search_path = aespacrm;

alter table aespacrm.crm_contacts
  add column if not exists last_read_at timestamptz;

comment on column aespacrm.crm_contacts.last_read_at is
  'Última vez que o usuário do CRM abriu a conversa deste contato no WhatsWeb. Usado para contar mensagens não lidas (from_me=false e at > last_read_at).';

-- IMPORTANTE: após rodar este SQL, reiniciar o PostgREST no VPS para
-- atualizar o schema cache:
--   docker service update --force supabase_supabase_rest
-- Ver mem://supabase-schema-cache.
