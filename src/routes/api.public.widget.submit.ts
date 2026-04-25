// POST /api/public/widget/submit
// Recebe submissões públicas do widget. Cria/atualiza contato, posiciona
// na etapa configurada do pipeline, salva mensagem inicial no inbox.
// Honeypot + rate-limit em memória por IP.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getSupabaseAdmin, PUBLIC_CORS, jsonResponse } from "@/integrations/supabase/server";

const Schema = z.object({
  widget_id: z.string().min(8).max(64),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(3).max(40),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  // honeypot — bots costumam preencher campos hidden
  website: z.string().optional(),
});

function normPhone(p: string) {
  return p.replace(/\D/g, "");
}

// Rate limit em memória (por instância). Janela 60s, max 8 reqs por IP.
const RL = new Map<string, { count: number; reset: number }>();
const RL_WINDOW_MS = 60_000;
const RL_MAX = 8;

function rateLimit(ip: string) {
  const now = Date.now();
  const cur = RL.get(ip);
  if (!cur || cur.reset < now) {
    RL.set(ip, { count: 1, reset: now + RL_WINDOW_MS });
    return true;
  }
  if (cur.count >= RL_MAX) return false;
  cur.count++;
  return true;
}

function getIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export const Route = createFileRoute("/api/public/widget/submit")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        try {
          const ip = getIp(request);
          if (!rateLimit(ip)) {
            return jsonResponse({ error: "Too many requests" }, 429);
          }

          const body = await request.json();
          const parsed = Schema.safeParse(body);
          if (!parsed.success) {
            return jsonResponse({ error: "Invalid body" }, 400);
          }
          const data = parsed.data;

          // Honeypot acionado → finge sucesso e descarta
          if (data.website && data.website.trim() !== "") {
            return jsonResponse({ ok: true });
          }

          const norm = normPhone(data.phone);
          if (!norm || norm.length < 8) {
            return jsonResponse({ error: "Telefone inválido" }, 400);
          }

          const admin = getSupabaseAdmin();

          // Carrega widget
          const { data: widget, error: wErr } = await admin
            .from("crm_capture_widgets")
            .select("id,user_id,category_id,stage_id,source_tag,is_active")
            .eq("id", data.widget_id)
            .maybeSingle();
          if (wErr) throw wErr;
          if (!widget || !widget.is_active) {
            return jsonResponse({ error: "Widget not found" }, 404);
          }

          const userId = widget.user_id as string;

          // Procura contato existente (mesmo user + telefone)
          const { data: existing } = await admin
            .from("crm_contacts")
            .select("id")
            .eq("user_id", userId)
            .eq("phone_norm", norm)
            .maybeSingle();

          let contactId: string;
          if (existing?.id) {
            contactId = existing.id as string;
            // Atualiza nome/email se vieram, sem sobrescrever com vazio
            const patch: Record<string, unknown> = {};
            if (data.name) patch.name = data.name;
            if (data.email) patch.email = data.email;
            if (widget.category_id) patch.category_id = widget.category_id;
            if (Object.keys(patch).length > 0) {
              await admin.from("crm_contacts").update(patch).eq("id", contactId);
            }
          } else {
            const { data: created, error: cErr } = await admin
              .from("crm_contacts")
              .insert({
                user_id: userId,
                name: data.name,
                phone: data.phone,
                email: data.email || null,
                category_id: widget.category_id || null,
                notes: widget.source_tag ? `Origem: ${widget.source_tag}` : null,
              })
              .select("id")
              .single();
            if (cErr) throw cErr;
            contactId = created.id as string;
          }

          // Posiciona no pipeline na etapa configurada
          if (widget.stage_id) {
            await admin
              .from("crm_pipeline_placements")
              .upsert(
                {
                  contact_id: contactId,
                  stage_id: widget.stage_id,
                  user_id: userId,
                  moved_at: new Date().toISOString(),
                },
                { onConflict: "contact_id" },
              );
          }

          // Mensagem inicial no inbox (se houver)
          if (data.message && data.message.trim()) {
            await admin.from("crm_messages").insert({
              user_id: userId,
              contact_id: contactId,
              body: `[Widget] ${data.message.trim()}`,
              from_me: false,
              at: new Date().toISOString(),
            });
          }

          // Incrementa contador
          await admin.rpc("noop_does_not_exist").catch(() => {});
          await admin
            .from("crm_capture_widgets")
            .update({ submissions_count: (await getCount(admin, widget.id)) + 1 })
            .eq("id", widget.id);

          return jsonResponse({ ok: true });
        } catch (err: any) {
          console.error("[widget/submit]", err);
          return jsonResponse({ error: err?.message ?? "Internal" }, 500);
        }
      },
    },
  },
});

async function getCount(admin: any, id: string): Promise<number> {
  const { data } = await admin
    .from("crm_capture_widgets")
    .select("submissions_count")
    .eq("id", id)
    .maybeSingle();
  return Number(data?.submissions_count ?? 0);
}
