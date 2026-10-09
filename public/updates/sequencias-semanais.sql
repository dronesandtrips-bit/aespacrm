-- ZapCRM ONLY. No external schemas/tables are altered. Run BEFORE publishing
-- and updating the official runner. This migration DOES NOT activate recurrence.
-- Activation is a separate, explicit final step. Never expire reserved claims.
begin;

alter table aespacrm.crm_sequences
  add column if not exists recurrence_enabled boolean not null default false,
  add column if not exists recurrence_activated_at timestamptz;

create table if not exists aespacrm.crm_sequence_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence_id uuid not null references aespacrm.crm_sequences(id) on delete cascade,
  contact_sequence_id uuid not null references aespacrm.crm_contact_sequences(id) on delete cascade,
  scheduled_date date not null,
  scheduled_at timestamptz not null,
  current_step integer not null,
  next_send_at timestamptz,
  status text not null default 'active' check (status in ('active','completed','skipped','expired')),
  completed_at timestamptz,
  unique(contact_sequence_id, scheduled_date)
);
grant select on aespacrm.crm_sequence_occurrences to authenticated;
grant all on aespacrm.crm_sequence_occurrences to service_role;
alter table aespacrm.crm_sequence_occurrences enable row level security;
drop policy if exists crm_occurrences_owner_read on aespacrm.crm_sequence_occurrences;
create policy crm_occurrences_owner_read on aespacrm.crm_sequence_occurrences
  for select to authenticated using (auth.uid() = user_id);
create index if not exists crm_occurrences_due_idx on aespacrm.crm_sequence_occurrences(next_send_at) where status = 'active';

alter table aespacrm.crm_sequence_dispatches
  add column if not exists occurrence_id uuid references aespacrm.crm_sequence_occurrences(id) on delete cascade;
-- Preserve every historical claim; uniqueness for old sends remains enforced.
alter table aespacrm.crm_sequence_dispatches drop constraint if exists crm_sequence_dispatches_contact_sequence_id_step_order_key;
create unique index if not exists crm_dispatch_legacy_unique on aespacrm.crm_sequence_dispatches(contact_sequence_id, step_order) where occurrence_id is null;
create unique index if not exists crm_dispatch_occurrence_unique on aespacrm.crm_sequence_dispatches(occurrence_id, step_order) where occurrence_id is not null;
alter table aespacrm.crm_sequence_send_log
  add column if not exists occurrence_id uuid references aespacrm.crm_sequence_occurrences(id) on delete set null,
  add column if not exists dispatch_claim_id uuid references aespacrm.crm_sequence_dispatches(id) on delete set null;
create unique index if not exists crm_log_confirmed_claim_unique on aespacrm.crm_sequence_send_log(dispatch_claim_id) where status = 'sent' and dispatch_claim_id is not null;

-- A single settings row enables future creations only after explicit activation.
create table if not exists aespacrm.crm_sequence_recurrence_settings (
  id boolean primary key default true check (id),
  activated_at timestamptz
);
grant all on aespacrm.crm_sequence_recurrence_settings to service_role;
alter table aespacrm.crm_sequence_recurrence_settings enable row level security;

create or replace function aespacrm.crm_sequence_apply_recurrence_default()
returns trigger language plpgsql security definer set search_path = aespacrm, pg_temp as $$
declare v_activation timestamptz;
begin
  select activated_at into v_activation from aespacrm.crm_sequence_recurrence_settings where id = true;
  if v_activation is not null then
    new.recurrence_enabled := true;
    new.recurrence_activated_at := greatest(v_activation, now());
  end if;
  return new;
end;
$$;
drop trigger if exists crm_sequences_recurrence_default on aespacrm.crm_sequences;
create trigger crm_sequences_recurrence_default before insert on aespacrm.crm_sequences
  for each row execute function aespacrm.crm_sequence_apply_recurrence_default();

-- Keep recurring enrollments active between rounds, so ALL existing inbound,
-- pipeline and opt-out pause paths (which filter active) still apply.
create or replace function aespacrm.crm_sequence_keep_recurring_enrollment()
returns trigger language plpgsql security definer set search_path = aespacrm, pg_temp as $$
begin
  if new.status = 'completed' and exists(select 1 from aespacrm.crm_sequences s where s.id = new.sequence_id and s.recurrence_enabled) then
    new.status := 'active';
    new.next_send_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_contact_sequences_recurring_active on aespacrm.crm_contact_sequences;
create trigger crm_contact_sequences_recurring_active before insert or update of status on aespacrm.crm_contact_sequences
  for each row execute function aespacrm.crm_sequence_keep_recurring_enrollment();

