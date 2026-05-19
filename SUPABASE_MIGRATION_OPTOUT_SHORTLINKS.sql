-- Aditivo: tabela de shortlinks para descadastro.
-- Permite URLs curtas como /d/Ab3xK9pQ em vez de /u/<token-hmac-longo>.
-- INTEGRIDADE: nada existente é alterado.

set search_path = aespacrm;

create table if not exists crm_optout_shortlinks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    phone_norm text not null,
    code text not null unique,
    created_at timestamptz not null default now(),
    expires_at timestamptz,
    constraint crm_optout_shortlinks_user_phone unique (user_id, phone_norm)
);

-- Índice rápido para lookup pelo code.
create index if not exists idx_optout_shortlinks_code
    on crm_optout_shortlinks(code);

-- Política permissiva para select (a rota pública precisa ler).
alter table crm_optout_shortlinks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'crm_optout_shortlinks'
      and policyname = 'Public can read shortlinks'
  ) then
    create policy "Public can read shortlinks"
      on crm_optout_shortlinks
      for select to anon, authenticated
      using (true);
  end if;
end $$;

notify pgrst, 'reload schema';
