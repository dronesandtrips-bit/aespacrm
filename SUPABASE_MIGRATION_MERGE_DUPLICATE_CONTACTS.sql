-- =====================================================================
-- ZapCRM — MESCLAGEM DE CONTATOS DUPLICADOS (BR 9º dígito)
-- =====================================================================
-- Problema: o mesmo celular BR pode chegar com 9º dígito
-- (55DD9XXXXXXXX) ou sem 9º dígito (55DDXXXXXXXX). Como phone_norm guarda
-- os dígitos crus, o mesmo contato pode ficar duplicado.
--
-- COMO RODAR:
--   1) Selecione este arquivo INTEIRO.
--   2) Clique Run uma única vez.
--   3) O resultado final precisa mostrar duplicados_restantes = 0.
--
-- IMPORTANTE:
--   - Não rode em partes. O bloco abaixo é atômico e cria tabelas temporárias.
--   - Só afeta o schema aespacrm. Não toca em public/auth/outros projetos.
--   - Também cria um índice único canônico para impedir novas duplicações.
-- =====================================================================

SET search_path = aespacrm, public;

DO $$
DECLARE
  v_pares_iniciais int := 0;
  v_mensagens_movidas int := 0;
  v_tags_copiadas int := 0;
  v_tags_losers_apagadas int := 0;
  v_logs_sequencia_movidos int := 0;
  v_seq_conflitantes_apagadas int := 0;
  v_sequencias_movidas int := 0;
  v_pipeline_conflitante_apagado int := 0;
  v_pipeline_movido int := 0;
  v_winners_atualizados int := 0;
  v_contatos_apagados int := 0;
  v_duplicados_restantes int := 0;
