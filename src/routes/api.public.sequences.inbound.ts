// POST /api/public/sequences/inbound
// n8n notifica mensagem recebida do contato. Salva no inbox e PAUSA todas as
// sequências ativas desse contato (auto-stop ao receber resposta).
// Body: { user_id: string, phone: string, body: string, at?: string }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  getSupabaseAdmin,
  checkApiKey,
  PUBLIC_CORS,
  jsonResponse,
} from "@/integrations/supabase/server";

const Schema = z.object({
  user_id: z.string().uuid(),
  phone: z.string().min(3).max(40),
  body: z.string().min(1).max(4000),
  at: z.string().datetime().optional(),
});

function normPhone(p: string) {
  return p.replace(/\D/g, "");
}

export const Route = createFileRoute("/api/public/sequences/inbound")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        if (!checkApiKey(request)) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        try {
          const body = await request.json();
          const parsed = Schema.safeParse(body);
          if (!parsed.success) {
            return jsonResponse({ error: "Invalid body", details: parsed.error.format() }, 400);
          }
          const { user_id, phone, body: text, at } = parsed.data;
          const admin = getSupabaseAdmin();
          const norm = normPhone(phone);

          // Encontra contato
          const { data: contact } = await admin
            .from("crm_contacts")
            .select("id")
            .eq("user_id", user_id)
            .eq("phone_norm", norm)
            .maybeSingle();

          let contactId = contact?.id as string | undefined;
          // Se não existe, cria contato "desconhecido"
          if (!contactId) {
            const { data: created, error: cErr } = await admin
              .from("crm_contacts")
              .insert({ user_id, name: phone, phone })
              .select("id")
              .single();
            if (cErr) throw cErr;
            contactId = created.id as string;
          }

          // Salva mensagem
          const { error: mErr } = await admin.from("crm_messages").insert({
            user_id,
            contact_id: contactId,
            body: text,
            from_me: false,
            at: at ?? new Date().toISOString(),
          });
          if (mErr) throw mErr;

          // Pausa todas as sequências ativas deste contato
          const { data: paused, error: pErr } = await admin
            .from("crm_contact_sequences")
            .update({
              status: "paused",
              paused_at: new Date().toISOString(),
              pause_reason: "inbound_reply",
            })
            .eq("contact_id", contactId)
            .eq("status", "active")
            .select("id");
          if (pErr) throw pErr;

          return jsonResponse({
            ok: true,
            contact_id: contactId,
            paused_sequences: paused?.length ?? 0,
          });
        } catch (err: any) {
          console.error("[sequences/inbound]", err);
          return jsonResponse({ error: err?.message ?? "Internal error" }, 500);
        }
      },
    },
  },
});
