-- =====================================================================
-- ZapCRM — Suporte a CONVERSAS DE GRUPO (somente Inbox/WhatsWeb)
--
-- Objetivo: permitir que mensagens de grupos do WhatsApp (@g.us) sejam
-- gravadas e exibidas na aba WhatsWeb, mas SEM aparecer em Contatos,
-- Pipeline, Sequências, IA, Bulk, Blacklist nem na contagem do dashboard.
--
-- Como rodar (no VPS, no SQL Editor do Supabase self-hosted):
--   1) Conectar como postgres
--   2) Executar este script inteiro
--   3) Forçar refresh do schema cache do PostgREST:
--        docker service update --force supabase_supabase_rest
-- =====================================================================

set search_path = aespacrm, public;

-- 1) Novas colunas em crm_contacts
alter table aespacrm.crm_contacts
  add column if not exists is_group boolean not null default false;

alter table aespacrm.crm_contacts
  add column if not exists wa_jid text;

create index if not exists idx_crm_contacts_user_isgroup
  on aespacrm.crm_contacts(user_id, is_group);

-- 2) Refazer índice único de telefone para EXCLUIR grupos
--    (grupos compartilham o mesmo "phone_norm" lixo derivado do JID e
--     poderiam colidir entre si — separamos a unicidade por wa_jid).
drop index if exists aespacrm.uq_crm_contacts_user_phone;
create unique index uq_crm_contacts_user_phone
  on aespacrm.crm_contacts(user_id, phone_norm)
  where phone_norm <> '' and is_group = false;

create unique index if not exists uq_crm_contacts_user_wajid
  on aespacrm.crm_contacts(user_id, wa_jid)
  where wa_jid is not null;

-- 3) Garantir que contatos antigos fiquem como is_group=false (default já cobre).

-- 4) (Defensivo) Marcar como grupo qualquer contato cujo phone começa com
--    o padrão típico de JID de grupo (ex.: "120363..."). Apenas se não tiver
--    sido marcado ainda. Ajuste/remova se preferir não tocar em legado.
-- update aespacrm.crm_contacts
--   set is_group = true,
--       wa_jid   = phone || '@g.us'
--   where is_group = false
--     and phone ~ '^[0-9]{15,}$';
