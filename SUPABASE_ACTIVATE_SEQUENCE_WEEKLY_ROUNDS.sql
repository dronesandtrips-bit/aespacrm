-- FINAL STEP ONLY: official runner paused, migration applied, CRM published,
-- runner recurring=1 + occurrence_id + claim_id payloads VERIFIED.
-- Resume ONLY that runner afterwards. No real test sends. No historical replay.
begin;
do $$
begin
  if exists(select 1 from aespacrm.crm_sequence_dispatches where status = 'reserved') then
    raise exception 'Há envios sem confirmação. Investigue-os antes de ativar; não apague reservas.';
  end if;
  if to_regprocedure('aespacrm.crm_record_recurring_send(uuid)') is null then
    raise exception 'A migração de rodadas ainda não foi aplicada.';
  end if;
end;
$$;
insert into aespacrm.crm_sequence_recurrence_settings(id,activated_at)
values(true,now()) on conflict(id) do nothing;
-- Rerunning activation must not move the boundary or replay completed rounds.
update aespacrm.crm_sequences
set recurrence_enabled = true,
    recurrence_activated_at = coalesce(recurrence_activated_at,now())
where not recurrence_enabled;
-- Existing pause paths filter active; completed means only a past round ended.
-- Restore membership WITHOUT clearing any manual/inbound/invalid pause.
update aespacrm.crm_contact_sequences cs
set status = 'active',next_send_at = null
from aespacrm.crm_sequences s
where s.id = cs.sequence_id and s.user_id = cs.user_id and s.recurrence_enabled and cs.status = 'completed';
notify pgrst,'reload schema';
commit;