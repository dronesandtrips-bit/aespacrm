-- =====================================================================
-- ZapCRM — Cofre de segredos do app (Global API Key da Evolution etc.)
-- Schema: aespacrm  |  Tabela: crm_app_secrets
--
-- Segurança:
--   * RLS habilitado SEM políticas para anon/authenticated => o valor
--     NUNCA é legível pelo navegador / Data API do usuário.
--   * Somente service_role (usado pelos endpoints server-side) acessa.
-- =====================================================================

create table if not exists aespacrm.crm_app_secrets (
  user_id    uuid        not null,
  name       text        not null,
  value      text        not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

-- Sem GRANT para anon/authenticated: acesso apenas via service_role.
revoke all on aespacrm.crm_app_secrets from anon, authenticated;
grant all on aespacrm.crm_app_secrets to service_role;

alter table aespacrm.crm_app_secrets enable row level security;
-- (nenhuma policy: service_role bypassa RLS; demais roles ficam bloqueadas)
