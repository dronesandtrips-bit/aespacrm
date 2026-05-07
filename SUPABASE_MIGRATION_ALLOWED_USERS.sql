-- =====================================================================
-- ZapCRM — Allowlist de usuários autorizados a acessar o CRM
-- =====================================================================
-- Cria aespacrm.crm_allowed_users e adiciona policy RLS extra em todas
-- as tabelas aespacrm.* exigindo que auth.uid() esteja na allowlist.
--
-- Idempotente. Rode UMA VEZ no SQL Editor do Supabase self-hosted.
-- =====================================================================

set search_path = aespacrm, public;

-- 1) Tabela de allowlist
create table if not exists aespacrm.crm_allowed_users (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table aespacrm.crm_allowed_users enable row level security;

drop policy if exists "allowed_self_select" on aespacrm.crm_allowed_users;
create policy "allowed_self_select" on aespacrm.crm_allowed_users
  for select to authenticated
  using (user_id = auth.uid());

-- 2) Helper SECURITY DEFINER (evita recursão e permite usar em policies)
create or replace function aespacrm.is_allowed_user(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = aespacrm, public
as $$
  select exists (
    select 1 from aespacrm.crm_allowed_users where user_id = _uid
  )
$$;

grant execute on function aespacrm.is_allowed_user(uuid) to authenticated, anon;

-- 3) Popular a allowlist com os usuários autorizados
--    (jones@aespa.com.br — ajuste/adicione mais e-mails se necessário)
insert into aespacrm.crm_allowed_users (user_id, email)
select u.id, u.email
from auth.users u
where u.email in ('jones@aespa.com.br')
on conflict (user_id) do nothing;

-- 4) Adiciona policy "allowlist" em TODAS as tabelas aespacrm.crm_*
--    Restritiva: combina com a "own_*" via AND. Sem allowlist, sem acesso.
do $$
declare
  t text;
  tables text[] := array[
    'crm_categories',
    'crm_contacts',
    'crm_pipeline_stages',
    'crm_pipeline_placements',
    'crm_messages',
    'crm_bulk_sends',
    'crm_sequences',
    'crm_sequence_steps',
    'crm_contact_sequences',
    'crm_sequence_send_log'
  ];
begin
  foreach t in array tables loop
    -- só aplica se a tabela existir
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'aespacrm' and table_name = t
    ) then
      execute format('alter table aespacrm.%I enable row level security', t);
      execute format('drop policy if exists "allowlist_only" on aespacrm.%I', t);
      execute format($p$
        create policy "allowlist_only" on aespacrm.%I
          as restrictive
          for all to authenticated
          using (aespacrm.is_allowed_user(auth.uid()))
          with check (aespacrm.is_allowed_user(auth.uid()))
      $p$, t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- =====================================================================
-- FIM. Para autorizar um novo usuário:
--   insert into aespacrm.crm_allowed_users (user_id, email)
--   select id, email from auth.users where email = 'novo@dominio.com';
-- =====================================================================
