-- ZapCRM: correction of activation-day rounds only. Does not change data.
-- Apply in the same SQL editor; active runner may send real messages afterwards.
begin;
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
      -- Allow activation during today's window, without creating earlier dates.
      if v_first is not null and (v_seq.recurrence_activated_at at time zone 'America/Sao_Paulo')::date <= v_local::date then
        insert into aespacrm.crm_sequence_occurrences(user_id,sequence_id,contact_sequence_id,scheduled_date,scheduled_at,current_step,next_send_at)
        select cs.user_id,cs.sequence_id,cs.id,v_local::date,greatest(v_start,v_seq.recurrence_activated_at),v_first,greatest(v_start,v_seq.recurrence_activated_at)
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

revoke all on function aespacrm.crm_sequence_recurring_due(uuid,integer) from public,anon,authenticated;
grant execute on function aespacrm.crm_sequence_recurring_due(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
