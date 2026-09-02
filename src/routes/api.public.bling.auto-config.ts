// GET/POST /api/public/bling/auto-config — configuração do disparo automático
// de novas propostas comerciais do Bling (JWT obrigatório).
import { createFileRoute } from "@tanstack/react-router";
import {
  getSupabaseAdmin,
  jsonResponse,
  PUBLIC_CORS,
  requireUserJwt,
} from "@/integrations/supabase/server";
import { getAutoConfig, saveAutoConfig } from "@/server/bling-auto.server";

async function history(userId: string) {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("crm_bling_auto_log")
      .select("proposal_id, phone, status, detail, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    return data ?? [];
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/api/public/bling/auto-config")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),

      GET: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
        const [config, log] = await Promise.all([getAutoConfig(auth.userId), history(auth.userId)]);
        return jsonResponse({ ok: true, config, log });
      },

      POST: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
        let body: any = {};
        try {
          body = await request.json();
        } catch {}
        try {
          const config = await saveAutoConfig(auth.userId, {
            enabled: Boolean(body?.enabled),
            dias: Number(body?.dias),
            maxPerRun: Number(body?.maxPerRun),
            situacoes: Array.isArray(body?.situacoes)
              ? body.situacoes.map((s: any) => String(s)).filter(Boolean)
              : undefined,
            text: typeof body?.text === "string" ? body.text : undefined,
            mediaUrl: typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : undefined,
            mediaType: ["image", "video", "document", ""].includes(body?.mediaType)
              ? body.mediaType
              : undefined,
            since: typeof body?.since === "string" ? body.since.slice(0, 10) : undefined,
            delayMin: Number.isFinite(Number(body?.delayMin)) ? Number(body.delayMin) : undefined,
          } as any);
          return jsonResponse({ ok: true, config, log: await history(auth.userId) });
        } catch (err: any) {
          return jsonResponse({ ok: false, error: err?.message ?? "erro ao salvar" }, 500);
        }
      },
    },
  },
});
