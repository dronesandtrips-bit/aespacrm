-- =====================================================================
-- ZapCRM — Remove prefixo "Cliente " das categorias existentes
-- Schema: aespacrm
-- Rodar 1x no Supabase self-hosted (VPS).
--
-- ANTES de rodar: confira o preview com o SELECT comentado abaixo.
-- Se duas categorias colidirem após o rename (ex: "Câmeras" já existe e
-- "Cliente Câmeras" também), o UPDATE vai falhar pelo unique (user_id,name).
-- Nesse caso, MERGE manual: mover crm_contact_categories pra categoria
-- final e deletar a duplicada.
-- =====================================================================

set search_path = aespacrm, public;

-- Preview (rode primeiro, sem commitar nada):
-- select id, name, regexp_replace(name, '^[Cc]liente\s+', '') as new_name
-- from aespacrm.crm_categories
-- where name ilike 'cliente %';

-- Detecta colisões antes do update:
with renamed as (
  select id, user_id, name,
         regexp_replace(name, '^[Cc]liente\s+', '') as new_name
  from aespacrm.crm_categories
  where name ~* '^cliente\s+'
)
select r.user_id, r.name as old_name, r.new_name, c.id as collides_with
from renamed r
join aespacrm.crm_categories c
  on c.user_id = r.user_id
 and lower(c.name) = lower(r.new_name)
 and c.id <> r.id;
-- Se a query acima retornar linhas, RESOLVA as colisões manualmente
-- (apague a duplicada ou faça merge das contact_categories) ANTES do UPDATE.

-- Update propriamente dito:
update aespacrm.crm_categories
set name = regexp_replace(name, '^[Cc]liente\s+', '')
where name ~* '^cliente\s+';

-- Confirmação:
-- select name from aespacrm.crm_categories order by name;
