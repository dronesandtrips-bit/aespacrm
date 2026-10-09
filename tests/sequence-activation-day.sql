-- Synthetic database only; run after the weekly regression suite.
begin;
do $$
declare
  v_local timestamp := now() at time zone 'America/Sao_Paulo';
  v_open timestamptz;
  v_activation timestamptz := now() - interval '1 second';
  v_sequence uuid := '30000000-0000-4000-8000-000000000002';
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_count integer;
begin
  v_open := (v_local::date + interval '0 hours') at time zone 'America/Sao_Paulo';
  insert into aespacrm.crm_sequences(id,user_id,name,window_days,window_start_hour,window_end_hour,recurrence_enabled,recurrence_activated_at)
  values(v_sequence,v_owner,'Activation day',array[extract(dow from v_local)::integer],0,24,true,v_activation);
  insert into aespacrm.crm_sequence_steps(sequence_id,user_id,"order",message,delay_value,delay_unit)
  values(v_sequence,v_owner,0,'Synthetic activation',0,'hours');
  insert into aespacrm.crm_contact_sequences(id,user_id,contact_id,sequence_id,status,started_at)
  select ('50000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,v_owner,
    ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,v_sequence,
    case when i=3 then 'paused' else 'active' end,
    case when i=2 then v_open+interval '1 second' else v_open-interval '1 day' end
  from generate_series(1,4) i;
  perform * from aespacrm.crm_sequence_recurring_due(null,200);
  select count(*) into v_count from aespacrm.crm_sequence_occurrences where sequence_id=v_sequence;
  if v_count <> 1 then raise exception 'Activation-day eligibility/cutoff failed: %',v_count; end if;
  if exists(select 1 from aespacrm.crm_sequence_occurrences where sequence_id=v_sequence
    and (scheduled_date<>v_local::date or scheduled_at<v_activation or next_send_at<v_activation)) then
    raise exception 'Activation-day timestamp or historical replay';
  end if;
  perform * from aespacrm.crm_sequence_recurring_due(null,200);
  if (select count(*) from aespacrm.crm_sequence_occurrences where sequence_id=v_sequence) <> 1 then
    raise exception 'Repeated activation-day materialization';
  end if;
  delete from aespacrm.crm_sequence_occurrences where sequence_id=v_sequence;
  update aespacrm.crm_sequences set recurrence_activated_at=now()+interval '1 hour' where id=v_sequence;
  perform * from aespacrm.crm_sequence_recurring_due(null,200);
  if exists(select 1 from aespacrm.crm_sequence_occurrences where sequence_id=v_sequence) then
    raise exception 'Future activation materialized';
  end if;
  update aespacrm.crm_sequences set recurrence_activated_at=v_activation,window_end_hour=0 where id=v_sequence;
  perform * from aespacrm.crm_sequence_recurring_due(null,200);
  if exists(select 1 from aespacrm.crm_sequence_occurrences where sequence_id=v_sequence) then
    raise exception 'Outside-window materialization';
  end if;
  raise notice 'PASS activation day, timestamp floor, no replay, enrollment cutoff, paused/ignored, deduplication, future activation, closed window';
end;
$$;
rollback;