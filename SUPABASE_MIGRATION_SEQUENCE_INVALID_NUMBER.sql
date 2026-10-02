-- Only ZapCRM. Apply in the self-hosted SQL editor before enabling the
-- invalid-number branch in the official [ZapCRM] Sequences Runner.
-- A definitive Evolution 400 with exists:false is the ONLY skippable failure.
-- This transaction retains the claim until the failed log and paused contact
-- have both been committed; ambiguous results remain reserved for review.
create or replace function aespacrm.crm_reject_invalid_sequence_dispatch(
  p_claim_id uuid, p_error text
)
returns jsonb
language plpgsql security definer set search_path = aespacrm, pg_temp
as $$
declare
  v_claim aespacrm.crm_sequence_dispatches%rowtype;
  v_seq aespacrm.crm_sequences%rowtype;
  v_cs aespacrm.crm_contact_sequences%rowtype;
  v_message text;
begin
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_seq from aespacrm.crm_sequences where id = v_claim.sequence_id for update;
  select * into v_claim from aespacrm.crm_sequence_dispatches where id = p_claim_id for update;
  if v_claim.status = 'acknowledged' then
    return jsonb_build_object('ok', false, 'reason', 'already_handled');
  end if;
  select * into v_cs from aespacrm.crm_contact_sequences where id = v_claim.contact_sequence_id for update;
  if not found or v_cs.user_id <> v_claim.user_id or v_cs.sequence_id <> v_claim.sequence_id
     or v_cs.status <> 'active' or v_cs.current_step <> v_claim.step_order then
    return jsonb_build_object('ok', false, 'reason', 'contact_changed');
  end if;
  select message into v_message from aespacrm.crm_sequence_steps
  where sequence_id = v_claim.sequence_id and "order" = v_claim.step_order;

  insert into aespacrm.crm_sequence_send_log
    (user_id, contact_sequence_id, step_order, message, status, error)
  values (v_claim.user_id, v_claim.contact_sequence_id, v_claim.step_order,
          coalesce(v_message, ''), 'failed', left(coalesce(p_error, 'Número não existe no WhatsApp'), 500));
  update aespacrm.crm_contact_sequences
  set status = 'paused', paused_at = now(), pause_reason = 'invalid_whatsapp_number', next_send_at = null
  where id = v_cs.id;
  update aespacrm.crm_sequence_dispatches
  set status = 'acknowledged', acknowledged_at = now()
  where id = p_claim_id;
  update aespacrm.crm_sequences
  set next_client_at = now() + make_interval(secs => greatest(60, least(300, coalesce(v_seq.client_interval_seconds, 60))))
  where id = v_seq.id;
  return jsonb_build_object('ok', true, 'interval_seconds', greatest(60, least(300, coalesce(v_seq.client_interval_seconds, 60))));
end;
$$;

revoke all on function aespacrm.crm_reject_invalid_sequence_dispatch(uuid, text) from public, anon, authenticated;
grant execute on function aespacrm.crm_reject_invalid_sequence_dispatch(uuid, text) to service_role;