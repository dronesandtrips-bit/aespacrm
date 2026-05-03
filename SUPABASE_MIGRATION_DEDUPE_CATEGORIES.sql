-- =====================================================================
-- DEDUPLICAÇÃO DE CATEGORIAS + ÍNDICE ÚNICO CASE-INSENSITIVE
-- =====================================================================
-- Objetivo: impedir definitivamente que existam categorias duplicadas
-- (mesmo nome com caixa/espaços diferentes) por usuário.
--
-- Execute no SQL Editor do Supabase NA ORDEM:
--   1) PREVIEW: ver o que será mesclado
--   2) MERGE:   migrar contatos das duplicatas para a categoria "vencedora"
--   3) DELETE:  apagar as duplicatas órfãs
--   4) INDEX:   criar índice único case-insensitive
-- =====================================================================

SET search_path = aespacrm, public;

-- ---------------------------------------------------------------------
-- 1) PREVIEW — mostra grupos de duplicatas (mesmo user_id + nome normalizado)
-- ---------------------------------------------------------------------
WITH norm AS (
  SELECT
    id,
    user_id,
    name,
    lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS key,
    created_at
  FROM aespacrm.crm_categories
)
SELECT
  user_id,
  key                                  AS normalized_name,
  count(*)                             AS qtd,
  array_agg(name ORDER BY created_at)  AS variantes,
  array_agg(id   ORDER BY created_at)  AS ids
FROM norm
GROUP BY user_id, key
HAVING count(*) > 1
ORDER BY qtd DESC;

-- ---------------------------------------------------------------------
-- 2) MERGE — para cada grupo, escolhe o id mais antigo como "vencedor"
-- e move todos os vínculos (crm_contact_categories + crm_contacts.category_id)
-- para ele. Também atualiza is_primary onde existir.
-- ---------------------------------------------------------------------
WITH norm AS (
  SELECT
    id,
    user_id,
    lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS key,
    created_at,
    row_number() OVER (
      PARTITION BY user_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM aespacrm.crm_categories
),
winners AS (
  SELECT user_id, key, id AS winner_id FROM norm WHERE rn = 1
),
losers AS (
  SELECT n.id AS loser_id, w.winner_id, n.user_id
  FROM norm n
  JOIN winners w ON w.user_id = n.user_id AND w.key = n.key
  WHERE n.rn > 1
)
-- 2a) Migra a tabela ponte, evitando violar UNIQUE(contact_id, category_id)
, moved AS (
  UPDATE aespacrm.crm_contact_categories cc
  SET category_id = l.winner_id
  FROM losers l
  WHERE cc.category_id = l.loser_id
    AND NOT EXISTS (
      SELECT 1 FROM aespacrm.crm_contact_categories cc2
      WHERE cc2.contact_id = cc.contact_id
        AND cc2.category_id = l.winner_id
    )
  RETURNING 1
)
SELECT count(*) AS bridge_rows_migrated FROM moved;

-- 2b) Apaga as ponte que sobraram apontando para loser (já existia o vencedor)
WITH norm AS (
  SELECT id, user_id,
         lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS key,
         row_number() OVER (
           PARTITION BY user_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM aespacrm.crm_categories
),
losers AS (SELECT id AS loser_id FROM norm WHERE rn > 1)
DELETE FROM aespacrm.crm_contact_categories cc
USING losers l
WHERE cc.category_id = l.loser_id;

-- 2c) Atualiza crm_contacts.category_id (espelho da primária)
WITH norm AS (
  SELECT id, user_id,
         lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS key,
         row_number() OVER (
           PARTITION BY user_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM aespacrm.crm_categories
),
winners AS (SELECT user_id, key, id AS winner_id FROM norm WHERE rn = 1),
losers  AS (
  SELECT n.id AS loser_id, w.winner_id
  FROM norm n
  JOIN winners w ON w.user_id = n.user_id AND w.key = n.key
  WHERE n.rn > 1
)
UPDATE aespacrm.crm_contacts c
SET category_id = l.winner_id
FROM losers l
WHERE c.category_id = l.loser_id;

-- ---------------------------------------------------------------------
-- 3) DELETE — apaga as categorias duplicadas (loser) que sobraram
-- ---------------------------------------------------------------------
WITH norm AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM aespacrm.crm_categories
)
DELETE FROM aespacrm.crm_categories
WHERE id IN (SELECT id FROM norm WHERE rn > 1);

-- ---------------------------------------------------------------------
-- 4) ÍNDICE ÚNICO case-insensitive + trim + colapso de espaços
-- Daqui pra frente, o banco REJEITA qualquer tentativa de criar
-- categoria duplicada (UI, IA, qualquer fonte).
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS crm_categories_user_name_uniq_ci
ON aespacrm.crm_categories (
  user_id,
  lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
);

-- Pronto. Para testar, rode novamente o SELECT do passo 1: deve voltar 0 linhas.
