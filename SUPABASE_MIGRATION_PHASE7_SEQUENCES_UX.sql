-- =====================================================================
-- ZapCRM Phase 7 — Sequências: humanização + número de teste
-- Schema: aespacrm. Idempotente.
-- =====================================================================

set search_path = aespacrm;

-- 1) Simulação de digitação por passo (segundos antes do envio)
alter table aespacrm.crm_sequence_steps
  add column if not exists typing_seconds integer not null default 0
  check (typing_seconds >= 0 and typing_seconds <= 60);

comment on column aespacrm.crm_sequence_steps.typing_seconds is
  'Segundos de "digitando..." antes de enviar a mensagem (0 = imediato).';

-- 2) Número de teste do usuário (usado pelo botão "Enviar teste")
alter table aespacrm.crm_user_settings
  add column if not exists test_phone text;

comment on column aespacrm.crm_user_settings.test_phone is
  'Telefone (com DDI) para receber prévias de mensagens de sequência.';