BEGIN
  DROP TABLE IF EXISTS pg_temp._contact_dedup_map;
  DROP TABLE IF EXISTS pg_temp._contact_dedup_report;

  -- Mapa winner/loser.
  -- Winner = contato com mais mensagens; desempate = mais antigo.
  CREATE TEMP TABLE _contact_dedup_map AS
  WITH base AS (
    SELECT
      c.id,
      c.user_id,
      c.phone_norm,
      c.created_at,
      c.avatar_url,
      c.name,
      c.category_id,
      CASE
        WHEN c.phone_norm ~ '^55[0-9]{2}9[0-9]{8}$'
          THEN '55' || substr(c.phone_norm, 3, 2) || substr(c.phone_norm, 6)
        ELSE c.phone_norm
      END AS canonical_phone,
      (SELECT count(*) FROM aespacrm.crm_messages m WHERE m.contact_id = c.id) AS msg_count
    FROM aespacrm.crm_contacts c
    WHERE c.is_group = false
      AND c.phone_norm <> ''
  ),
  ranked AS (
    SELECT
      id,
      user_id,
      canonical_phone,
      phone_norm,
      created_at,
      avatar_url,
      name,
      category_id,
      msg_count,
      row_number() OVER (
        PARTITION BY user_id, canonical_phone
        ORDER BY msg_count DESC, created_at ASC, id ASC
      ) AS rn
    FROM base
  ),
  winners AS (
    SELECT
      user_id,
      canonical_phone,
      id AS winner_id
    FROM ranked
    WHERE rn = 1
  ),
  losers AS (
    SELECT
      id AS loser_id,
      user_id,
      canonical_phone
    FROM ranked
    WHERE rn > 1
  )
  SELECT
    l.loser_id,
    l.user_id,
    l.canonical_phone,
    w.winner_id
  FROM losers l
  JOIN winners w
    ON w.user_id = l.user_id
   AND w.canonical_phone = l.canonical_phone;

  SELECT count(*) INTO v_pares_iniciais FROM pg_temp._contact_dedup_map;

  -- Mensagens: reatribui contact_id do loser para o winner.
  UPDATE aespacrm.crm_messages m
     SET contact_id = d.winner_id
    FROM pg_temp._contact_dedup_map d
   WHERE m.contact_id = d.loser_id;
  GET DIAGNOSTICS v_mensagens_movidas = ROW_COUNT;

  -- Tags: copia tags do loser para o winner sem conflito e apaga as tags do loser.
  -- Usar INSERT + DELETE é mais seguro que UPDATE porque a PK é (contact_id, category_id).
  INSERT INTO aespacrm.crm_contact_categories (contact_id, category_id, user_id, created_at)
  SELECT d.winner_id, cc.category_id, cc.user_id, cc.created_at
    FROM aespacrm.crm_contact_categories cc
    JOIN pg_temp._contact_dedup_map d ON d.loser_id = cc.contact_id
  ON CONFLICT (contact_id, category_id) DO NOTHING;
  GET DIAGNOSTICS v_tags_copiadas = ROW_COUNT;

  DELETE FROM aespacrm.crm_contact_categories cc
  USING pg_temp._contact_dedup_map d
  WHERE cc.contact_id = d.loser_id;
  GET DIAGNOSTICS v_tags_losers_apagadas = ROW_COUNT;

  -- Sequências duplicadas: antes de apagar uma sequência conflitante,
  -- preserva o histórico movendo crm_sequence_send_log para a sequência winner.
  WITH seq_conflicts AS (
    SELECT
      loser_seq.id AS loser_sequence_row_id,
      winner_seq.id AS winner_sequence_row_id
    FROM aespacrm.crm_contact_sequences loser_seq
    JOIN pg_temp._contact_dedup_map d ON d.loser_id = loser_seq.contact_id
    JOIN aespacrm.crm_contact_sequences winner_seq
      ON winner_seq.contact_id = d.winner_id
     AND winner_seq.sequence_id = loser_seq.sequence_id
  )
  UPDATE aespacrm.crm_sequence_send_log log
     SET contact_sequence_id = sc.winner_sequence_row_id
    FROM seq_conflicts sc
   WHERE log.contact_sequence_id = sc.loser_sequence_row_id;
  GET DIAGNOSTICS v_logs_sequencia_movidos = ROW_COUNT;

  DELETE FROM aespacrm.crm_contact_sequences cs
  USING pg_temp._contact_dedup_map d
  WHERE cs.contact_id = d.loser_id
    AND EXISTS (
      SELECT 1
      FROM aespacrm.crm_contact_sequences cw
      WHERE cw.contact_id = d.winner_id
        AND cw.sequence_id = cs.sequence_id
    );
  GET DIAGNOSTICS v_seq_conflitantes_apagadas = ROW_COUNT;

  UPDATE aespacrm.crm_contact_sequences cs
     SET contact_id = d.winner_id
    FROM pg_temp._contact_dedup_map d
   WHERE cs.contact_id = d.loser_id;
  GET DIAGNOSTICS v_sequencias_movidas = ROW_COUNT;

  -- Pipeline: se winner e loser já têm placement, mantém o winner.
  DELETE FROM aespacrm.crm_pipeline_placements pp
  USING pg_temp._contact_dedup_map d
  WHERE pp.contact_id = d.loser_id
    AND EXISTS (
      SELECT 1
      FROM aespacrm.crm_pipeline_placements pw
      WHERE pw.contact_id = d.winner_id
    );
  GET DIAGNOSTICS v_pipeline_conflitante_apagado = ROW_COUNT;

  UPDATE aespacrm.crm_pipeline_placements pp
     SET contact_id = d.winner_id
    FROM pg_temp._contact_dedup_map d
   WHERE pp.contact_id = d.loser_id;
  GET DIAGNOSTICS v_pipeline_movido = ROW_COUNT;

  -- Backfill: aproveita nome/avatar/categoria do loser quando o winner está vazio/genérico.
  UPDATE aespacrm.crm_contacts w
     SET avatar_url = COALESCE(w.avatar_url, l.avatar_url),
         category_id = COALESCE(w.category_id, l.category_id),
         name = CASE
           WHEN (w.name IS NULL OR w.name = '' OR w.name = '+' || w.phone_norm)
                AND l.name IS NOT NULL
                AND l.name <> ''
                AND l.name <> '+' || l.phone_norm
             THEN l.name
           ELSE w.name
         END
    FROM pg_temp._contact_dedup_map d
    JOIN aespacrm.crm_contacts l ON l.id = d.loser_id
   WHERE w.id = d.winner_id;
  GET DIAGNOSTICS v_winners_atualizados = ROW_COUNT;

  -- Apaga os contatos loser. As FKs restantes têm ON DELETE CASCADE.
  DELETE FROM aespacrm.crm_contacts c
  USING pg_temp._contact_dedup_map d
  WHERE c.id = d.loser_id;
  GET DIAGNOSTICS v_contatos_apagados = ROW_COUNT;

  -- Impede que o problema volte a acontecer para celulares BR com/sem 9º dígito.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contacts_user_phone_canonical
    ON aespacrm.crm_contacts (
      user_id,
      (
        CASE
          WHEN phone_norm ~ '^55[0-9]{2}9[0-9]{8}$'
            THEN '55' || substr(phone_norm, 3, 2) || substr(phone_norm, 6)
          ELSE phone_norm
        END
      )
    )
    WHERE phone_norm <> ''
      AND is_group = false;

  -- Conferência final.
  WITH base AS (
    SELECT
      c.id,
      c.user_id,
      CASE
        WHEN c.phone_norm ~ '^55[0-9]{2}9[0-9]{8}$'
          THEN '55' || substr(c.phone_norm, 3, 2) || substr(c.phone_norm, 6)
        ELSE c.phone_norm
      END AS canonical_phone
    FROM aespacrm.crm_contacts c
    WHERE c.is_group = false
      AND c.phone_norm <> ''
  ),
  dupes AS (
    SELECT user_id, canonical_phone
    FROM base
    GROUP BY user_id, canonical_phone
    HAVING count(*) > 1
  )
  SELECT count(*) INTO v_duplicados_restantes FROM dupes;

  CREATE TEMP TABLE _contact_dedup_report AS
  SELECT
    v_pares_iniciais AS pares_iniciais_para_mesclar,
    v_contatos_apagados AS contatos_duplicados_apagados,
    v_duplicados_restantes AS duplicados_restantes,
    v_mensagens_movidas AS mensagens_movidas,
    v_tags_copiadas AS tags_copiadas_para_winner,
    v_tags_losers_apagadas AS tags_dos_losers_apagadas,
    v_logs_sequencia_movidos AS logs_de_sequencia_preservados,
    v_seq_conflitantes_apagadas AS sequencias_conflitantes_apagadas,
    v_sequencias_movidas AS sequencias_movidas,
    v_pipeline_conflitante_apagado AS pipelines_conflitantes_apagados,
    v_pipeline_movido AS pipelines_movidos,
    v_winners_atualizados AS contatos_winner_atualizados;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT * FROM pg_temp._contact_dedup_report;
