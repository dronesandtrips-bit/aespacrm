-- =====================================================================
-- ZapCRM — Correção de dados: dono dos vínculos contato-tag
-- =====================================================================
-- Corrige linhas antigas em crm_contact_categories que foram gravadas com
-- user_id diferente do dono real do contato. Isso fazia tags existirem no
-- banco, mas não aparecerem corretamente para o usuário pela RLS.
--
-- Seguro/idempotente: afeta somente o schema aespacrm e somente vínculos
-- cujo user_id diverge de crm_contacts.user_id.
-- =====================================================================

update aespacrm.crm_contact_categories cc
set user_id = c.user_id
from aespacrm.crm_contacts c
where c.id = cc.contact_id
  and cc.user_id is distinct from c.user_id;

notify pgrst, 'reload schema';

-- Conferência opcional: deve retornar 0 linhas após executar.
select cc.contact_id, cc.category_id, cc.user_id as link_user_id, c.user_id as contact_user_id
from aespacrm.crm_contact_categories cc
join aespacrm.crm_contacts c on c.id = cc.contact_id
where cc.user_id is distinct from c.user_id;