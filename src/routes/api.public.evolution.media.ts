// POST /api/public/evolution/media
// Busca o conteúdo (base64) de uma mídia do WhatsApp via Evolution API,
// descriptografando-a, e devolve os bytes brutos para o navegador renderizar.
//
// Auth: Authorization: Bearer <user-jwt>  (Supabase)
// Body: { messageId: string }
//
// Segurança: confirma que a mensagem pertence ao usuário (RLS via JWT).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

const Schema = z.object({
  messageId: z.string().trim().min(1).max(200),
});

export const Route = createFileRoute("/api/public/evolution/media")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: PUBLIC_CORS }),
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

        let parsed;
        try {
          parsed = Schema.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ ok: false, error: "payload inválido", detail: e?.message }, 400);
        }

        const userClient = createClient(supaUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          db: { schema: "aespacrm" },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: userRes, error: authErr } = await userClient.auth.getUser(token);
        if (authErr || !userRes?.user) {
          return jsonResponse({ ok: false, error: "invalid token" }, 401);
        }

        // Confirma que a mensagem é do usuário e pega o tipo
        const { data: msgRow, error: msgErr } = await userClient
          .from("crm_messages")
          .select("type, media_mime")
          .eq("message_id", parsed.messageId)
          .maybeSingle();
        if (msgErr || !msgRow) {
          return jsonResponse({ ok: false, error: "mensagem não encontrada" }, 404);
        }
        // Política: imagens, stickers e áudios. Vídeo/documento NÃO são baixados.
        if (msgRow.type !== "image" && msgRow.type !== "sticker" && msgRow.type !== "audio") {
          return jsonResponse({ ok: false, error: "tipo de mídia não permitido" }, 403);
        }

        const evRes = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${INSTANCE}`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: { key: { id: parsed.messageId } },
            convertToMp4: false,
          }),
        });
        const evText = await evRes.text();
        let evData: any = evText;
        try { evData = JSON.parse(evText); } catch {}

        if (!evRes.ok) {
          return jsonResponse(
            { ok: false, status: evRes.status, error: evData },
            502,
          );
        }

        const base64: string | undefined = evData?.base64 ?? evData?.media ?? evData?.data;
        const fallbackMime =
          msgRow.type === "audio" ? "audio/ogg" : msgRow.type === "sticker" ? "image/webp" : "image/jpeg";
        const mimetype: string = evData?.mimetype ?? msgRow.media_mime ?? fallbackMime;

        if (!base64 || typeof base64 !== "string") {
          return jsonResponse({ ok: false, error: "sem base64 no retorno", raw: evData }, 502);
        }

        // Decodifica base64 → bytes
        const cleaned = base64.replace(/^data:[^;]+;base64,/, "");
        const bin = Uint8Array.from(atob(cleaned), (ch) => ch.charCodeAt(0));

        return new Response(bin, {
          status: 200,
          headers: {
            "Content-Type": mimetype,
            "Cache-Control": "private, max-age=86400",
            ...PUBLIC_CORS,
          },
        });
      },
    },
  },
});
