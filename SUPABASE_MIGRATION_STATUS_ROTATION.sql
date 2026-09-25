-- =====================================================================
-- ZapCRM — Biblioteca e rodízio automático do Status do WhatsApp
-- Isolado no schema aespacrm e em tabelas crm_*.
-- Idempotente: pode ser executado novamente.
-- =====================================================================

create table if not exists aespacrm.crm_status_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  interval_minutes integer not null default 180 check (interval_minutes between 60 and 10080),
  last_published_at timestamptz,
  last_error text,
  processing_started_at timestamptz,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on aespacrm.crm_status_settings to authenticated;
grant all on aespacrm.crm_status_settings to service_role;
alter table aespacrm.crm_status_settings enable row level security;

drop policy if exists "own_status_settings" on aespacrm.crm_status_settings;
create policy "own_status_settings" on aespacrm.crm_status_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists aespacrm.crm_status_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('text','image','video','audio')),
  content text,
  storage_path text,
  mime_type text,
  file_name text,
  caption text,
  background_color text not null default '#075E54',
  font integer not null default 1 check (font between 0 and 5),
  position integer not null default 0,
  is_active boolean not null default true,
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (type = 'text' and content is not null and storage_path is null)
    or (type <> 'text' and storage_path is not null)
  )
);

grant select, insert, update, delete on aespacrm.crm_status_media to authenticated;
grant all on aespacrm.crm_status_media to service_role;
alter table aespacrm.crm_status_media enable row level security;

drop policy if exists "own_status_media" on aespacrm.crm_status_media;
create policy "own_status_media" on aespacrm.crm_status_media
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists crm_status_media_rotation_idx
  on aespacrm.crm_status_media(user_id, is_active, last_used_at, position);

create table if not exists aespacrm.crm_status_publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id uuid references aespacrm.crm_status_media(id) on delete set null,
  status text not null check (status in ('accepted','failed')),
  provider_message_id text,
  error text,
  provider_response jsonb,
  created_at timestamptz not null default now()
);

grant select on aespacrm.crm_status_publications to authenticated;
grant all on aespacrm.crm_status_publications to service_role;
alter table aespacrm.crm_status_publications enable row level security;

drop policy if exists "own_status_publications" on aespacrm.crm_status_publications;
create policy "own_status_publications" on aespacrm.crm_status_publications
  for select to authenticated
  using (user_id = auth.uid());

create index if not exists crm_status_publications_user_created_idx
  on aespacrm.crm_status_publications(user_id, created_at desc);

notify pgrst, 'reload schema';
