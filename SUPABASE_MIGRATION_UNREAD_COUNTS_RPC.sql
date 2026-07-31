-- ============================================================
-- Performance do Inbox (WhatsApp Web): contagem de NÃO LIDAS no banco
-- ------------------------------------------------------------
-- Hoje o navegador baixa até 2.000 mensagens só para contar não lidas.
-- Esta função devolve apenas 1 linha por contato (contact_id, unread,
-- last_read_at), calculada dentro do Postgres.
--
-- Aditivo e seguro: não altera tabelas, não remove nada.
-- O app tem fallback — se a função não existir, continua contando no cliente.
-- ============================================================

create index if not exists idx_crm_messages_contact_at
  on aespacrm.crm_messages (contact_id, at desc);

create index if not exists idx_crm_messages_at
  on aespacrm.crm_messages (at desc);

create or replace function aespacrm.crm_unread_counts()
returns table (contact_id uuid, unread bigint, last_read_at timestamptz)
language sql
stable
security invoker
set search_path = aespacrm, public
as $$
  select
    ct.id as contact_id,
    coalesce(count(m.id) filter (
      where m.from_me = false
        and (ct.last_read_at is null or m.at > ct.last_read_at)
    ), 0) as unread,
    ct.last_read_at
  from aespacrm.crm_contacts ct
  left join aespacrm.crm_messages m on m.contact_id = ct.id
  where ct.user_id = auth.uid()
  group by ct.id, ct.last_read_at
$$;

grant execute on function aespacrm.crm_unread_counts() to authenticated;
