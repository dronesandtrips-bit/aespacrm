// POST /api/public/sequences/test-send
// Envia uma mensagem de teste (com variáveis renderizadas) para o test_phone do usuário.
// Body: { user_id: string, message: string, contact_name?: string, typing_seconds?: number }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  getSupabaseAdmin,
  PUBLIC_CORS,
  jsonResponse,
} from "@/integrations/supabase/server";

const Schema = z.object({
  user_id: z.string().uuid(),
  message: z.string().min(1).max(4096),
  contact_name: z.string().max(120).optional(),
  typing_seconds: z.number().int().min(0).max(60).optional(),
});

function saudacao(now = new Date()): string {
  const brt = new Date(now.getTime() - 3 * 3600_000);
  const h = brt.getUTCHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

function applyVars(t: string, v: Record<string, string>) {
  return t.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? "");
}

export const Route = createFileRoute("/api/public/sequences/test-send")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const parsed = Schema.safeParse(body);
          if (!parsed.success) {
            return jsonResponse({ error: "Invalid body" }, 400);
          }
          const { user_id, message, contact_name, typing_seconds } = parsed.data;
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
          const rendered = applyVars(message, {
            nome: name,
            primeiro_nome: name.split(/\s+/)[0] ?? "",
            saudacao: saudacao(),
            empresa: "",
          });

          const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
          const apiKey = process.env.EVOLUTION_API_KEY?.trim();
          if (!apiUrl || !apiKey) {
            return jsonResponse({ error: "Evolution não configurada" }, 500);
          }
          const res = await fetch(`${apiUrl}/message/sendText/zapcrm`, {
            method: "POST",
            headers: { apikey: apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              number: phone,
              text: `🧪 [TESTE] ${rendered}`,
              delay: Math.max(0, Math.min(60, typing_seconds ?? 0)) * 1000,
            }),
          });
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
