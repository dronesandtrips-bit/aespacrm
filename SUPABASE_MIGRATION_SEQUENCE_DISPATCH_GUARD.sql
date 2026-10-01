-- ZapCRM only. Apply in the self-hosted Supabase SQL editor before updating
-- the official [ZapCRM] Sequences Runner. Do not run on public or other schemas.
-- A reservation is deliberately never expired automatically: after an unknown
-- WhatsApp outcome a human must investigate before another send can occur.

alter table aespacrm.crm_sequences
  add column if not exists next_client_at timestamptz;

create table if not exists aespacrm.crm_sequence_dispatches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence_id uuid not null references aespacrm.crm_sequences(id) on delete cascade,
  contact_sequence_id uuid not null references aespacrm.crm_contact_sequences(id) on delete cascade,
  step_order integer not null,
  status text not null default 'reserved' check (status in ('reserved', 'acknowledged')),
  reserved_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (contact_sequence_id, step_order)
);

grant select, insert, update on aespacrm.crm_sequence_dispatches to service_role;
alter table aespacrm.crm_sequence_dispatches enable row level security;

create index if not exists crm_sequence_dispatches_pending_idx
  on aespacrm.crm_sequence_dispatches(sequence_id)
  where status = 'reserved';

create or replace function aespacrm.crm_reserve_sequence_dispatch(p_contact_sequence_id uuid, p_step_order integer)
returns jsonb
language plpgsql security definer set search_path = aespacrm, pg_temp
as $$
declare
  v_cs aespacrm.crm_contact_sequences%rowtype;
  v_seq aespacrm.crm_sequences%rowtype;
  v_id uuid;
begin
  select * into v_cs from aespacrm.crm_contact_sequences where id = p_contact_sequence_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- Serialize claims for a sequence across concurrent n8n executions.
  select * into v_seq from aespacrm.crm_sequences where id = v_cs.sequence_id for update;
  if not found or not v_seq.is_active then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;
  if v_cs.status <> 'active' or v_cs.current_step <> p_step_order
     or v_cs.next_send_at is null or v_cs.next_send_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'not_due');
  end if;
  if v_seq.next_client_at is not null and v_seq.next_client_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'interval');
  end if;
  if exists (select 1 from aespacrm.crm_sequence_dispatches
             where sequence_id = v_cs.sequence_id and status = 'reserved') then
    return jsonb_build_object('ok', false, 'reason', 'pending_confirmation');
  end if;
  if exists (select 1 from aespacrm.crm_sequence_dispatches
             where contact_sequence_id = v_cs.id and step_order = p_step_order) then
    return jsonb_build_object('ok', false, 'reason', 'already_attempted');
  end if;

  insert into aespacrm.crm_sequence_dispatches(user_id, sequence_id, contact_sequence_id, step_order)
  values(v_cs.user_id, v_cs.sequence_id, v_cs.id, p_step_order) returning id into v_id;
  return jsonb_build_object('ok', true, 'claim_id', v_id);
end;
$$;

create or replace function aespacrm.crm_acknowledge_sequence_dispatch(p_claim_id uuid)
returns jsonb
language plpgsql security definer set search_path = aespacrm, pg_temp
as $$
declare
  v_claim aespacrm.crm_sequence_dispatches%rowtype;
  v_seq aespacrm.crm_sequences%rowtype;
begin
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_seq from aespacrm.crm_sequences where id = v_claim.sequence_id for update;
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id for update;
  if v_claim.status = 'acknowledged' then return jsonb_build_object('ok', true, 'already_acknowledged', true); end if;

  -- Never release a claim merely because an HTTP request returned: the
  -- sequence advancement must already have been recorded after a confirmed send.
  if not exists (
    select 1 from aespacrm.crm_sequence_send_log
    where contact_sequence_id = v_claim.contact_sequence_id
      and step_order = v_claim.step_order and status = 'sent'
      and sent_at >= v_claim.reserved_at
  ) then
    return jsonb_build_object('ok', false, 'reason', 'send_not_recorded');
  end if;

  update aespacrm.crm_sequence_dispatches set status = 'acknowledged', acknowledged_at = now()
  where id = p_claim_id;
  update aespacrm.crm_sequences
  set next_client_at = now() + make_interval(secs => greatest(60, least(300, v_seq.client_interval_seconds)))
  where id = v_seq.id;
  return jsonb_build_object('ok', true, 'interval_seconds', v_seq.client_interval_seconds);
end;
$$;

revoke all on function aespacrm.crm_reserve_sequence_dispatch(uuid, integer) from public, anon, authenticated;
revoke all on function aespacrm.crm_acknowledge_sequence_dispatch(uuid) from public, anon, authenticated;
grant execute on function aespacrm.crm_reserve_sequence_dispatch(uuid, integer) to service_role;
grant execute on function aespacrm.crm_acknowledge_sequence_dispatch(uuid) to service_role;