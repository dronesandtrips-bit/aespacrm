import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, getSupabaseAdmin, requireUserJwt } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";
const BUCKET = "crm-status-media";
const BATCH_SIZE = 20;
const bodySchema = z.object({ force: z.boolean().optional(), itemId: z.string().uuid().optional() });

type StatusPayload = {
  type: string; content: string | null; storage_path: string | null;
  caption: string | null; background_color: string; font: number;
};

function recipientJids(contacts: unknown): string[] {
  if (!Array.isArray(contacts)) throw new Error("A Evolution não retornou a lista de contatos");
  const seen = new Set<string>();
  for (const entry of contacts) {
    if (!entry || typeof entry !== "object") continue;
    const contact = entry as { remoteJid?: unknown; type?: unknown };
    if (contact.type && contact.type !== "contact") continue;
    const jid = contact.remoteJid;
    if (typeof jid !== "string" || !/^\d{10,15}@s\.whatsapp\.net$/.test(jid)) continue;
    seen.add(jid);
  }
  return Array.from(seen).sort();
}

export const Route = createFileRoute("/api/public/evolution/status-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cron = checkApiKey(request);
        const auth = cron ? null : await requireUserJwt(request);
        if (!cron && auth && "error" in auth) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        const userId = !cron && auth && !("error" in auth) ? auth.userId : null;
        const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success || (cron && (parsed.data.force || parsed.data.itemId))) return Response.json({ ok: false, error: "Pedido inválido" }, { status: 400 });
        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        if (!apiUrl || !apiKey) return Response.json({ ok: false, error: "Evolution API não configurada" }, { status: 500 });
        const sb = getSupabaseAdmin();
        if (userId) {
          const { data: allowed, error } = await sb.from("crm_allowed_users").select("user_id").eq("user_id", userId).maybeSingle();
          if (error || !allowed) return Response.json({ ok: false, error: "Não autorizado" }, { status: 403 });
        }
        let settingsQuery = sb.from("crm_status_settings").select("user_id,enabled,interval_minutes,last_published_at,processing_started_at");
        settingsQuery = userId ? settingsQuery.eq("user_id", userId) : settingsQuery.eq("enabled", true).limit(10);
        const { data: settings, error: settingsError } = await settingsQuery;
        if (settingsError) return Response.json({ ok: false, error: settingsError.message }, { status: 500 });
        const results: Record<string, unknown>[] = [];
        for (const config of settings ?? []) {
          try {
            const { data: open, error: openError } = await sb.from("crm_status_runs")
              .select("id,media_id,status,recipients,payload,next_index,in_flight_at")
              .eq("user_id", config.user_id).in("status", ["running", "uncertain"])
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (openError) throw openError;
            if (open?.status === "uncertain") {
              results.push({ userId: config.user_id, ok: false, error: "Envio sem confirmação. Verifique com os contatos antes de iniciar outra publicação." });
              continue;
            }
            let run = open;
            if (!run) {
              const now = Date.now();
              const due = !config.last_published_at || now - new Date(config.last_published_at).getTime() >= config.interval_minutes * 60_000;
              if (!parsed.data.force && !due) { results.push({ userId: config.user_id, skipped: "interval" }); continue; }
              if (config.processing_started_at && now - new Date(config.processing_started_at).getTime() < 5 * 60_000) { results.push({ userId: config.user_id, skipped: "busy" }); continue; }
              const claimAt = new Date().toISOString();
              let claim = sb.from("crm_status_settings").update({ processing_started_at: claimAt }).eq("user_id", config.user_id);
              claim = config.processing_started_at ? claim.eq("processing_started_at", config.processing_started_at) : claim.is("processing_started_at", null);
              const { data: claimed, error: claimError } = await claim.select("user_id").maybeSingle();
              if (claimError) throw claimError;
              if (!claimed) { results.push({ userId: config.user_id, skipped: "race" }); continue; }
              try {
                let itemQuery = sb.from("crm_status_media").select("id,type,content,storage_path,caption,background_color,font")
                  .eq("user_id", config.user_id).eq("is_active", true);
                if (parsed.data.itemId) itemQuery = itemQuery.eq("id", parsed.data.itemId);
                const { data: selected, error: selectionError } = await itemQuery.order("last_used_at", { ascending: true, nullsFirst: true }).order("position", { ascending: true }).limit(1).maybeSingle();
                if (selectionError) throw selectionError;
                if (!selected) throw new Error("Nenhum conteúdo ativo");
                // Snapshot de destinatários: nunca recalcular no meio de uma publicação.
                const contactsResponse = await fetch(`${apiUrl}/chat/findContacts/${INSTANCE}`, {
                  method: "POST", headers: { apikey: apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ where: {} }),
                  signal: AbortSignal.timeout(15_000),
                });
                if (!contactsResponse.ok) throw new Error(`Não foi possível consultar contatos (${contactsResponse.status})`);
                const recipients = recipientJids(await contactsResponse.json());
                if (!recipients.length) throw new Error("Nenhum contato com número disponível na instância zapcrm");
                const { data: created, error: createError } = await sb.from("crm_status_runs")
                  .insert({ user_id: config.user_id, media_id: selected.id, status: "running", recipients, payload: {
                    type: selected.type, content: selected.content, storage_path: selected.storage_path,
                    caption: selected.caption, background_color: selected.background_color, font: selected.font,
                  } }).select("id,media_id,status,recipients,payload,next_index,in_flight_at").single();
                if (createError) throw createError;
                run = created;
              } finally {
                await sb.from("crm_status_settings").update({ processing_started_at: null }).eq("user_id", config.user_id).eq("processing_started_at", claimAt);
              }
            }
            if (!run) throw new Error("Não foi possível iniciar a publicação");
            const recipients = run.recipients as string[];
            const index = Number(run.next_index);
            if (!Array.isArray(recipients) || !recipients.length || !Number.isSafeInteger(index) || index < 0 || index >= recipients.length) throw new Error("Progresso inválido; publicação interrompida");
            if (run.in_flight_at) {
              if (Date.now() - new Date(run.in_flight_at).getTime() < 60_000) {
                results.push({ userId: config.user_id, skipped: "busy" });
                continue;
              }
              const message = "Resposta do grupo anterior não confirmada. Verifique os contatos antes de prosseguir.";
              await sb.from("crm_status_runs").update({ status: "uncertain", error: message }).eq("id", run.id).eq("user_id", config.user_id).eq("status", "running");
              await sb.from("crm_status_settings").update({ enabled: false, last_error: message }).eq("user_id", config.user_id);
              results.push({ userId: config.user_id, ok: false, error: message });
              continue;
            }
            const payload = run.payload as StatusPayload;
            let content = payload.content;
            if (payload.storage_path) {
              const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(payload.storage_path, 600);
              if (error || !data?.signedUrl) throw new Error(error?.message ?? "Não foi possível acessar a mídia");
              content = data.signedUrl;
            }
            // Reserva durável antes da chamada externa. Se o Worker morrer, NÃO reenviar o lote.
            const inFlight = new Date().toISOString();
            const { data: claimedBatch, error: batchClaimError } = await sb.from("crm_status_runs")
              .update({ in_flight_at: inFlight }).eq("id", run.id).eq("user_id", config.user_id)
              .eq("status", "running").eq("next_index", index).is("in_flight_at", null).select("id").maybeSingle();
            if (batchClaimError) throw batchClaimError;
            if (!claimedBatch) { results.push({ userId: config.user_id, skipped: "busy" }); continue; }
            try {
              const response = await fetch(`${apiUrl}/message/sendStatus/${INSTANCE}`, {
                method: "POST", headers: { apikey: apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({ type: payload.type, content, caption: payload.caption ?? "", backgroundColor: payload.background_color,
                  font: payload.font, allContacts: false, statusJidList: recipients.slice(index, index + BATCH_SIZE) }),
                signal: AbortSignal.timeout(25_000),
              });
              const responseText = await response.text();
              if (!response.ok) throw new Error(`Evolution [${response.status}]: ${responseText.slice(0, 400)}`);
              const nextIndex = Math.min(index + BATCH_SIZE, recipients.length);
              const completed = nextIndex === recipients.length;
              if (completed) {
                const publishedAt = new Date().toISOString();
                const [mediaResult, settingsResult] = await Promise.all([
                  sb.from("crm_status_media").update({ last_used_at: publishedAt, last_error: null }).eq("id", run.media_id).eq("user_id", config.user_id),
                  sb.from("crm_status_settings").update({ last_published_at: publishedAt, last_error: null }).eq("user_id", config.user_id),
                ]);
                if (mediaResult.error || settingsResult.error) throw new Error("O último grupo foi aceito, mas o registro de conclusão falhou");
              }
              const { data: saved, error: saveError } = await sb.from("crm_status_runs")
                .update({ next_index: nextIndex, in_flight_at: null, status: completed ? "completed" : "running",
                  completed_at: completed ? new Date().toISOString() : null, error: null })
                .eq("id", run.id).eq("user_id", config.user_id).eq("status", "running")
                .eq("in_flight_at", inFlight).select("id").maybeSingle();
              if (saveError || !saved) throw new Error("O resultado foi recebido, mas não foi possível registrar o avanço");
              if (completed) await sb.from("crm_status_publications").insert({ user_id: config.user_id, media_id: run.media_id, status: "accepted", provider_response: { runId: run.id, recipients: recipients.length } });
              results.push({ userId: config.user_id, ok: true, completed, sent: nextIndex, total: recipients.length, mediaId: run.media_id });
            } catch (error) {
              const message = String(error instanceof Error ? error.message : error).slice(0, 800);
              await Promise.all([
                sb.from("crm_status_runs").update({ status: "uncertain", error: message }).eq("id", run.id).eq("user_id", config.user_id).eq("in_flight_at", inFlight),
                sb.from("crm_status_settings").update({ enabled: false, last_error: `Envio interrompido: ${message}` }).eq("user_id", config.user_id),
                sb.from("crm_status_media").update({ last_error: message }).eq("id", run.media_id).eq("user_id", config.user_id),
                sb.from("crm_status_publications").insert({ user_id: config.user_id, media_id: run.media_id, status: "failed", error: message }),
              ]);
              results.push({ userId: config.user_id, ok: false, error: `Envio interrompido no grupo ${Math.floor(index / BATCH_SIZE) + 1}. Pode ter sido entregue; confira antes de prosseguir. ${message}` });
            }
          } catch (error) {
            const message = String(error instanceof Error ? error.message : error).slice(0, 800);
            await sb.from("crm_status_settings").update({ last_error: message }).eq("user_id", config.user_id);
            results.push({ userId: config.user_id, ok: false, error: message });
          }
        }
        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});