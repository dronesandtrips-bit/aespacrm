-- =====================================================================
-- ZapCRM — Multi-categorias (tags) para contatos
-- =====================================================================
-- Cria tabela de ligação M:N entre crm_contacts e crm_categories.
-- Mantém crm_contacts.category_id como ESPELHO da "categoria principal"
-- (1ª tag, por created_at). Compatibilidade total com pipeline,
-- disparos, sequências, widgets e webhooks que ainda usam category_id.
--
-- Idempotente — pode rodar várias vezes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabela de ligação
-- ---------------------------------------------------------------------
create table if not exists aespacrm.crm_contact_categories (
  contact_id  uuid        not null references aespacrm.crm_contacts(id) on delete cascade,
  category_id uuid        not null references aespacrm.crm_categories(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (contact_id, category_id)
);

create index if not exists idx_crm_cc_user
  on aespacrm.crm_contact_categories(user_id);
create index if not exists idx_crm_cc_contact
  on aespacrm.crm_contact_categories(contact_id, created_at);
create index if not exists idx_crm_cc_category
  on aespacrm.crm_contact_categories(category_id);

-- ---------------------------------------------------------------------
-- 2) RLS por usuário
-- ---------------------------------------------------------------------
alter table aespacrm.crm_contact_categories enable row level security;

drop policy if exists "own_select" on aespacrm.crm_contact_categories;
drop policy if exists "own_insert" on aespacrm.crm_contact_categories;
drop policy if exists "own_update" on aespacrm.crm_contact_categories;
drop policy if exists "own_delete" on aespacrm.crm_contact_categories;

create policy "own_select" on aespacrm.crm_contact_categories
  for select to authenticated using (user_id = auth.uid());
create policy "own_insert" on aespacrm.crm_contact_categories
  for insert to authenticated with check (user_id = auth.uid());
create policy "own_update" on aespacrm.crm_contact_categories
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own_delete" on aespacrm.crm_contact_categories
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3) Migra dados existentes (cada contato com category_id vira 1 linha)
-- ---------------------------------------------------------------------
insert into aespacrm.crm_contact_categories (contact_id, category_id, user_id, created_at)
select c.id, c.category_id, c.user_id, c.created_at
from aespacrm.crm_contacts c
where c.category_id is not null
on conflict (contact_id, category_id) do nothing;

-- ---------------------------------------------------------------------
-- 4) Função + triggers para manter crm_contacts.category_id como
--    espelho da "categoria principal" (1ª tag adicionada).
-- ---------------------------------------------------------------------
create or replace function aespacrm.sync_primary_category(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = aespacrm, public
as $$
declare
  v_first uuid;
begin
  select category_id into v_first
  from aespacrm.crm_contact_categories
  where contact_id = p_contact_id
  order by created_at asc, category_id asc
  limit 1;

  update aespacrm.crm_contacts
     set category_id = v_first
   where id = p_contact_id
     and category_id is distinct from v_first;
end;
$$;

create or replace function aespacrm.trg_cc_after_change()
returns trigger
language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    perform aespacrm.sync_primary_category(old.contact_id);
    return old;
  else
    perform aespacrm.sync_primary_category(new.contact_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_cc_sync_primary on aespacrm.crm_contact_categories;
create trigger trg_cc_sync_primary
  after insert or delete on aespacrm.crm_contact_categories
  for each row execute function aespacrm.trg_cc_after_change();

-- ---------------------------------------------------------------------
-- 5) Grants e reload do PostgREST
-- ---------------------------------------------------------------------
grant select, insert, update, delete on aespacrm.crm_contact_categories to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- FIM. Após rodar:
--   - crm_contact_categories segura as M tags do contato.
--   - crm_contacts.category_id é mantido sincronizado com a 1ª tag
--     automaticamente, então pipeline/disparos/sequências/widgets
--     continuam funcionando sem alteração.
-- =====================================================================
