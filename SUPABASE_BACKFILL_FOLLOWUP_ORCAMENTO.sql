-- =====================================================================
-- BACKFILL: tag "Follow-up" para contatos que RECEBERAM mensagem
-- contendo "orçamento" (acento-insensitive) desde 22/06/2025.
--
-- Regras:
--  - Só contatos 1:1 (is_group = false).
--  - Só mensagens recebidas (from_me = false).
--  - Match acento-insensitive: "orçamento", "orcamento", "Orçamento" etc.
--  - Cria a categoria "Follow-up" (cor #F59E0B) por usuário se não existir.
--  - source = 'manual' → NÃO é apagada pelo enrich da IA (mode=replace).
--  - ON CONFLICT DO NOTHING → seguro rodar múltiplas vezes.
--
-- Como rodar: cole no SQL Editor do Supabase e execute como um bloco só.
-- =====================================================================

set search_path = aespacrm, public;

-- 1) Garante categoria "Follow-up" para todo user_id que tenha mensagem-match.
insert into aespacrm.crm_categories (user_id, name, color, status)
select distinct m.user_id, 'Follow-up', '#F59E0B', 'approved'
from aespacrm.crm_messages m
join aespacrm.crm_contacts c
  on c.id = m.contact_id
 and c.user_id = m.user_id
 and coalesce(c.is_group, false) = false
where m.from_me = false
  and m.at >= '2025-06-22 00:00:00-03'::timestamptz
  and translate(
        lower(coalesce(m.body, '')),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      ) like '%orcamento%'
  and not exists (
    select 1 from aespacrm.crm_categories x
    where x.user_id = m.user_id
      and lower(x.name) = 'follow-up'
  );

-- 2) Aplica a tag em todos os contatos alvo.
--    source='manual' para blindar contra o enrich da IA.
with alvo as (
  select distinct m.user_id, m.contact_id
  from aespacrm.crm_messages m
  join aespacrm.crm_contacts c
    on c.id = m.contact_id
   and c.user_id = m.user_id
   and coalesce(c.is_group, false) = false
  where m.from_me = false
    and m.at >= '2025-06-22 00:00:00-03'::timestamptz
    and translate(
          lower(coalesce(m.body, '')),
          'áàâãäéèêëíìîïóòôõöúùûüç',
          'aaaaaeeeeiiiiooooouuuuc'
        ) like '%orcamento%'
),
cat as (
  select id as category_id, user_id
  from aespacrm.crm_categories
  where lower(name) = 'follow-up'
)
insert into aespacrm.crm_contact_categories (user_id, contact_id, category_id, source)
select a.user_id, a.contact_id, cat.category_id, 'manual'
from alvo a
join cat on cat.user_id = a.user_id
on conflict (contact_id, category_id) do nothing;

-- 3) Relatório: quantos contatos foram tocados agora e o total com a tag.
with alvo as (
  select distinct m.user_id, m.contact_id
  from aespacrm.crm_messages m
  join aespacrm.crm_contacts c
    on c.id = m.contact_id
   and c.user_id = m.user_id
   and coalesce(c.is_group, false) = false
  where m.from_me = false
    and m.at >= '2025-06-22 00:00:00-03'::timestamptz
    and translate(
          lower(coalesce(m.body, '')),
          'áàâãäéèêëíìîïóòôõöúùûüç',
          'aaaaaeeeeiiiiooooouuuuc'
        ) like '%orcamento%'
)
select
  (select count(*) from alvo)                                  as contatos_com_orcamento_desde_2206,
  (select count(*) from aespacrm.crm_contact_categories cc
     join aespacrm.crm_categories x on x.id = cc.category_id
    where lower(x.name) = 'follow-up')                          as total_com_tag_followup;

-- Se a coluna `source` não existir no seu ambiente, rode antes:
--   SUPABASE_MIGRATION_TAG_SOURCE.sql
-- (ela cria a coluna + check constraint que aceita 'manual'|'ai').
