-- =====================================================================
-- MESCLAGEM DE CONTATOS DUPLICADOS (BR 9º dígito)
-- =====================================================================
-- Problema: no Brasil, a Evolution/WhatsApp às vezes devolve o número
-- com o 9º dígito (55DD9XXXXXXXX, 13 dígitos) e às vezes sem
-- (55DDXXXXXXXX, 12 dígitos). Como phone_norm é dígitos crus, o mesmo
-- contato acaba com 2 linhas em crm_contacts.
--
-- Cada passo é INDEPENDENTE — pode rodar 1 sozinho no SQL Editor.
-- A chave canônica (sem 9º dígito quando for celular BR) está inline
-- em cada passo, então não precisa criar função nenhuma antes.
--
-- Só afeta schema aespacrm. Não altera public/auth. Idempotente.
-- =====================================================================

SET search_path = aespacrm, public;

-- ---------------------------------------------------------------------
-- 1) PREVIEW — pares duplicados por user_id + chave canônica
-- ---------------------------------------------------------------------
WITH base AS (
  SELECT
    c.id, c.user_id, c.name, c.phone_norm, c.created_at, c.avatar_url,
    CASE
      WHEN c.phone_norm ~ '^55[0-9]{2}9[0-9]{8}$'
        THEN '55' || substr(c.phone_norm, 3, 2) || substr(c.phone_norm, 6)
      ELSE c.phone_norm
    END AS key,
    (SELECT count(*) FROM aespacrm.crm_messages m WHERE m.contact_id = c.id) AS msg_count
  FROM aespacrm.crm_contacts c
  WHERE c.is_group = false AND c.phone_norm <> ''
)
SELECT
  user_id,
  key                                             AS canonical,
  count(*)                                        AS qtd,
  array_agg(phone_norm ORDER BY msg_count DESC)   AS numeros,
  array_agg(name       ORDER BY msg_count DESC)   AS nomes,
  array_agg(msg_count  ORDER BY msg_count DESC)   AS mensagens,
  array_agg(id         ORDER BY msg_count DESC, created_at ASC) AS ids
FROM base
GROUP BY user_id, key
HAVING count(*) > 1
ORDER BY qtd DESC, user_id;

-- ---------------------------------------------------------------------
-- 2) MAPA winner/loser em tabela temporária
--    Winner = o com mais mensagens; desempate = mais antigo.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS _contact_dedup_map;
CREATE TEMP TABLE _contact_dedup_map AS
WITH base AS (
  SELECT
    c.id, c.user_id, c.phone_norm, c.created_at, c.avatar_url, c.name,
    CASE
      WHEN c.phone_norm ~ '^55[0-9]{2}9[0-9]{8}$'
        THEN '55' || substr(c.phone_norm, 3, 2) || substr(c.phone_norm, 6)
      ELSE c.phone_norm
    END AS key,
    (SELECT count(*) FROM aespacrm.crm_messages m WHERE m.contact_id = c.id) AS msg_count
  FROM aespacrm.crm_contacts c
  WHERE c.is_group = false AND c.phone_norm <> ''
),
ranked AS (
  SELECT
    id, user_id, key, phone_norm, created_at, avatar_url, name, msg_count,
    row_number() OVER (
      PARTITION BY user_id, key
      ORDER BY msg_count DESC, created_at ASC, id ASC
    ) AS rn
  FROM base
),
winners AS (SELECT user_id, key, id AS winner_id FROM ranked WHERE rn = 1),
losers  AS (SELECT id AS loser_id, user_id, key FROM ranked WHERE rn > 1)
SELECT l.loser_id, l.user_id, w.winner_id
FROM losers l
JOIN winners w ON w.user_id = l.user_id AND w.key = l.key;

SELECT count(*) AS pares_para_mesclar FROM _contact_dedup_map;

-- ---------------------------------------------------------------------
-- 3) MENSAGENS — reatribui contact_id do loser para o winner
-- ---------------------------------------------------------------------
UPDATE aespacrm.crm_messages m
SET contact_id = d.winner_id
FROM _contact_dedup_map d
WHERE m.contact_id = d.loser_id;

-- ---------------------------------------------------------------------
-- 4) TAGS (crm_contact_categories) — PK (contact_id, category_id)
-- ---------------------------------------------------------------------
DELETE FROM aespacrm.crm_contact_categories cc
USING _contact_dedup_map d
WHERE cc.contact_id = d.loser_id
  AND EXISTS (
    SELECT 1 FROM aespacrm.crm_contact_categories cw
    WHERE cw.contact_id = d.winner_id AND cw.category_id = cc.category_id
  );

UPDATE aespacrm.crm_contact_categories cc
SET contact_id = d.winner_id
FROM _contact_dedup_map d
WHERE cc.contact_id = d.loser_id;

-- ---------------------------------------------------------------------
-- 5) SEQUÊNCIAS (crm_contact_sequences) — unique (contact_id, sequence_id)
-- ---------------------------------------------------------------------
DELETE FROM aespacrm.crm_contact_sequences cs
USING _contact_dedup_map d
WHERE cs.contact_id = d.loser_id
  AND EXISTS (
    SELECT 1 FROM aespacrm.crm_contact_sequences cw
    WHERE cw.contact_id = d.winner_id AND cw.sequence_id = cs.sequence_id
  );

UPDATE aespacrm.crm_contact_sequences cs
SET contact_id = d.winner_id
FROM _contact_dedup_map d
WHERE cs.contact_id = d.loser_id;

-- ---------------------------------------------------------------------
-- 6) PIPELINE (crm_pipeline_placements) — PK contact_id
-- ---------------------------------------------------------------------
DELETE FROM aespacrm.crm_pipeline_placements pp
USING _contact_dedup_map d
WHERE pp.contact_id = d.loser_id
  AND EXISTS (
    SELECT 1 FROM aespacrm.crm_pipeline_placements pw
    WHERE pw.contact_id = d.winner_id
  );

UPDATE aespacrm.crm_pipeline_placements pp
SET contact_id = d.winner_id
FROM _contact_dedup_map d
WHERE pp.contact_id = d.loser_id;

-- ---------------------------------------------------------------------
-- 7) BACKFILL do winner com dados úteis do loser (nome real, avatar)
-- ---------------------------------------------------------------------
UPDATE aespacrm.crm_contacts w
SET
  avatar_url = COALESCE(w.avatar_url, l.avatar_url),
  name = CASE
    WHEN (w.name IS NULL OR w.name = '' OR w.name = '+' || w.phone_norm)
         AND l.name IS NOT NULL AND l.name <> '' AND l.name <> '+' || l.phone_norm
      THEN l.name
    ELSE w.name
  END
FROM _contact_dedup_map d
JOIN aespacrm.crm_contacts l ON l.id = d.loser_id
WHERE w.id = d.winner_id;

-- ---------------------------------------------------------------------
-- 8) APAGA losers
-- ---------------------------------------------------------------------
DELETE FROM aespacrm.crm_contacts c
USING _contact_dedup_map d
WHERE c.id = d.loser_id;

-- ---------------------------------------------------------------------
-- 9) Conferência: rodar o PREVIEW do passo 1 deve voltar 0 linhas.
-- ---------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
