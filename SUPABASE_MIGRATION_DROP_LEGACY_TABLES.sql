-- ============================================================
-- DROP de tabelas legadas sem prefixo no schema aespacrm
-- ============================================================
-- Contexto: durante a padronização do ZapCRM, todas as tabelas
-- foram migradas para o prefixo `crm_`. As 7 tabelas abaixo
-- ficaram como sobras: estão vazias (0 linhas em 08/mai/2026)
-- e nenhuma é referenciada no código (busca por `.from('<nome>')`
-- retorna zero ocorrências).
--
-- Verificado em 08/mai/2026:
--   contacts             0 linhas
--   messages             0 linhas
--   categories           0 linhas
--   pipeline_stages      0 linhas
--   pipeline_placements  0 linhas
--   bulk_sends           0 linhas
--   user_roles           0 linhas
--
-- IMPORTANTE: Operação destrutiva. Faça backup do schema
-- `aespacrm` antes de rodar (mesmo estando vazias).
-- ============================================================

BEGIN;

-- Trava de segurança: aborta se alguma das tabelas tiver linhas.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts','messages','categories','pipeline_stages',
    'pipeline_placements','bulk_sends','user_roles'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM aespacrm.%I', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Abortando: aespacrm.% contém % linhas. Investigue antes de dropar.', t, n;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS aespacrm.contacts            CASCADE;
DROP TABLE IF EXISTS aespacrm.messages            CASCADE;
DROP TABLE IF EXISTS aespacrm.categories          CASCADE;
DROP TABLE IF EXISTS aespacrm.pipeline_stages     CASCADE;
DROP TABLE IF EXISTS aespacrm.pipeline_placements CASCADE;
DROP TABLE IF EXISTS aespacrm.bulk_sends          CASCADE;
DROP TABLE IF EXISTS aespacrm.user_roles          CASCADE;

COMMIT;

-- Pós-execução: se aparecer "Could not find the table ... in the schema cache"
-- em algum lugar, rode no VPS:
--   docker service update --force supabase_supabase_rest
