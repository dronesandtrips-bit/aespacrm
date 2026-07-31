// POST /api/public/avatars/refresh
// Baixa as fotos de perfil do WhatsApp e guarda uma cópia no Supabase Storage,
// eliminando os erros 403 causados pela expiração dos links do CDN.
//
// Auth: Authorization: Bearer <user-jwt>
// Body (opcional): { limit?: number, force?: boolean }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse, PUBLIC_CORS, getSupabaseAdmin, requireUserJwt } from "@/integrations/supabase/server";
import { cacheAvatarFromUrl, isCachedAvatarUrl } from "@/lib/avatar-cache.server";

const INSTANCE = "zapcrm";

const Schema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  force: z.boolean().optional(),
});

function evolutionConfig() {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!apiUrl || !apiKey) return null;
  const withProtocol = /^https?:\/\//i.test(apiUrl) ? apiUrl : `https://${apiUrl}`;
  return { apiUrl: withProtocol, apiKey };
}

/** Pede à Evolution uma URL fresca da foto (o link antigo do CDN já expirou). */
async function fetchFreshPictureUrl(number: string): Promise<string | null> {
  const cfg = evolutionConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.apiUrl}/chat/fetchProfilePictureUrl/${INSTANCE}`, {
      method: "POST",
      headers: { apikey: cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number }),
    });
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    const url = data?.profilePictureUrl ?? data?.pictureUrl ?? data?.url ?? null;
    return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/avatars/refresh")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
        const userId = auth.userId;

        let parsed: z.infer<typeof Schema> = {};
        try {
          const raw = await request.text();
          parsed = raw ? Schema.parse(JSON.parse(raw)) : {};
        } catch (e: any) {
          return jsonResponse({ ok: false, error: "payload inválido", detail: e?.message }, 400);
        }
        const limit = parsed.limit ?? 200;

        const sb = getSupabaseAdmin();
        const { data: contacts, error } = await sb
          .from("crm_contacts")
          .select("id,wa_jid,phone,avatar_url")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) {
          return jsonResponse({ ok: false, error: error.message }, 500);
        }

        let scanned = 0;
        let cached = 0;
        let skipped = 0;
        let failed = 0;
        let lastError: string | null = null;

        for (const c of contacts ?? []) {
          scanned++;
          if (!parsed.force && isCachedAvatarUrl(c.avatar_url)) {
            skipped++;
            continue;
          }
          const number = (c.wa_jid || c.phone || "").toString().trim();
          if (!number) {
            skipped++;
            continue;
          }
          try {
            const fresh = (await fetchFreshPictureUrl(number)) ?? c.avatar_url ?? null;
            if (!fresh) {
              skipped++;
              continue;
            }
            const stored = await cacheAvatarFromUrl(userId, c.id, fresh);
            if (!stored) {
              failed++;
              continue;
            }
            const { error: upErr } = await sb
              .from("crm_contacts")
              .update({ avatar_url: stored })
              .eq("id", c.id)
              .eq("user_id", userId);
            if (upErr) {
              failed++;
              lastError = upErr.message;
              continue;
            }
            cached++;
          } catch (e: any) {
            failed++;
            lastError = String(e?.message ?? e);
          }
        }

        return jsonResponse({ ok: true, scanned, cached, skipped, failed, lastError });
      },
    },
  },
});
