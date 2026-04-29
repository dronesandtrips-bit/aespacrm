// POST /api/public/ai/lovable-proxy
// Proxy para o Lovable AI Gateway. Permite ao n8n usar a LOVABLE_API_KEY
// deste projeto sem precisar conhecer o valor da key.
//
// Segurança: header `x-api-key` precisa bater com N8N_API_KEY.
//
// Body (compatível com OpenAI Chat Completions):
// {
//   "model": "google/gemini-3-flash-preview",   // opcional
//   "messages": [{ "role": "user", "content": "olá" }],
//   "stream": false,                            // opcional
//   ...qualquer outro campo aceito pelo gateway
// }
//
// Resposta: repassa o JSON do gateway tal qual.

import { createFileRoute } from "@tanstack/react-router";
import { checkApiKey, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export const Route = createFileRoute("/api/public/ai/lovable-proxy")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        if (!checkApiKey(request)) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }

        const apiKey = process.env.LOVABLE_API_KEY?.trim();
        if (!apiKey) {
          return jsonResponse(
            { ok: false, error: "LOVABLE_API_KEY não configurada no projeto" },
            500,
          );
        }

        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ ok: false, error: "invalid json" }, 400);
        }

        if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
          return jsonResponse(
            { ok: false, error: "campo 'messages' é obrigatório (array não vazio)" },
            400,
          );
        }

        const payload = {
          model: typeof body.model === "string" && body.model.trim() ? body.model : DEFAULT_MODEL,
          ...body,
          // garante que messages e model não sejam sobrescritos por undefined
          messages: body.messages,
        };

        try {
          const upstream = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          const text = await upstream.text();
          // Tenta repassar JSON com o mesmo status
          return new Response(text, {
            status: upstream.status,
            headers: {
              "Content-Type": upstream.headers.get("content-type") ?? "application/json",
              ...PUBLIC_CORS,
            },
          });
        } catch (e: any) {
          console.error("lovable-proxy fetch error", e);
          return jsonResponse(
            { ok: false, error: "falha ao chamar Lovable AI Gateway", detail: String(e?.message ?? e) },
            502,
          );
        }
      },
    },
  },
});
