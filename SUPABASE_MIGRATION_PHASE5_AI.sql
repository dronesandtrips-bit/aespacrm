-- =====================================================================
-- ZapCRM — Fase 5: Inteligência de Persona / Categorização por IA
-- Schema: aespacrm  (NUNCA tocar em public ou outros schemas)
-- Rodar 1x no Supabase self-hosted do usuário (VPS).
-- =====================================================================

set search_path = aespacrm, public;

-- 1) Novos campos em crm_contacts ------------------------------------
alter table aespacrm.crm_contacts
  add column if not exists ai_persona_summary text,
  add column if not exists urgency_level text
    check (urgency_level is null or urgency_level in ('Baixa','Média','Alta')),
  add column if not exists last_ai_sync timestamptz;

-- Índice para filtros por urgência (útil na lista)
create index if not exists crm_contacts_urgency_idx
  on aespacrm.crm_contacts (user_id, urgency_level)
  where urgency_level is not null;

-- Índice para busca textual no resumo da IA (opcional — só funciona com pg_trgm)
-- Se der erro "gin_trgm_ops does not exist", rode primeiro:
--   create extension if not exists pg_trgm;
-- Depois rode o create index abaixo. Pular este índice é seguro (filtro UI é client-side).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create index if not exists crm_contacts_persona_trgm_idx
             on aespacrm.crm_contacts using gin (ai_persona_summary gin_trgm_ops)';
  else
    raise notice 'pg_trgm não instalado — índice de busca textual ignorado (sem impacto funcional)';
  end if;
end$$;

-- 2) Confirmação ------------------------------------------------------
-- select column_name, data_type from information_schema.columns
--   where table_schema='aespacrm' and table_name='crm_contacts'
--     and column_name in ('ai_persona_summary','urgency_level','last_ai_sync');
