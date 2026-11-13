// POST /api/public/evolution/send
// Envia mensagem de TEXTO via Evolution API (instância `zapcrm`).
// Body: { number: "5511999999999", text: "olá" }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, requireUserJwt, getSupabaseAdmin } from "@/integrations/supabase/server";
import { forwardToRobo } from "@/server/robo-forward.server";

const INSTANCE = "zapcrm";

const SendSchema = z.object({
  number: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .regex(/^\+?\d+$/, "número deve conter apenas dígitos (com DDI)"),
  text: z.string().trim().min(1).max(4096),
  delay: z.number().int().min(0).max(20000).optional(),
});

export const Route = createFileRoute("/api/public/evolution/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: aceita Bearer JWT (frontend) OU x-api-key (n8n)
        let callerUserId: string | null = null;
        if (!checkApiKey(request)) {
          const auth = await requireUserJwt(request);
          if ("error" in auth) {
            return Response.json({ ok: false, error: auth.error }, { status: auth.status });
          }
          callerUserId = auth.userId;
        }

        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        if (!apiUrl || !apiKey) {
          return Response.json(
            { ok: false, error: "EVOLUTION_API_URL/KEY não configurado" },
            { status: 500 },
          );
        }

        let parsed;
        try {
          const body = await request.json();
          parsed = SendSchema.parse(body);
        } catch (e: any) {
          return Response.json(
            { ok: false, error: "payload inválido", detail: e?.message ?? String(e) },
            { status: 400 },
          );
        }

        const number = parsed.number.replace(/^\+/, "");

        const res = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
          method: "POST",
          headers: {
            apikey: apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            number,
            text: parsed.text,
            delay: parsed.delay ?? 0,
          }),
        });

        const text = await res.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch {}

        if (!res.ok) {
          return Response.json(
            { ok: false, status: res.status, error: data },
            { status: 502 },
          );
        }

        // Conexão única: a Evolution não emite messages.upsert para envios via API,
        // então o Robô nunca via o /off ou /on do botão Shield. Repassamos um
        // aviso sintético (só aviso — nada é reenviado no WhatsApp).
        const cmd = parsed.text.trim().toLowerCase();
        if (callerUserId && (cmd === "/off" || cmd === "/on")) {
          const synthetic = {
            event: "messages.upsert",
            instance: INSTANCE,
            data: {
              key: { remoteJid: `${number}@s.whatsapp.net`, fromMe: true, id: data?.key?.id ?? `shield-${Date.now()}` },
              message: { conversation: cmd },
              messageTimestamp: Math.floor(Date.now() / 1000),
            },
          };
          await forwardToRobo({
            sb: getSupabaseAdmin(),
            userId: callerUserId,
            event: "messages.upsert",
            rawBody: JSON.stringify(synthetic),
            apikey: apiKey,
          }).catch(() => {});
        }

        return Response.json({
          ok: true,
          instance: INSTANCE,
          messageId: data?.key?.id ?? null,
          status: data?.status ?? null,
          data,
        });
      },
    },
  },
});
