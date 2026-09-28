# Catálogo estático do checkout

**[C]** Extraído de arquivos locais em 28/09/2026; **não comprova objetos presentes na VPS**. `CREATE TABLE IF NOT EXISTS` pode coexistir com alterações anteriores/não versionadas. Definições de colunas abaixo são *iniciais*: alterações posteriores devem ser somadas, e `pg_catalog` é a fonte da estrutura atual.

## Tabelas declaradas (colunas iniciais, sem valores de dados)

| Tabela | Arquivo | Colunas iniciais (nome e tipo/expressão de declaração) |
|---|---|---|
| `crm_allowed_users` | `SUPABASE_MIGRATION_ALLOWED_USERS.sql` | user_id uuid, email text, created_at timestamptz |
| `crm_app_secrets` | `SUPABASE_MIGRATION_APP_SECRETS.sql` | user_id uuid, name text, value text, updated_at timestamptz |
| `crm_appointment_reminders` | `SUPABASE_MIGRATION_APPOINTMENT_REMINDERS.sql` | id uuid, user_id uuid, event_id text, title text, start_at timestamptz, location text, html_link text, maps_link text, target text, phone text, contact_name text, remind_at timestamptz, status text, error text, sent_at timestamptz, created_at timestamptz |
| `crm_bling_auto_log` | `SUPABASE_MIGRATION_BLING_AUTO.sql` | id uuid, user_id uuid, proposal_id text, contact_id uuid, phone text, status text, detail text, created_at timestamptz |
| `crm_bulk_sends` | `SUPABASE_MIGRATION.sql` | id uuid, user_id uuid, name text, message text, interval_seconds int, total_contacts int, sent_count int, status text, created_at timestamptz |
| `crm_capture_widgets` | `SUPABASE_MIGRATION_WIDGETS.sql` | id uuid, user_id uuid, name text, category_id uuid, stage_id uuid, title text, subtitle text, button_text text, primary_color text, success_message text, source_tag text, is_active boolean, submissions_count int, created_at timestamptz |
| `crm_categories` | `SUPABASE_MIGRATION.sql` | id uuid, user_id uuid, name text, color text, created_at timestamptz |
| `crm_contact_categories` | `SUPABASE_MIGRATION_MULTI_CATEGORIES.sql` | contact_id uuid, category_id uuid, user_id uuid, created_at timestamptz |
| `crm_contact_sequences` | `SUPABASE_MIGRATION.sql` | id uuid, user_id uuid, contact_id uuid, sequence_id uuid, current_step int, status text, next_send_at timestamptz, started_at timestamptz, paused_at timestamptz, pause_reason text |
| `crm_contacts` | `SUPABASE_MIGRATION.sql` | id uuid, user_id uuid, name text, phone text, phone_norm text, email text, notes text, category_id uuid, created_at timestamptz, updated_at timestamptz |
| `crm_ignored_phones` | `SUPABASE_MIGRATION_BLACKLIST.sql` | id uuid, user_id uuid, phone_norm text, reason text, created_at timestamptz |
| `crm_instance_state` | `SUPABASE_MIGRATION_PHASE3.sql` | user_id uuid, instance text, state text, last_event_at timestamptz |
| `crm_message_templates` | `SUPABASE_MIGRATION_PHASE4.sql` | id uuid, user_id uuid, name text, content text, category text, created_at timestamptz, updated_at timestamptz |
| `crm_messages` | `SUPABASE_MIGRATION.sql` | id uuid, user_id uuid, contact_id uuid, body text, from_me boolean, at timestamptz |
| `crm_optout_shortlinks` | `SUPABASE_MIGRATION_OPTOUT_SHORTLINKS.sql` | id uuid, user_id uuid, phone_norm text, code text, created_at timestamptz, expires_at timestamptz |
| `crm_pipeline_placements` | `SUPABASE_MIGRATION.sql` | contact_id uuid, stage_id uuid, user_id uuid, moved_at timestamptz |
| `crm_pipeline_stages` | `SUPABASE_MIGRATION.sql` | id uuid, user_id uuid, name text, color text, "order" int, created_at timestamptz |
| `crm_sequence_send_log` | `SUPABASE_MIGRATION.sql` | id uuid, user_id uuid, contact_sequence_id uuid, step_order int, message text, sent_at timestamptz, status text, error text |
| `crm_sequence_steps` | `SUPABASE_MIGRATION.sql` | id uuid, sequence_id uuid, user_id uuid, "order" int, message text, delay_value int, delay_unit text, created_at timestamptz |
| `crm_sequences` | `SUPABASE_MIGRATION.sql` | id uuid, user_id uuid, name text, description text, is_active boolean, trigger_type text, trigger_value uuid, window_start_hour int, window_end_hour int, window_days int[], created_at timestamptz |
| `crm_status_media` | `SUPABASE_MIGRATION_STATUS_ROTATION.sql` | id uuid, user_id uuid, type text, content text, storage_path text, mime_type text, file_name text, caption text, background_color text, font integer, position integer, is_active boolean, last_used_at timestamptz, last_error text, created_at timestamptz, updated_at timestamptz |
| `crm_status_publications` | `SUPABASE_MIGRATION_STATUS_ROTATION.sql` | id uuid, user_id uuid, media_id uuid, status text, provider_message_id text, error text, provider_response jsonb, created_at timestamptz |
| `crm_status_runs` | `SUPABASE_MIGRATION_STATUS_BATCHES.sql` | id uuid, user_id uuid, media_id uuid, status text, recipients jsonb, payload jsonb, next_index integer, in_flight_at timestamptz, error text, created_at timestamptz, completed_at timestamptz |
| `crm_status_settings` | `SUPABASE_MIGRATION_STATUS_ROTATION.sql` | user_id uuid, enabled boolean, interval_minutes integer, last_published_at timestamptz, last_error text, processing_started_at timestamptz, updated_at timestamptz |
| `crm_user_settings` | `SUPABASE_MIGRATION_PHASE6_AI_TERMS.sql` | user_id uuid, interest_terms text[], rescan_webhook_url text, updated_at timestamptz |
| `crm_webhook_events` | `SUPABASE_MIGRATION_PHASE3.sql` | id uuid, user_id uuid, instance text, event text, payload jsonb, processed boolean, error text, received_at timestamptz |

