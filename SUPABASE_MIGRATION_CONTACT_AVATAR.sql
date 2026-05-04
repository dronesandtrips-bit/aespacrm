-- =====================================================================
-- ZapCRM — Foto de perfil dos contatos (vinda da Evolution API)
-- Schema: aespacrm. Idempotente.
-- =====================================================================

set search_path = aespacrm;

alter table aespacrm.crm_contacts
  add column if not exists avatar_url text;

comment on column aespacrm.crm_contacts.avatar_url is
  'URL da foto de perfil do WhatsApp (cache da Evolution API). Pode ser null.';
