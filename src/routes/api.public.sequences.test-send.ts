// POST /api/public/sequences/test-send
// Envia uma mensagem de teste (com variáveis renderizadas) para o test_phone do usuário.
// Body: { user_id: string, message: string, contact_name?: string, typing_seconds?: number }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  getSupabaseAdmin,
  PUBLIC_CORS,
  jsonResponse,
  requireUserJwt,
} from "@/integrations/supabase/server";
import { buildOptoutUrlFor } from "@/server/optout.server";

const MediaSchema = z.object({
  type: z.enum(["image", "video", "audio", "document"]),
  base64: z.string().min(1).max(20_000_000),
  mime: z.string().trim().min(3).max(100).optional().nullable(),
  filename: z.string().trim().min(1).max(255).optional().nullable(),
  caption: z.string().trim().max(1024).optional().nullable(),
});

const Schema = z.object({
  message: z.string().min(1).max(4096),
  contact_name: z.string().max(120).optional(),
  typing_seconds: z.number().int().min(0).max(60).optional(),
  media: MediaSchema.optional().nullable(),
});

function saudacao(now = new Date()): string {
  const brt = new Date(now.getTime() - 3 * 3600_000);
  const h = brt.getUTCHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

function applyVars(t: string, v: Record<string, string>) {
  const hasOptout =
    t.includes("{link_descadastro}") || t.includes("{{link_descadastro}}");

  const rendered = t.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? "");

  if (!hasOptout && v["link_descadastro"]) {
    return `${rendered}\n\n_Não quer mais receber? Clique aqui:_ ${v["link_descadastro"]}`;
  }
  return rendered;
}

export const Route = createFileRoute("/api/public/sequences/test-send")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        try {
          // Auth obrigatório: pega user_id do JWT (não confia no body).
          const auth = await requireUserJwt(request);
          if ("error" in auth) {
            return jsonResponse({ error: auth.error }, auth.status);
          }
          const user_id = auth.userId;
          const body = await request.json();
          const parsed = Schema.safeParse(body);
          if (!parsed.success) {
            return jsonResponse({ error: "Invalid body" }, 400);
          }
          const { message, contact_name, typing_seconds, media } = parsed.data;
          const admin = getSupabaseAdmin();
          const { data: settings } = await admin
            .from("crm_user_settings")
            .select("test_phone")
            .eq("user_id", user_id)
            .maybeSingle();
          const phone = (settings?.test_phone ?? "").replace(/\D/g, "");
          if (!phone || phone.length < 8) {
            return jsonResponse(
              { error: "Configure um número de teste em Configurações → Conta" },
              400,
            );
          }
          const name = contact_name ?? "Você";
          const optoutUrl = await buildOptoutUrlFor(user_id, phone);
          const rendered = applyVars(message, {
            nome: name,
            primeiro_nome: name.split(/\s+/)[0] ?? "",
            saudacao: saudacao(),
            empresa: "",
            link_descadastro: optoutUrl,
          });

          const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
          const apiKey = process.env.EVOLUTION_API_KEY?.trim();
          if (!apiUrl || !apiKey) {
            return jsonResponse({ error: "Evolution não configurada" }, 500);
          }

          const testText = `🧪 [TESTE] ${rendered}`;
          const delayMs = Math.max(0, Math.min(60, typing_seconds ?? 0)) * 1000;

          let res: Response;
          if (media) {
            const caption = media.caption
              ? applyVars(media.caption, {
                  nome: name,
                  primeiro_nome: name.split(/\s+/)[0] ?? "",
                  saudacao: saudacao(),
                  empresa: "",
                  link_descadastro: optoutUrl,
                })
              : testText;
            if (media.type === "audio") {
              res = await fetch(`${apiUrl}/message/sendWhatsAppAudio/zapcrm`, {
                method: "POST",
                headers: { apikey: apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({ number: phone, audio: media.base64, delay: delayMs }),
              });
            } else {
              res = await fetch(`${apiUrl}/message/sendMedia/zapcrm`, {
                method: "POST",
                headers: { apikey: apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                  number: phone,
                  mediatype: media.type,
                  media: media.base64,
                  mimetype: media.mime ?? undefined,
                  fileName: media.filename ?? undefined,
                  caption,
                  delay: delayMs,
                }),
              });
            }
          } else {
            res = await fetch(`${apiUrl}/message/sendText/zapcrm`, {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ number: phone, text: testText, delay: delayMs }),
            });
          }
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            return jsonResponse({ error: "Falha no envio", detail: data }, 502);
          }
          return jsonResponse({ ok: true, sent_to: phone });
        } catch (err: any) {
          console.error("[sequences/test-send]", err);
          return jsonResponse({ error: err?.message ?? "Internal error" }, 500);
        }
      },
    },
  },
});
