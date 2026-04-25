-- =====================================================================
-- ZapCRM — Fase 1.5: Gatilhos automáticos (etapa/categoria → sequência)
-- =====================================================================
-- Adiciona coluna `sequence_id` em crm_pipeline_stages e crm_categories.
-- Quando um contato cai numa etapa/categoria com sequência associada, o
-- app inscreve ele automaticamente (e pausa qualquer sequência ativa
-- anterior — política "Pausar a antiga e iniciar a nova").
--
-- Idempotente — pode rodar várias vezes.
-- =====================================================================

alter table aespacrm.crm_pipeline_stages
  add column if not exists sequence_id uuid
    references aespacrm.crm_sequences(id) on delete set null;

alter table aespacrm.crm_categories
  add column if not exists sequence_id uuid
    references aespacrm.crm_sequences(id) on delete set null;

create index if not exists idx_crm_stages_sequence
  on aespacrm.crm_pipeline_stages(sequence_id) where sequence_id is not null;

create index if not exists idx_crm_categories_sequence
  on aespacrm.crm_categories(sequence_id) where sequence_id is not null;

-- Recarrega o cache do PostgREST pra reconhecer as novas colunas
notify pgrst, 'reload schema';
