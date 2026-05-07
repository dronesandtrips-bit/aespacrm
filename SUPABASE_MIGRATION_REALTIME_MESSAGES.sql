-- Habilita Realtime (Postgres logical replication) para crm_messages
-- e crm_contacts no schema aespacrm. Idempotente.
--
-- Necessário para que o listener global de notificações sonoras
-- (useGlobalMessagePing) receba eventos INSERT em tempo real.

DO $$
BEGIN
  -- Garante REPLICA IDENTITY FULL para que o payload do INSERT
  -- contenha todas as colunas (necessário para checar from_me/contact_id).
  EXECUTE 'ALTER TABLE aespacrm.crm_messages REPLICA IDENTITY FULL';
  EXECUTE 'ALTER TABLE aespacrm.crm_contacts REPLICA IDENTITY FULL';

  -- Adiciona crm_messages à publication supabase_realtime (se ainda não estiver)
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'aespacrm'
      AND tablename = 'crm_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE aespacrm.crm_messages';
  END IF;

  -- Adiciona crm_contacts (usado pelo cache de is_group e pelo refresh de inbox)
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'aespacrm'
      AND tablename = 'crm_contacts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE aespacrm.crm_contacts';
  END IF;
END
$$;