> PK/FK, constraints, índices, policies, grants e alterações posteriores: buscar pelo nome da tabela nos 43 SQLs; consultar o catálogo efetivo antes de restaurar. Os SQLs locais são a especificação inicial, não um dump.

## Arquivos SQL disponíveis

Ordem alfabética **não** é ordem de execução:
- `SUPABASE_BACKFILL_FOLLOWUP_ORCAMENTO.sql`
- `SUPABASE_DATA_FIX_CONTACT_TAG_USER_IDS.sql`
- `SUPABASE_MIGRATION.sql`
- `SUPABASE_MIGRATION_ALLOWED_USERS.sql`
- `SUPABASE_MIGRATION_APPOINTMENT_REMINDERS.sql`
- `SUPABASE_MIGRATION_APP_SECRETS.sql`
- `SUPABASE_MIGRATION_ATTENDANCE.sql`
- `SUPABASE_MIGRATION_AUTOBOOK.sql`
- `SUPABASE_MIGRATION_BLACKLIST.sql`
- `SUPABASE_MIGRATION_BLACKLIST_9TH_DIGIT_FIX.sql`
- `SUPABASE_MIGRATION_BLING_AUTO.sql`
- `SUPABASE_MIGRATION_BULK_ENHANCEMENTS.sql`
- `SUPABASE_MIGRATION_BULK_SCHEDULED.sql`
- `SUPABASE_MIGRATION_BULK_TICK.sql`
- `SUPABASE_MIGRATION_CATEGORY_KEYWORDS.sql`
- `SUPABASE_MIGRATION_CLEANUP_ORPHAN_DOCS.sql`
- `SUPABASE_MIGRATION_CLEANUP_ORPHAN_IMAGES.sql`
- `SUPABASE_MIGRATION_CONTACT_AVATAR.sql`
- `SUPABASE_MIGRATION_CONTACT_WEBSITE.sql`
- `SUPABASE_MIGRATION_DEDUPE_CATEGORIES.sql`
- `SUPABASE_MIGRATION_DROP_LEGACY_TABLES.sql`
- `SUPABASE_MIGRATION_FIX_MESSAGES_UNIQUE.sql`
- `SUPABASE_MIGRATION_GROUPS.sql`
- `SUPABASE_MIGRATION_INBOX_READ_STATE.sql`
- `SUPABASE_MIGRATION_MERGE_DUPLICATE_CONTACTS.sql`
- `SUPABASE_MIGRATION_MULTI_CATEGORIES.sql`
- `SUPABASE_MIGRATION_OPTOUT_LINK.sql`
- `SUPABASE_MIGRATION_OPTOUT_SHORTLINKS.sql`
- `SUPABASE_MIGRATION_PHASE1_5.sql`
- `SUPABASE_MIGRATION_PHASE3.sql`
- `SUPABASE_MIGRATION_PHASE4.sql`
- `SUPABASE_MIGRATION_PHASE5_AI.sql`
- `SUPABASE_MIGRATION_PHASE6_AI_TERMS.sql`
- `SUPABASE_MIGRATION_PHASE7_SEQUENCES_UX.sql`
- `SUPABASE_MIGRATION_REALTIME_MESSAGES.sql`
- `SUPABASE_MIGRATION_RENAME_CLIENTE_PREFIX.sql`
- `SUPABASE_MIGRATION_STATUS_BATCHES.sql`
- `SUPABASE_MIGRATION_STATUS_ROTATION.sql`
- `SUPABASE_MIGRATION_TAG_SOURCE.sql`
- `SUPABASE_MIGRATION_TEMPLATE_MEDIA.sql`
- `SUPABASE_MIGRATION_UNREAD_COUNTS_RPC.sql`
- `SUPABASE_MIGRATION_WIDGETS.sql`
- `SUPABASE_ROLLBACK_BOT_PROMPTS.sql`