-- Materialize ONLY today's eligible round, never yesterday's missed campaign.
-- The sequence lock serializes materialization, reservation and completion.
create or replace function aespacrm.crm_sequence_recurring_due(p_user_id uuid default null, p_limit integer default 50)
returns table(id uuid, user_id uuid, contact_id uuid, sequence_id uuid, current_step integer, next_send_at timestamptz, occurrence_id uuid)
language plpgsql security definer set search_path = aespacrm, pg_temp as $$
declare
  v_seq aespacrm.crm_sequences%rowtype;
  v_local timestamp := now() at time zone 'America/Sao_Paulo';
  v_start timestamptz;
  v_first integer;
begin
  for v_seq in select s.* from aespacrm.crm_sequences s
    where s.recurrence_enabled and s.is_active and s.recurrence_activated_at <= now()
      and (p_user_id is null or s.user_id = p_user_id) order by s.id for update
  loop
    -- Unstarted expired rounds are skipped, NEVER reserved/partially sent ones.
    update aespacrm.crm_sequence_occurrences o set status = 'expired', next_send_at = null
    where o.sequence_id = v_seq.id and o.status = 'active' and o.scheduled_date < v_local::date
      and not exists(select 1 from aespacrm.crm_sequence_dispatches d where d.occurrence_id = o.id);
    if extract(dow from v_local)::integer = any(v_seq.window_days)
       and extract(hour from v_local) >= v_seq.window_start_hour
       and extract(hour from v_local) < v_seq.window_end_hour then
      v_start := (v_local::date + make_interval(hours => v_seq.window_start_hour)) at time zone 'America/Sao_Paulo';
      select min(st."order") into v_first from aespacrm.crm_sequence_steps st where st.sequence_id = v_seq.id and st.user_id = v_seq.user_id;
      if v_first is not null and v_start >= v_seq.recurrence_activated_at then
        insert into aespacrm.crm_sequence_occurrences(user_id,sequence_id,contact_sequence_id,scheduled_date,scheduled_at,current_step,next_send_at)
        select cs.user_id,cs.sequence_id,cs.id,v_local::date,v_start,v_first,v_start
        from aespacrm.crm_contact_sequences cs join aespacrm.crm_contacts c on c.id = cs.contact_id and c.user_id = cs.user_id
        where cs.sequence_id = v_seq.id and cs.user_id = v_seq.user_id and cs.status in ('active','completed') and not c.is_ignored
          and cs.started_at <= v_start
        on conflict (contact_sequence_id,scheduled_date) do nothing;
      end if;
    end if;
  end loop;
  return query
    select cs.id,cs.user_id,cs.contact_id,cs.sequence_id,o.current_step,o.next_send_at,o.id
    from aespacrm.crm_sequence_occurrences o
    join aespacrm.crm_contact_sequences cs on cs.id = o.contact_sequence_id and cs.user_id = o.user_id
    join aespacrm.crm_sequences s on s.id = cs.sequence_id and s.user_id = cs.user_id
    join aespacrm.crm_contacts c on c.id = cs.contact_id and c.user_id = cs.user_id
    where o.status = 'active' and o.next_send_at <= now() and cs.status in ('active','completed')
      and s.recurrence_enabled and s.is_active and not c.is_ignored
      and (p_user_id is null or cs.user_id = p_user_id)
      and extract(dow from v_local)::integer = any(s.window_days)
      and extract(hour from v_local) >= s.window_start_hour and extract(hour from v_local) < s.window_end_hour
      and (s.next_client_at is null or s.next_client_at <= now())
      and not exists(select 1 from aespacrm.crm_sequence_dispatches d where d.sequence_id = s.id and d.status = 'reserved')
    order by o.next_send_at,o.scheduled_at,o.id limit greatest(1,least(200,p_limit));
end;
$$;

create or replace function aespacrm.crm_reserve_recurring_dispatch(p_contact_sequence_id uuid,p_step_order integer,p_occurrence_id uuid)
returns jsonb language plpgsql security definer set search_path = aespacrm, pg_temp as $$
declare
  v_seq aespacrm.crm_sequences%rowtype;
  v_cs aespacrm.crm_contact_sequences%rowtype;
  v_round aespacrm.crm_sequence_occurrences%rowtype;
  v_local timestamp := now() at time zone 'America/Sao_Paulo';
  v_id uuid;
