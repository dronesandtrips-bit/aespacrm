// POST /api/public/cleanup/groups
// Apaga mensagens de GRUPOS (is_group=true) com mais de N dias
// + apaga eventos brutos em crm_webhook_events com mais de N dias.
// Não toca em conversas 1:1 nem nos próprios contatos de grupo.
//
// Auth: Authorization: Bearer <user-jwt>
// Body opcional: { days?: number }  (default 7)
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export const Route = createFileRoute("/api/public/cleanup/groups")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        const supaUrl = process.env.AESPACRM_SUPA_URL ? normalizeUrl(process.env.AESPACRM_SUPA_URL) : "";
        const anonKey = process.env.AESPACRM_SUPA_ANON_KEY?.trim();
        if (!supaUrl || !anonKey) {
          return jsonResponse({ ok: false, error: "config faltando no servidor" }, 500);
        }

        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

        const userClient = createClient(supaUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          db: { schema: "aespacrm" },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: userRes, error: authErr } = await userClient.auth.getUser(token);
        if (authErr || !userRes?.user) {
          return jsonResponse({ ok: false, error: "invalid token" }, 401);
        }
        const userId = userRes.user.id;

        let body: any = {};
        try { body = await request.json(); } catch {}
        const days = Math.max(1, Math.min(365, Number(body?.days) || 7));
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const sb = getSupabaseAdmin();

        // 1) IDs dos contatos do tipo grupo deste usuário
        const { data: groups, error: gErr } = await sb
          .from("crm_contacts")
          .select("id")
          .eq("user_id", userId)
          .eq("is_group", true);
        if (gErr) return jsonResponse({ ok: false, error: gErr.message }, 500);

        const groupIds = (groups ?? []).map((g: any) => g.id);
        let deletedMessages = 0;
        if (groupIds.length > 0) {
          const { error: mErr, count } = await sb
            .from("crm_messages")
            .delete({ count: "exact" })
            .eq("user_id", userId)
            .in("contact_id", groupIds)
            .lt("at", cutoff);
          if (mErr) return jsonResponse({ ok: false, error: mErr.message }, 500);
          deletedMessages = count ?? 0;
        }

        // 2) Eventos brutos antigos (qualquer origem)
        const { error: eErr, count: eCount } = await sb
          .from("crm_webhook_events")
          .delete({ count: "exact" })
          .eq("user_id", userId)
          .lt("received_at", cutoff);
        const deletedEvents = eErr ? 0 : (eCount ?? 0);

        return jsonResponse({
          ok: true,
          days,
          cutoff,
          groups: groupIds.length,
          deletedMessages,
          deletedEvents,
          eventsError: eErr?.message ?? null,
        });
      },
    },
  },
});
