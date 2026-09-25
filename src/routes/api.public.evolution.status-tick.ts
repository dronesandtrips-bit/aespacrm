import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, getSupabaseAdmin, requireUserJwt } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";
const BUCKET = "crm-status-media";
const bodySchema = z.object({ force: z.boolean().optional(), itemId: z.string().uuid().optional() });

export const Route = createFileRoute("/api/public/evolution/status-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cron = checkApiKey(request);
        const auth = cron ? null : await requireUserJwt(request);
        if (!cron && auth && "error" in auth) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        const userId = !cron && auth && !("error" in auth) ? auth.userId : null;
        const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ ok: false, error: "Pedido inválido" }, { status: 400 });
        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        if (!apiUrl || !apiKey) return Response.json({ ok: false, error: "Evolution API não configurada" }, { status: 500 });
        const sb = getSupabaseAdmin();
        let settingsQuery = sb.from("crm_status_settings").select("user_id,enabled,interval_minutes,last_published_at,processing_started_at");
        settingsQuery = userId ? settingsQuery.eq("user_id", userId) : settingsQuery.eq("enabled", true).limit(10);
        const { data: settings, error: settingsError } = await settingsQuery;
        if (settingsError) return Response.json({ ok: false, error: settingsError.message }, { status: 500 });
        const results: any[] = [];
        for (const config of settings ?? []) {
          const now = Date.now();
          const due = !config.last_published_at || now - new Date(config.last_published_at).getTime() >= config.interval_minutes * 60_000;
          if (!parsed.data.force && !due) { results.push({ userId: config.user_id, skipped: "interval" }); continue; }
          if (!parsed.data.force && config.processing_started_at && now - new Date(config.processing_started_at).getTime() < 5 * 60_000) { results.push({ userId: config.user_id, skipped: "busy" }); continue; }
          const claimAt = new Date().toISOString();
          let claim = sb.from("crm_status_settings").update({ processing_started_at: claimAt }).eq("user_id", config.user_id);
          if (config.processing_started_at) claim = claim.eq("processing_started_at", config.processing_started_at);
          else claim = claim.is("processing_started_at", null);
          const { data: claimed } = await claim.select("user_id").maybeSingle();
          if (!claimed) { results.push({ userId: config.user_id, skipped: "race" }); continue; }
          let itemQuery = sb.from("crm_status_media").select("id,type,content,storage_path,mime_type,caption,background_color,font").eq("user_id", config.user_id).eq("is_active", true);
          if (parsed.data.itemId) itemQuery = itemQuery.eq("id", parsed.data.itemId);
          const { data: selected } = await itemQuery.order("last_used_at", { ascending: true, nullsFirst: true }).order("position", { ascending: true }).limit(1).maybeSingle();
          if (!selected) {
            await sb.from("crm_status_settings").update({ processing_started_at: null, last_error: "Nenhum conteúdo ativo" }).eq("user_id", config.user_id);
            results.push({ userId: config.user_id, ok: false, error: "Nenhum conteúdo ativo" });
            continue;
          }
          try {
            let content = selected.content;
            if (selected.storage_path) {
              const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(selected.storage_path, 600);
              if (error || !data?.signedUrl) throw new Error(error?.message ?? "Não foi possível acessar a mídia");
              content = data.signedUrl;
            }
            const response = await fetch(`${apiUrl}/message/sendStatus/${INSTANCE}`, {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ type: selected.type, content, caption: selected.caption ?? "", backgroundColor: selected.background_color, font: selected.font, allContacts: true, statusJidList: [] }),
            });
            const responseText = await response.text();
            let responseBody: any = responseText;
            try { responseBody = JSON.parse(responseText); } catch {}
            if (!response.ok) throw new Error(`Evolution [${response.status}]: ${responseText.slice(0, 500)}`);
            const publishedAt = new Date().toISOString();
            await Promise.all([
              sb.from("crm_status_media").update({ last_used_at: publishedAt, last_error: null }).eq("id", selected.id),
              sb.from("crm_status_settings").update({ last_published_at: publishedAt, last_error: null, processing_started_at: null }).eq("user_id", config.user_id),
              sb.from("crm_status_publications").insert({ user_id: config.user_id, media_id: selected.id, status: "accepted", provider_message_id: responseBody?.key?.id ?? null, provider_response: responseBody }),
            ]);
            results.push({ userId: config.user_id, ok: true, mediaId: selected.id });
          } catch (error: any) {
            const message = String(error?.message ?? error).slice(0, 1000);
            await Promise.all([
              sb.from("crm_status_media").update({ last_error: message }).eq("id", selected.id),
              sb.from("crm_status_settings").update({ last_error: message, processing_started_at: null }).eq("user_id", config.user_id),
              sb.from("crm_status_publications").insert({ user_id: config.user_id, media_id: selected.id, status: "failed", error: message }),
            ]);
            results.push({ userId: config.user_id, ok: false, mediaId: selected.id, error: message });
          }
        }
        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
