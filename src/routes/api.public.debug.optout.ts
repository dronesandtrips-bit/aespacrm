// Debug temporário: inspeciona últimos eventos do webhook para um telefone
// e o estado da blacklist. Protegido pela EVOLUTION_API_KEY.
// REMOVER após investigação.
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

export const Route = createFileRoute("/api/public/debug/optout")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
        const got = request.headers.get("apikey");
        if (!apiKey || got !== apiKey) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }
        const url = new URL(request.url);
        const phone = (url.searchParams.get("phone") ?? "").replace(/\D/g, "");
        if (!phone) return jsonResponse({ ok: false, error: "phone required" }, 400);

        const sb = getSupabaseAdmin();
        const jidLike = `${phone}@%`;

        const [events, blacklist, contact, messages] = await Promise.all([
          sb
            .from("crm_webhook_events")
            .select("id,event,created_at,payload")
            .eq("user_id", ownerUserId)
            .order("created_at", { ascending: false })
            .limit(200),
          sb.from("crm_ignored_phones").select("*").eq("user_id", ownerUserId).eq("phone_norm", phone),
          sb.from("crm_contacts").select("id,name,phone,phone_norm").eq("user_id", ownerUserId).eq("phone_norm", phone),
          sb
            .from("crm_messages")
            .select("id,from_me,type,body,at,remote_jid")
            .eq("user_id", ownerUserId)
            .like("remote_jid", jidLike)
            .order("at", { ascending: false })
            .limit(20),
        ]);

        const matched = (events.data ?? []).filter((e: any) => {
          try {
            return JSON.stringify(e.payload).includes(phone);
          } catch {
            return false;
          }
        }).slice(0, 10);

        return jsonResponse({
          ok: true,
          phone,
          blacklist: blacklist.data,
          contact: contact.data,
          messages: messages.data,
          matched_events: matched.map((e: any) => ({
            id: e.id,
            event: e.event,
            created_at: e.created_at,
            jid: e.payload?.data?.key?.remoteJid,
            fromMe: e.payload?.data?.key?.fromMe,
            body:
              e.payload?.data?.message?.conversation ??
              e.payload?.data?.message?.extendedTextMessage?.text ??
              null,
          })),
        });
      },
    },
  },
});
