-- Synthetic database only. Run after schema/migrations; never run on the VPS.
insert into auth.users values ('10000000-0000-4000-8000-000000000001');
insert into aespacrm.crm_contacts(id,user_id,name,is_ignored)
select ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001','Synthetic '||i,i=4 from generate_series(1,4) i;
insert into aespacrm.crm_sequences(id,user_id,name,window_days,window_start_hour,window_end_hour,recurrence_enabled,recurrence_activated_at)
values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic weekly',array[0,1,2,3,4,5,6],0,23,true,now()-interval '2 days');
insert into aespacrm.crm_sequence_steps(sequence_id,user_id,"order",message,delay_value,delay_unit)
values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',0,'First',0,'hours'),
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'Second',48,'hours');
insert into aespacrm.crm_contact_sequences(id,user_id,contact_id,sequence_id,status,started_at)
select ('40000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001',('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'30000000-0000-4000-8000-000000000001',case when i=3 then 'paused' else 'active' end,now()-interval '3 days' from generate_series(1,4) i;
do $$
declare r record; claim jsonb; other record; res jsonb; before_count integer;
begin
  select * into r from aespacrm.crm_sequence_recurring_due(null,50) order by id limit 1;
  if r.id is null then raise exception 'No due round'; end if;
  if (select count(*) from aespacrm.crm_sequence_occurrences) <> 2 then raise exception 'Paused/ignored filter failed'; end if;
  perform * from aespacrm.crm_sequence_recurring_due(null,50);
  if (select count(*) from aespacrm.crm_sequence_occurrences) <> 2 then raise exception 'Duplicate materialization'; end if;
  claim := aespacrm.crm_reserve_recurring_dispatch(r.id,r.current_step,r.occurrence_id);
  if not (claim->>'ok')::boolean then raise exception 'Reservation failed: %',claim; end if;
  res := aespacrm.crm_acknowledge_recurring_dispatch((claim->>'claim_id')::uuid);
  if res->>'reason' <> 'send_not_recorded' then raise exception 'Ambiguous claim released'; end if;
  select * into other from aespacrm.crm_sequence_occurrences where id <> r.occurrence_id limit 1;
  res := aespacrm.crm_reserve_recurring_dispatch(other.contact_sequence_id,0,other.id);
  if res->>'reason' <> 'pending_confirmation' then raise exception 'Sequence reservation serialization failed'; end if;
  res := aespacrm.crm_record_recurring_send((claim->>'claim_id')::uuid);
  if not (res->>'ok')::boolean then raise exception 'Atomic record failed: %',res; end if;
  perform aespacrm.crm_record_recurring_send((claim->>'claim_id')::uuid);
  if (select count(*) from aespacrm.crm_sequence_send_log where dispatch_claim_id=(claim->>'claim_id')::uuid) <> 1 then raise exception 'Duplicate send log'; end if;
  if (select current_step from aespacrm.crm_sequence_occurrences where id=r.occurrence_id) <> 1 then raise exception 'Step progression'; end if;
  if (select next_send_at from aespacrm.crm_sequence_occurrences where id=r.occurrence_id) < now()+interval '47 hours' then raise exception 'Delay lost'; end if;
  res := aespacrm.crm_acknowledge_recurring_dispatch((claim->>'claim_id')::uuid);
  if not (res->>'ok')::boolean then raise exception 'Acknowledge failed'; end if;
  res := aespacrm.crm_reserve_recurring_dispatch(other.contact_sequence_id,0,other.id);
  if res->>'reason' <> 'interval' then raise exception 'Recipient interval ignored'; end if;
  update aespacrm.crm_sequences set next_client_at=now()-interval '1 second';
  claim := aespacrm.crm_reserve_recurring_dispatch(other.contact_sequence_id,0,other.id);
  res := aespacrm.crm_reject_invalid_recurring_dispatch((claim->>'claim_id')::uuid,'Synthetic invalid number');
  if not (res->>'ok')::boolean then raise exception 'Invalid skip failed'; end if;
  if (select status from aespacrm.crm_contact_sequences where id=other.contact_sequence_id) <> 'paused' then raise exception 'Invalid contact not paused'; end if;
  if exists(select 1 from aespacrm.crm_sequence_dispatches where status='reserved') then raise exception 'Invalid contact froze sequence'; end if;
  -- A started previous round and today coexist without overwriting progress.
  update aespacrm.crm_sequence_occurrences set scheduled_date=scheduled_date-1,scheduled_at=scheduled_at-interval '1 day' where id=r.occurrence_id;
  update aespacrm.crm_sequences set next_client_at=now()-interval '1 second';
  perform * from aespacrm.crm_sequence_recurring_due(null,50);
  if (select count(*) from aespacrm.crm_sequence_occurrences where contact_sequence_id=r.id and status='active') <> 2 then raise exception 'Overlapping round lost'; end if;
  if (select current_step from aespacrm.crm_sequence_occurrences where id=r.occurrence_id) <> 1 then raise exception 'Previous round overwritten'; end if;
  -- Pausing the sequence prevents all further reservations.
  update aespacrm.crm_sequences set is_active=false;
  select * into other from aespacrm.crm_sequence_occurrences where contact_sequence_id=r.id and current_step=0;
  res := aespacrm.crm_reserve_recurring_dispatch(r.id,0,other.id);
  if res->>'reason' <> 'inactive' then raise exception 'Sequence pause ignored'; end if;
  update aespacrm.crm_sequences set is_active=true;
  update aespacrm.crm_contact_sequences set status='paused' where id=r.id;
  res := aespacrm.crm_reserve_recurring_dispatch(r.id,0,other.id);
  if res->>'reason' <> 'contact_blocked' then raise exception 'Manual pause ignored'; end if;
  -- Completed enrollments remain active for existing inbound pause paths.
  update aespacrm.crm_contact_sequences set status='completed' where id=r.id;
  if (select status from aespacrm.crm_contact_sequences where id=r.id) <> 'active' then raise exception 'Recurring membership lost'; end if;
  -- Historical unstarted rounds expire instead of replaying after downtime.
  update aespacrm.crm_sequence_occurrences set scheduled_date=scheduled_date-7 where id=other.id;
  perform * from aespacrm.crm_sequence_recurring_due(null,50);
  if (select status from aespacrm.crm_sequence_occurrences where id=other.id) <> 'expired' then raise exception 'Historical replay'; end if;
  raise notice 'PASS materialization, ignored/paused, concurrency guard, ambiguous retention, atomic confirmation, delays, interval, invalid skip, independent rounds, pause, historical expiry';
end;
$$;