begin
  select * into v_cs from aespacrm.crm_contact_sequences where id = p_contact_sequence_id;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  select * into v_seq from aespacrm.crm_sequences where id = v_cs.sequence_id for update;
  select * into v_cs from aespacrm.crm_contact_sequences where id = p_contact_sequence_id for update;
  if not v_seq.is_active or not v_seq.recurrence_enabled or v_seq.user_id <> v_cs.user_id then
    return jsonb_build_object('ok',false,'reason','inactive'); end if;
  if v_cs.status not in ('active','completed') or not exists(select 1 from aespacrm.crm_contacts c where c.id = v_cs.contact_id and c.user_id = v_cs.user_id and not c.is_ignored) then
    return jsonb_build_object('ok',false,'reason','contact_blocked'); end if;
  if not (extract(dow from v_local)::integer = any(v_seq.window_days)) or extract(hour from v_local) < v_seq.window_start_hour or extract(hour from v_local) >= v_seq.window_end_hour then
    return jsonb_build_object('ok',false,'reason','outside_window'); end if;
  select * into v_round from aespacrm.crm_sequence_occurrences where id = p_occurrence_id for update;
  if not found or v_round.contact_sequence_id <> v_cs.id or v_round.sequence_id <> v_seq.id or v_round.user_id <> v_cs.user_id
    or v_round.status <> 'active' or v_round.current_step <> p_step_order or v_round.next_send_at is null or v_round.next_send_at > now() then
    return jsonb_build_object('ok',false,'reason','not_due'); end if;
  if v_round.scheduled_date < v_local::date and not exists(select 1 from aespacrm.crm_sequence_dispatches where occurrence_id = v_round.id) then
    return jsonb_build_object('ok',false,'reason','expired_round'); end if;
  if v_seq.next_client_at > now() then return jsonb_build_object('ok',false,'reason','interval'); end if;
  if exists(select 1 from aespacrm.crm_sequence_dispatches where sequence_id = v_seq.id and status = 'reserved') then
    return jsonb_build_object('ok',false,'reason','pending_confirmation'); end if;
  if exists(select 1 from aespacrm.crm_sequence_dispatches where occurrence_id = v_round.id and step_order = p_step_order) then
    return jsonb_build_object('ok',false,'reason','already_attempted'); end if;
  if not exists(select 1 from aespacrm.crm_sequence_steps where sequence_id = v_seq.id and user_id = v_cs.user_id and "order" = p_step_order) then
    return jsonb_build_object('ok',false,'reason','step_missing'); end if;
  insert into aespacrm.crm_sequence_dispatches(user_id,sequence_id,contact_sequence_id,step_order,occurrence_id)
  values(v_cs.user_id,v_seq.id,v_cs.id,p_step_order,v_round.id) returning id into v_id;
  return jsonb_build_object('ok',true,'claim_id',v_id,'occurrence_id',v_round.id);
end;
$$;

