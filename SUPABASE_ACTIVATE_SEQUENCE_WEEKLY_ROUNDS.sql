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
notify pgrst,'reload schema';
commit;