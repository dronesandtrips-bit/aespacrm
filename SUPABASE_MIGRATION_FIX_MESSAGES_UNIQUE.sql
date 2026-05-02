-- =====================================================================
-- FIX: webhook da Evolution não conseguia gravar nenhuma mensagem
-- =====================================================================
-- Sintoma: aespacrm.crm_messages estava 100% vazia, mesmo com o webhook
-- recebendo POSTs corretamente em /api/public/evolution/webhook.
--
-- Causa raiz: o handler faz upsert com onConflict="user_id,message_id",
-- mas a tabela crm_messages NÃO tinha unique constraint nessa combinação.
-- Postgres respondia 42P10 ("there is no unique or exclusion constraint
-- matching the ON CONFLICT specification"), o catch engolia o erro e
-- nada era persistido.
--
-- Esta migration adiciona a unique constraint que falta. Idempotente.
-- =====================================================================

SET search_path TO aespacrm, public;

-- Garante que message_ids duplicados (caso existam de testes antigos) não
-- bloqueiem a criação da constraint. Mantém a linha mais recente por (user_id,
-- message_id) e remove as outras. Em produção atualmente a tabela está vazia,
-- então este DELETE é no-op — fica aqui só por segurança.
DELETE FROM aespacrm.crm_messages a
USING aespacrm.crm_messages b
WHERE a.user_id = b.user_id
  AND a.message_id IS NOT NULL
  AND a.message_id = b.message_id
  AND a.ctid < b.ctid;

-- Cria a unique constraint se ainda não existe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'aespacrm.crm_messages'::regclass
      AND conname  = 'crm_messages_user_message_uniq'
  ) THEN
    ALTER TABLE aespacrm.crm_messages
      ADD CONSTRAINT crm_messages_user_message_uniq
      UNIQUE (user_id, message_id);
  END IF;
END$$;

-- (Opcional, mas recomendado) Índice para acelerar buscas por contato + tempo,
-- usado pelo Inbox e pelo enrich da IA.
CREATE INDEX IF NOT EXISTS crm_messages_contact_at_idx
  ON aespacrm.crm_messages (contact_id, at DESC);

-- Sanity check
SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'aespacrm.crm_messages'::regclass
  AND contype = 'u';