-- Confirmed send: log and round progress COMMIT TOGETHER. Retries of this
-- notification return the old result, never advance another round/step.
create or replace function aespacrm.crm_record_recurring_send(p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = aespacrm, pg_temp as $$
declare
  v_claim aespacrm.crm_sequence_dispatches%rowtype;
  v_round aespacrm.crm_sequence_occurrences%rowtype;
  v_next aespacrm.crm_sequence_steps%rowtype;
  v_message text;
begin
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id;
  if not found or v_claim.occurrence_id is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  perform 1 from aespacrm.crm_sequences where id = v_claim.sequence_id for update;
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id for update;
  if exists(select 1 from aespacrm.crm_sequence_send_log where dispatch_claim_id = p_claim_id and status = 'sent') then
    return jsonb_build_object('ok',true,'already_recorded',true); end if;
  if v_claim.status <> 'reserved' then return jsonb_build_object('ok',false,'reason','claim_handled'); end if;
  select * into v_round from aespacrm.crm_sequence_occurrences where id = v_claim.occurrence_id for update;
  if v_round.current_step <> v_claim.step_order or v_round.status <> 'active' then
    return jsonb_build_object('ok',false,'reason','round_changed'); end if;
  select message into v_message from aespacrm.crm_sequence_steps where sequence_id = v_claim.sequence_id and "order" = v_claim.step_order;
  insert into aespacrm.crm_sequence_send_log(user_id,contact_sequence_id,step_order,message,status,occurrence_id,dispatch_claim_id)
    values(v_claim.user_id,v_claim.contact_sequence_id,v_claim.step_order,coalesce(v_message,''),'sent',v_round.id,p_claim_id);
  select * into v_next from aespacrm.crm_sequence_steps where sequence_id = v_claim.sequence_id and user_id = v_claim.user_id and "order" > v_claim.step_order order by "order" limit 1;
  if not found then
    update aespacrm.crm_sequence_occurrences set status = 'completed',next_send_at = null,completed_at = now() where id = v_round.id;
    return jsonb_build_object('ok',true,'completed',true,'occurrence_id',v_round.id);
  end if;
  update aespacrm.crm_sequence_occurrences set current_step = v_next."order",
    next_send_at = now() + make_interval(secs => v_next.delay_value * case when v_next.delay_unit = 'hours' then 3600 else 86400 end)
    where id = v_round.id;
  return jsonb_build_object('ok',true,'next_step',v_next."order",'occurrence_id',v_round.id);
end;
$$;

create or replace function aespacrm.crm_acknowledge_recurring_dispatch(p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = aespacrm, pg_temp as $$
declare v_claim aespacrm.crm_sequence_dispatches%rowtype; v_seq aespacrm.crm_sequences%rowtype;
begin
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if v_claim.occurrence_id is null then return aespacrm.crm_acknowledge_sequence_dispatch(p_claim_id); end if;
  select * into v_seq from aespacrm.crm_sequences where id = v_claim.sequence_id for update;
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id for update;
  if v_claim.status = 'acknowledged' then return jsonb_build_object('ok',true,'already_acknowledged',true); end if;
  if not exists(select 1 from aespacrm.crm_sequence_send_log where dispatch_claim_id = p_claim_id and occurrence_id = v_claim.occurrence_id and status = 'sent' and sent_at >= v_claim.reserved_at) then
    return jsonb_build_object('ok',false,'reason','send_not_recorded'); end if;
  update aespacrm.crm_sequence_dispatches set status = 'acknowledged',acknowledged_at = now() where id = p_claim_id;
  update aespacrm.crm_sequences set next_client_at = now() + make_interval(secs => greatest(60,least(300,coalesce(v_seq.client_interval_seconds,60)))) where id = v_seq.id;
  return jsonb_build_object('ok',true,'interval_seconds',greatest(60,least(300,coalesce(v_seq.client_interval_seconds,60))));
end;
$$;

create or replace function aespacrm.crm_reject_invalid_recurring_dispatch(p_claim_id uuid,p_error text)
returns jsonb language plpgsql security definer set search_path = aespacrm, pg_temp as $$
declare v_claim aespacrm.crm_sequence_dispatches%rowtype; v_seq aespacrm.crm_sequences%rowtype; v_message text;
begin
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if v_claim.occurrence_id is null then return aespacrm.crm_reject_invalid_sequence_dispatch(p_claim_id,p_error); end if;
  select * into v_seq from aespacrm.crm_sequences where id = v_claim.sequence_id for update;
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id for update;
  if v_claim.status = 'acknowledged' then return jsonb_build_object('ok',true,'already_handled',true); end if;
  select message into v_message from aespacrm.crm_sequence_steps where sequence_id = v_claim.sequence_id and "order" = v_claim.step_order;
  insert into aespacrm.crm_sequence_send_log(user_id,contact_sequence_id,step_order,message,status,error,occurrence_id,dispatch_claim_id)
    values(v_claim.user_id,v_claim.contact_sequence_id,v_claim.step_order,coalesce(v_message,''),'failed',left(coalesce(p_error,'Número inexistente no WhatsApp'),500),v_claim.occurrence_id,p_claim_id);
  update aespacrm.crm_contact_sequences set status = 'paused',paused_at = now(),pause_reason = 'invalid_whatsapp_number',next_send_at = null where id = v_claim.contact_sequence_id and user_id = v_claim.user_id;
  update aespacrm.crm_sequence_occurrences set status = 'skipped',next_send_at = null where contact_sequence_id = v_claim.contact_sequence_id and status = 'active';
  update aespacrm.crm_sequence_dispatches set status = 'acknowledged',acknowledged_at = now() where id = p_claim_id;
  update aespacrm.crm_sequences set next_client_at = now() + make_interval(secs => greatest(60,least(300,coalesce(v_seq.client_interval_seconds,60)))) where id = v_seq.id;
  return jsonb_build_object('ok',true,'interval_seconds',greatest(60,least(300,coalesce(v_seq.client_interval_seconds,60))));
end;
$$;

revoke all on function aespacrm.crm_sequence_apply_recurrence_default() from public,anon,authenticated;
revoke all on function aespacrm.crm_sequence_keep_recurring_enrollment() from public,anon,authenticated;
revoke all on function aespacrm.crm_sequence_recurring_due(uuid,integer) from public,anon,authenticated;
revoke all on function aespacrm.crm_reserve_recurring_dispatch(uuid,integer,uuid) from public,anon,authenticated;
revoke all on function aespacrm.crm_record_recurring_send(uuid) from public,anon,authenticated;
revoke all on function aespacrm.crm_acknowledge_recurring_dispatch(uuid) from public,anon,authenticated;
revoke all on function aespacrm.crm_reject_invalid_recurring_dispatch(uuid,text) from public,anon,authenticated;
grant execute on function aespacrm.crm_sequence_recurring_due(uuid,integer) to service_role;
grant execute on function aespacrm.crm_reserve_recurring_dispatch(uuid,integer,uuid) to service_role;
grant execute on function aespacrm.crm_record_recurring_send(uuid) to service_role;
grant execute on function aespacrm.crm_acknowledge_recurring_dispatch(uuid) to service_role;
grant execute on function aespacrm.crm_reject_invalid_recurring_dispatch(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;