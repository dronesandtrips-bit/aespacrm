-- =====================================================================
-- ZapCRM — Adicionar coluna `website` em crm_contacts
-- Schema: aespacrm  (NUNCA tocar em public ou outros schemas)
-- Rodar 1x no Supabase self-hosted do usuário (VPS).
--
-- Mudança SEGURA e ADITIVA:
--   - Coluna nullable, sem default obrigatório
--   - Não altera dados existentes
--   - Nenhum fluxo atual depende deste campo
-- =====================================================================

set search_path = aespacrm, public;

alter table aespacrm.crm_contacts
  add column if not exists website text;

-- Confirmação:
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema='aespacrm' and table_name='crm_contacts' and column_name='website';

-- =====================================================================
-- IMPORTANTE — Após rodar a migration:
-- No VPS, rode para atualizar o cache do PostgREST:
--   docker service update --force supabase_supabase_rest
-- Sem isso, o frontend vai dar erro "Could not find the column 'website'
-- in the schema cache".
-- =====================================================================