## Rotas de interface

| Caminho | Origem |
|---|---|
| `/agenda` | `src/routes/_app.agenda.tsx` |
| `/bling` | `src/routes/_app.bling.tsx` |
| `/configuracoes` | `src/routes/_app.configuracoes.tsx` |
| `/contatos` | `src/routes/_app.contatos.tsx` |
| `/dashboard` | `src/routes/_app.dashboard.tsx` |
| `/detector` | `src/routes/_app.detector.tsx` |
| `/disparos` | `src/routes/_app.disparos.tsx` |
| `/explorar` | `src/routes/_app.explorar.tsx` |
| `/historico-ia` | `src/routes/_app.historico-ia.tsx` |
| `/inbox` | `src/routes/_app.inbox.tsx` |
| `/logs` | `src/routes/_app.logs.tsx` |
| `/pipeline` | `src/routes/_app.pipeline.tsx` |
| `/redact` | `src/routes/_app.redact.tsx` |
| `/sequencias-dashboard` | `src/routes/_app.sequencias-dashboard.tsx` |
| `/sequencias` | `src/routes/_app.sequencias.tsx` |
| `/status` | `src/routes/_app.status.tsx` |
| `/templates` | `src/routes/_app.templates.tsx` |
| `/_app` | `src/routes/_app.tsx` |
| `/whatsapp` | `src/routes/_app.whatsapp.tsx` |
| `/d/$code` | `src/routes/d.$code.tsx` |
| `/forgot-password` | `src/routes/forgot-password.tsx` |
| `/` | `src/routes/index.tsx` |
| `/login` | `src/routes/login.tsx` |
| `/m/$q` | `src/routes/m.$q.tsx` |
| `/reset-password` | `src/routes/reset-password.tsx` |
| `/u/$token` | `src/routes/u.$token.tsx` |
| `/widget/form/$id` | `src/routes/widget.form.$id.tsx` |

