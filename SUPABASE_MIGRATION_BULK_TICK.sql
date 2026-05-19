-- ============================================================
-- ZapCRM — Fix disparos longos (batch per tick)
-- Roda no Supabase self-hosted (schema aespacrm).
--
-- Adiciona cursor de retomada e claim para o cron reciclar
-- disparos travados em 'in_progress' (Worker morre em ~30s).
-- ============================================================

set search_path = aespacrm, public;

alter table aespacrm.crm_bulk_sends
  add column if not exists next_index integer not null default 0,
  add column if not exists claimed_at timestamptz;

-- Cron procura também in_progress órfãos (sem heartbeat há > 90s).
create index if not exists crm_bulk_sends_inprogress_claimed_idx
  on aespacrm.crm_bulk_sends (status, claimed_at)
  where status = 'in_progress';

-- IMPORTANTE: após rodar este SQL, reinicie o PostgREST no VPS:
--   docker service update --force supabase_supabase_rest
