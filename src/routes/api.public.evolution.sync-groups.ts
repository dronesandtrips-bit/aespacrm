// POST /api/public/evolution/sync-groups
// Busca todos os grupos do WhatsApp na instância `zapcrm` e atualiza
// `aespacrm.crm_contacts` (apenas linhas com is_group=true) com:
//  - name = subject oficial do grupo
//  - avatar_url = pictureUrl
//
// Auth: Authorization: Bearer <user-jwt>
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

type EvGroup = {
  id?: string;          // jid 1203...@g.us
  subject?: string;
  pictureUrl?: string | null;
  profilePicUrl?: string | null;
};

export const Route = createFileRoute("/api/public/evolution/sync-groups")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        const apiUrl = process.env.EVOLUTION_API_URL ? normalizeUrl(process.env.EVOLUTION_API_URL) : "";
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        const supaUrl = process.env.AESPACRM_SUPA_URL ? normalizeUrl(process.env.AESPACRM_SUPA_URL) : "";
        const anonKey = process.env.AESPACRM_SUPA_ANON_KEY?.trim();
        if (!apiUrl || !apiKey || !supaUrl || !anonKey) {
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

        // Busca grupos. Endpoint padrão: GET /group/fetchAllGroups/{instance}?getParticipants=false
        let groups: EvGroup[] = [];
        try {
          const r = await fetch(
            `${apiUrl}/group/fetchAllGroups/${INSTANCE}?getParticipants=false`,
            { method: "GET", headers: { apikey: apiKey } },
          );
          if (r.ok) {
            const j = await r.json().catch(() => []);
            if (Array.isArray(j)) groups = j;
          }
        } catch {}

        if (!groups.length) {
          return jsonResponse({ ok: true, scanned: 0, updated: 0, info: "nenhum grupo retornado" });
        }

        const sb = getSupabaseAdmin();
        let updated = 0;
        const errors: string[] = [];

        for (const g of groups) {
          const jid = g.id;
          if (!jid || !jid.endsWith("@g.us")) continue;
          const subject = (g.subject ?? "").toString().trim().slice(0, 120);
          const pictureUrl = g.pictureUrl ?? g.profilePicUrl ?? null;

          const patch: Record<string, any> = {};
          if (subject) patch.name = subject;
          if (pictureUrl) patch.avatar_url = pictureUrl;
          if (Object.keys(patch).length === 0) continue;

          const { error, count } = await sb
            .from("crm_contacts")
            .update(patch, { count: "exact" })
            .eq("user_id", userId)
            .eq("wa_jid", jid)
            .eq("is_group", true)
            .select("id", { count: "exact", head: true });
          if (error) {
            errors.push(`${jid}: ${error.message}`);
          } else if ((count ?? 0) > 0) {
            updated += count ?? 0;
          }
        }

        return jsonResponse({
          ok: true,
          scanned: groups.length,
          updated,
          errors: errors.slice(0, 10),
        });
      },
    },
  },
});
