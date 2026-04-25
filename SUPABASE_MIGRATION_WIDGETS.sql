-- =====================================================================
-- ZapCRM — Widgets de Captura (Phase Widgets)
-- Rode este SQL no SQL Editor do seu Supabase self-hosted (uma vez).
-- =====================================================================

create table if not exists aespacrm.crm_capture_widgets (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  category_id  uuid        references aespacrm.crm_categories(id) on delete set null,
  stage_id     uuid        references aespacrm.crm_pipeline_stages(id) on delete set null,
  -- Visual / textos do form
  title        text        not null default 'Fale com a gente',
  subtitle     text                 default 'Preencha e retornaremos em breve.',
  button_text  text        not null default 'Enviar',
  primary_color text       not null default '#10B981',
  success_message text     not null default 'Recebemos sua mensagem! Entraremos em contato em breve.',
  -- Origem opcional (rótulo no contato)
  source_tag   text                 default 'site',
  is_active    boolean     not null default true,
  submissions_count int    not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_crm_widgets_user on aespacrm.crm_capture_widgets(user_id);

-- RLS
alter table aespacrm.crm_capture_widgets enable row level security;

drop policy if exists "own_select" on aespacrm.crm_capture_widgets;
drop policy if exists "own_insert" on aespacrm.crm_capture_widgets;
drop policy if exists "own_update" on aespacrm.crm_capture_widgets;
drop policy if exists "own_delete" on aespacrm.crm_capture_widgets;

create policy "own_select" on aespacrm.crm_capture_widgets
  for select to authenticated using (user_id = auth.uid());
create policy "own_insert" on aespacrm.crm_capture_widgets
  for insert to authenticated with check (user_id = auth.uid());
create policy "own_update" on aespacrm.crm_capture_widgets
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own_delete" on aespacrm.crm_capture_widgets
  for delete to authenticated using (user_id = auth.uid());

-- Acesso público (anon) APENAS LEITURA do form (título/cor) via service role no backend.
-- O endpoint /api/public/widget/* usa service role e filtra por id, então NÃO precisamos
-- expor a tabela ao anon role aqui.

grant select, insert, update, delete on aespacrm.crm_capture_widgets to authenticated;

-- =====================================================================
-- FIM
-- =====================================================================
