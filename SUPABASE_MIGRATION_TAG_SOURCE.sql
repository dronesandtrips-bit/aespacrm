-- =====================================================================
-- ZapCRM — Origem das tags (manual vs ai)
-- =====================================================================
-- Adiciona coluna `source` em crm_contact_categories para distinguir
-- tags adicionadas manualmente (UI) das adicionadas pela IA (enrich).
--
-- Com isso, o endpoint /api/public/ai/contact-enrich em mode=replace
-- passa a apagar SOMENTE tags de origem 'ai', preservando 100% das
-- tags manuais do usuário.
--
-- Idempotente — pode rodar várias vezes.
-- =====================================================================

alter table aespacrm.crm_contact_categories
  add column if not exists source text not null default 'manual';

-- Constraint só aceita valores conhecidos
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_contact_categories_source_chk'
      and conrelid = 'aespacrm.crm_contact_categories'::regclass
  ) then
    alter table aespacrm.crm_contact_categories
      add constraint crm_contact_categories_source_chk
      check (source in ('manual','ai'));
  end if;
end$$;

create index if not exists idx_crm_cc_source
  on aespacrm.crm_contact_categories(contact_id, source);

notify pgrst, 'reload schema';

-- =====================================================================
-- FIM. Após rodar:
--   - Linhas existentes ficam como source='manual' (default).
--   - O endpoint da IA passará a inserir com source='ai' e o mode=replace
--     só apagará linhas 'ai'.
-- =====================================================================
