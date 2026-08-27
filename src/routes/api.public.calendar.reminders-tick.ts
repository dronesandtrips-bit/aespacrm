// POST /api/public/calendar/reminders-tick
// Cron runner (n8n, a cada 1-5 min): envia por WhatsApp os lembretes de
// compromissos cujo remind_at já venceu (cliente e/ou dono da agenda).
// Auth: x-api-key (N8N_API_KEY).
//
// Aditivo: não altera nenhum fluxo existente.

import { createFileRoute } from "@tanstack/react-router";
import {
  getSupabaseAdmin,
  checkApiKey,
  PUBLIC_CORS,
  jsonResponse,
} from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";

function formatWhen(startAt: string) {
  return new Date(startAt).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function buildText(r: any) {
  const quando = formatWhen(r.start_at);
  if (r.target === "owner") {
    return [
      `⏰ Lembrete de compromisso: ${r.title}`,
      `Quando: ${quando}`,
      r.contact_name ? `Cliente: ${r.contact_name}` : "",
      r.location ? `Local: ${r.location}` : "",
      r.maps_link ? `Mapa: ${r.maps_link}` : "",
      r.html_link ? `Agenda: ${r.html_link}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Olá${r.contact_name ? ` ${r.contact_name}` : ""}! Passando para lembrar do nosso compromisso:`,
    `${r.title}`,
    `Quando: ${quando}`,
    r.location ? `Local: ${r.location}` : "",
    r.maps_link ? `Mapa: ${r.maps_link}` : "",
    "",
    "Responda *SIM* para confirmar sua presença ou *NÃO* para cancelar.",
  ]
    .filter((l) => l !== undefined && l !== null && l !== false)
    .join("\n");
}

export const Route = createFileRoute("/api/public/calendar/reminders-tick")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        if (!checkApiKey(request)) return jsonResponse({ error: "Unauthorized" }, 401);

        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        if (!apiUrl || !apiKey) {
          return jsonResponse({ ok: false, error: "EVOLUTION_API_URL/KEY ausentes" }, 500);
        }

        const sb = getSupabaseAdmin();
        const nowIso = new Date().toISOString();

        const { data: due, error } = await sb
          .from("crm_appointment_reminders")
          .select(
            "id, user_id, title, start_at, location, html_link, maps_link, target, phone, contact_name",
          )
          .eq("status", "pending")
          .lte("remind_at", nowIso)
          .order("remind_at", { ascending: true })
          .limit(30);
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);

        const results: Array<{ id: string; ok: boolean; error?: string }> = [];

        for (const r of due ?? []) {
          try {
            const number = String(r.phone).replace(/\D/g, "");
            const res = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ number, text: buildText(r) }),
            });
            const body = await res.text();
            if (!res.ok) throw new Error(`Evolution [${res.status}]: ${body.slice(0, 300)}`);
            await sb
              .from("crm_appointment_reminders")
              .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
              .eq("id", r.id);
            results.push({ id: r.id, ok: true });
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            console.error(`[reminders-tick] falha no lembrete ${r.id}: ${msg}`);
            await sb
              .from("crm_appointment_reminders")
              .update({ status: "error", error: msg.slice(0, 500) })
              .eq("id", r.id);
            results.push({ id: r.id, ok: false, error: msg });
          }
        }

        return jsonResponse({ ok: true, processed: results.length, results });
      },
    },
  },
});
