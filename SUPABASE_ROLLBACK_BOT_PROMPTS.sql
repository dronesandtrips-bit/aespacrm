-- Rollback de SUPABASE_MIGRATION_BOT_PROMPTS.sql
-- Remove a tabela de system prompts versionados do Robô (não usada mais;
-- o prompt é gerenciado no projeto roboaespa).

drop trigger if exists trg_crm_bot_prompts_updated_at on aespacrm.crm_bot_prompts;
drop table if exists aespacrm.crm_bot_prompts cascade;

-- Recarrega o cache do PostgREST
notify pgrst, 'reload schema';
