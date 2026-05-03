-- =====================================================================
-- Categorias: palavras-chave (auto-classificação)
-- =====================================================================
-- Adiciona coluna `keywords text[]` em aespacrm.crm_categories.
-- O webhook /api/public/ai/contact-enrich varre o histórico do cliente
-- e, se alguma palavra-chave aparecer, força a categoria correspondente
-- (com prioridade sobre o que a IA sugeriu).
--
-- Como rodar: cole no SQL Editor do Supabase e execute. Idempotente.
-- =====================================================================

ALTER TABLE aespacrm.crm_categories
  ADD COLUMN IF NOT EXISTS keywords text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN aespacrm.crm_categories.keywords IS
  'Palavras/frases-chave (case-insensitive). Se aparecerem no histórico do cliente, a categoria é aplicada automaticamente.';

-- Recarrega o cache do PostgREST (no self-hosted, rodar no VPS):
--   docker service update --force supabase_supabase_rest
NOTIFY pgrst, 'reload schema';