## APIs HTTP próprias

| Caminho | Métodos declarados | Arquivo |
|---|---|---|
| `/api/public/ai/contact-enrich-failure` | OPTIONS, POST | `src/routes/api.public.ai.contact-enrich-failure.ts` |
| `/api/public/ai/contact-enrich` | OPTIONS, POST | `src/routes/api.public.ai.contact-enrich.ts` |
| `/api/public/ai/existing-categories` | OPTIONS, GET | `src/routes/api.public.ai.existing-categories.ts` |
| `/api/public/ai/interest-terms` | OPTIONS, GET | `src/routes/api.public.ai.interest-terms.ts` |
| `/api/public/ai/lovable-proxy` | OPTIONS, POST | `src/routes/api.public.ai.lovable-proxy.ts` |
| `/api/public/avatars/refresh` | OPTIONS, POST | `src/routes/api.public.avatars.refresh.ts` |
| `/api/public/bling/auto-config` | OPTIONS, GET, POST | `src/routes/api.public.bling.auto-config.ts` |
| `/api/public/bling/auto-tick` | OPTIONS, POST | `src/routes/api.public.bling.auto-tick.ts` |
| `/api/public/bling/callback` | GET | `src/routes/api.public.bling.callback.ts` |
| `/api/public/bling/config` | OPTIONS, GET, POST | `src/routes/api.public.bling.config.ts` |
| `/api/public/bling/contacts` | OPTIONS, GET | `src/routes/api.public.bling.contacts.ts` |
| `/api/public/bling/proposal-raw` | OPTIONS, GET | `src/routes/api.public.bling.proposal-raw.ts` |
| `/api/public/bling/proposals` | OPTIONS, GET | `src/routes/api.public.bling.proposals.ts` |
| `/api/public/calendar/auto-book` | OPTIONS, POST | `src/routes/api.public.calendar.auto-book.ts` |
| `/api/public/calendar/availability` | OPTIONS, GET, POST | `src/routes/api.public.calendar.availability.ts` |
| `/api/public/calendar/confirm-booking` | OPTIONS, POST | `src/routes/api.public.calendar.confirm-booking.ts` |
| `/api/public/calendar/create-event` | POST | `src/routes/api.public.calendar.create-event.ts` |
| `/api/public/calendar/delete-event` | POST | `src/routes/api.public.calendar.delete-event.ts` |
| `/api/public/calendar/detect-test` | OPTIONS, POST | `src/routes/api.public.calendar.detect-test.ts` |
| `/api/public/calendar/events` | GET | `src/routes/api.public.calendar.events.ts` |
| `/api/public/calendar/reminders-tick` | OPTIONS, POST | `src/routes/api.public.calendar.reminders-tick.ts` |
| `/api/public/calendar/update-event` | POST | `src/routes/api.public.calendar.update-event.ts` |
| `/api/public/cleanup/groups` | OPTIONS, POST | `src/routes/api.public.cleanup.groups.ts` |
| `/api/public/contacts/blacklist-toggle` | OPTIONS, POST | `src/routes/api.public.contacts.blacklist-toggle.ts` |
| `/api/public/contacts/cleanup` | POST | `src/routes/api.public.contacts.cleanup.ts` |
| `/api/public/evolution/bulk-dispatch` | POST | `src/routes/api.public.evolution.bulk-dispatch.ts` |
| `/api/public/evolution/bulk-tick` | OPTIONS, POST | `src/routes/api.public.evolution.bulk-tick.ts` |
| `/api/public/evolution/check-number` | OPTIONS, POST | `src/routes/api.public.evolution.check-number.ts` |
| `/api/public/evolution/configure-webhook` | POST | `src/routes/api.public.evolution.configure-webhook.ts` |
| `/api/public/evolution/create` | POST | `src/routes/api.public.evolution.create.ts` |
| `/api/public/evolution/forward-media` | OPTIONS, POST | `src/routes/api.public.evolution.forward-media.ts` |
| `/api/public/evolution/forward-message` | OPTIONS, POST | `src/routes/api.public.evolution.forward-message.ts` |
| `/api/public/evolution/media` | OPTIONS, GET, POST | `src/routes/api.public.evolution.media.ts` |
| `/api/public/evolution/qr` | GET | `src/routes/api.public.evolution.qr.ts` |
| `/api/public/evolution/send-and-log` | POST | `src/routes/api.public.evolution.send-and-log.ts` |
| `/api/public/evolution/send-media-and-log` | POST | `src/routes/api.public.evolution.send-media-and-log.ts` |
| `/api/public/evolution/send-media` | POST | `src/routes/api.public.evolution.send-media.ts` |
| `/api/public/evolution/send` | POST | `src/routes/api.public.evolution.send.ts` |
| `/api/public/evolution/status-library` | GET, POST, PATCH, DELETE | `src/routes/api.public.evolution.status-library.ts` |
| `/api/public/evolution/status-tick` | POST | `src/routes/api.public.evolution.status-tick.ts` |
| `/api/public/evolution/status` | GET | `src/routes/api.public.evolution.status.ts` |
| `/api/public/evolution/sync-contacts` | OPTIONS, POST | `src/routes/api.public.evolution.sync-contacts.ts` |
| `/api/public/evolution/sync-groups` | OPTIONS, POST | `src/routes/api.public.evolution.sync-groups.ts` |
| `/api/public/evolution/sync-messages` | OPTIONS, POST | `src/routes/api.public.evolution.sync-messages.ts` |
| `/api/public/evolution/test` | GET | `src/routes/api.public.evolution.test.ts` |
| `/api/public/evolution/webhook` | POST | `src/routes/api.public.evolution.webhook.ts` |
| `/api/public/link-preview` | OPTIONS, GET | `src/routes/api.public.link-preview.ts` |
| `/api/public/optout/confirm` | OPTIONS, POST | `src/routes/api.public.optout.confirm.ts` |
| `/api/public/optout/info` | OPTIONS, POST | `src/routes/api.public.optout.info.ts` |
| `/api/public/optout/reverse` | OPTIONS, POST | `src/routes/api.public.optout.reverse.ts` |
| `/api/public/optout/short-confirm` | OPTIONS, POST | `src/routes/api.public.optout.short-confirm.ts` |
| `/api/public/optout/short-info` | OPTIONS, POST | `src/routes/api.public.optout.short-info.ts` |
| `/api/public/optout/short-reverse` | OPTIONS, POST | `src/routes/api.public.optout.short-reverse.ts` |
| `/api/public/sequences/due` | OPTIONS, GET | `src/routes/api.public.sequences.due.ts` |
| `/api/public/sequences/inbound` | OPTIONS, POST | `src/routes/api.public.sequences.inbound.ts` |
| `/api/public/sequences/inspect` | OPTIONS, GET | `src/routes/api.public.sequences.inspect.ts` |
| `/api/public/sequences/sent` | OPTIONS, POST | `src/routes/api.public.sequences.sent.ts` |
| `/api/public/sequences/test-run` | OPTIONS, POST | `src/routes/api.public.sequences.test-run.ts` |
| `/api/public/sequences/test-send` | OPTIONS, POST | `src/routes/api.public.sequences.test-send.ts` |
| `/api/public/settings/secret` | OPTIONS, GET, POST | `src/routes/api.public.settings.secret.ts` |
| `/api/public/widget/config/$id` | OPTIONS, GET | `src/routes/api.public.widget.config.$id.ts` |
| `/api/public/widget/embed/$id.js` | GET | `src/routes/api.public.widget.embed.$id[.]js.ts` |
| `/api/public/widget/submit` | OPTIONS, POST | `src/routes/api.public.widget.submit.ts` |

**Nota:** método, autenticação e payload devem ser confrontados com o handler específico antes de integração. Este índice não transforma endpoints autenticados em públicos.
