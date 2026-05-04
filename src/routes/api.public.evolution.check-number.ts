// POST /api/public/evolution/check-number
// Verifica se UM número existe no WhatsApp e, se sim, cria/retorna o contato
// no CRM. Usado pelo Inbox quando o usuário busca um contato que ainda não
// está no banco.
//
// Auth: Authorization: Bearer <user-jwt>
// Body: { number: "5511999999999" }   (só dígitos, com DDI)
//
// ANTI-BAN: throttle in-memory por instância (mín. 3s entre chamadas).
// Como o disparo é só por clique manual do usuário, o risco é mínimo.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";
const MIN_INTERVAL_MS = 3000;
let lastCallAt = 0;

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

const Schema = z.object({
  number: z.string().regex(/^\d{10,15}$/, "número precisa ter 10-15 dígitos com DDI"),
});

export const Route = createFileRoute("/api/public/evolution/check-number")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: PUBLIC_CORS }),

      POST: async ({ request }) => {
        try {
          // Throttle anti-ban
          const now = Date.now();
          const wait = MIN_INTERVAL_MS - (now - lastCallAt);
          if (wait > 0) {
            return jsonResponse(
              { ok: false, error: "rate_limited", retryAfterMs: wait },
              429,
            );
          }
          lastCallAt = now;

          const apiUrl = process.env.EVOLUTION_API_URL
            ? normalizeUrl(process.env.EVOLUTION_API_URL)
            : "";
          const apiKey = process.env.EVOLUTION_API_KEY?.trim();
          const supaUrl = process.env.AESPACRM_SUPA_URL
            ? normalizeUrl(process.env.AESPACRM_SUPA_URL)
            : "";
          const anonKey = process.env.AESPACRM_SUPA_ANON_KEY?.trim();
          if (!apiUrl || !apiKey || !supaUrl || !anonKey) {
            return jsonResponse({ ok: false, error: "config faltando no servidor" }, 500);
          }

          // Auth do usuário
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

          // Body
          let parsed;
          try {
            parsed = Schema.parse(await request.json());
          } catch (e: any) {
            return jsonResponse(
              { ok: false, error: "payload inválido", detail: e?.message },
              400,
            );
          }
          const number = parsed.number;

          const sbAdmin = getSupabaseAdmin();

          // 1. Já existe no CRM?
          const { data: existing } = await sbAdmin
            .from("crm_contacts")
            .select("id, name, phone")
            .eq("user_id", userId)
            .eq("phone_norm", number)
            .eq("is_group", false)
            .maybeSingle();

          if (existing) {
            return jsonResponse({
              ok: true,
              alreadyExisted: true,
              contact: { id: existing.id, name: existing.name, phone: existing.phone },
            });
          }

          // 2. Pergunta à Evolution se o número está no WhatsApp
          const evRes = await fetch(
            `${apiUrl}/chat/whatsappNumbers/${INSTANCE}`,
            {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ numbers: [number] }),
            },
          );
          const evText = await evRes.text();
          let evData: any = evText;
          try { evData = JSON.parse(evText); } catch {}

          if (!evRes.ok) {
            return jsonResponse(
              { ok: false, error: "evolution_failed", status: evRes.status, detail: evData },
              502,
            );
          }

          // Resposta esperada: array com { exists: bool, jid: string, number: string }
          const list = Array.isArray(evData) ? evData : [];
          const found = list.find(
            (it: any) => String(it?.number ?? "").replace(/\D/g, "").endsWith(number),
          ) ?? list[0];

          if (!found?.exists) {
            return jsonResponse({
              ok: true,
              exists: false,
              message: "Número não está no WhatsApp",
            });
          }

          const jid: string = found.jid ?? `${number}@s.whatsapp.net`;

          // 3. Cria contato no CRM
          const { data: created, error: insertErr } = await sbAdmin
            .from("crm_contacts")
            .insert({
              user_id: userId,
              name: `+${number}`,
              phone: number,
              is_group: false,
              wa_jid: jid,
            })
            .select("id, name, phone")
            .single();

          if (insertErr) {
            // Race condition — outro request criou no meio
            if (insertErr.code === "23505") {
              const { data: dup } = await sbAdmin
                .from("crm_contacts")
                .select("id, name, phone")
                .eq("user_id", userId)
                .eq("phone_norm", number)
                .eq("is_group", false)
                .maybeSingle();
              if (dup) {
                return jsonResponse({
                  ok: true,
                  alreadyExisted: true,
                  contact: dup,
                });
              }
            }
            return jsonResponse(
              { ok: false, error: "insert_failed", detail: insertErr.message },
              500,
            );
          }

          return jsonResponse({
            ok: true,
            exists: true,
            created: true,
            contact: created,
          });
        } catch (err: any) {
          console.error("[check-number] unhandled", err?.message ?? err);
          return jsonResponse(
            { ok: false, error: "internal", detail: err?.message ?? String(err) },
            500,
          );
        }
      },
    },
  },
});
