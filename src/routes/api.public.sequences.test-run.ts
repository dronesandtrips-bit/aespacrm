// POST /api/public/sequences/test-run
// Modo de teste ponta-a-ponta: pega 1 contato "due" da sequência informada
// (do usuário logado), ignora janela de horário, envia via Evolution e
// avança o step exatamente como o Runner do n8n faria.
// Body: { sequence_id: string, contact_sequence_id?: string }
// Auth: Bearer JWT do usuário logado.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  getSupabaseAdmin,
  PUBLIC_CORS,
  jsonResponse,
  requireUserJwt,
} from "@/integrations/supabase/server";
import { buildOptoutUrlFor } from "@/server/optout.server";

const Schema = z.object({
  sequence_id: z.string().uuid(),
  contact_sequence_id: z.string().uuid().optional(),
});

function saudacao(now = new Date()): string {
  const brt = new Date(now.getTime() - 3 * 3600_000);
  const h = brt.getUTCHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

function primeiroNome(name: string): string {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

function applyVars(template: string, vars: Record<string, string>) {
  const hasOptout =
    template.includes("{link_descadastro}") || template.includes("{{link_descadastro}}");
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
  if (!hasOptout && vars["link_descadastro"]) {
    return `${rendered}\n\n_Não quer mais receber? Clique aqui:_ ${vars["link_descadastro"]}`;
  }
  return rendered;
}

export const Route = createFileRoute("/api/public/sequences/test-run")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        try {
          const auth = await requireUserJwt(request);
          if ("error" in auth) return jsonResponse({ error: auth.error }, auth.status);
          const userId = auth.userId;

          const body = await request.json();
          const parsed = Schema.safeParse(body);
          if (!parsed.success) return jsonResponse({ error: "Invalid body" }, 400);
          const { sequence_id, contact_sequence_id } = parsed.data;

          const admin = getSupabaseAdmin();

          // Confirma que a sequência pertence ao usuário e está ativa.
          const { data: seq, error: seqErr } = await admin
            .from("crm_sequences")
            .select("id,name,is_active,user_id")
            .eq("id", sequence_id)
            .eq("user_id", userId)
            .maybeSingle();
          if (seqErr) throw seqErr;
          if (!seq) return jsonResponse({ error: "Sequência não encontrada" }, 404);
          if (!seq.is_active)
            return jsonResponse({ error: "Ative a sequência antes de testar" }, 400);

          // Escolhe 1 contact_sequence "active" com next_send_at vencido,
          // pulando contatos na blacklist (busca até 50 candidatos).
          let query = admin
            .from("crm_contact_sequences")
            .select("id,user_id,contact_id,sequence_id,current_step,next_send_at,status")
            .eq("user_id", userId)
            .eq("sequence_id", sequence_id)
            .eq("status", "active")
            .lte("next_send_at", new Date().toISOString())
            .order("next_send_at", { ascending: true })
            .limit(50);
          if (contact_sequence_id) query = query.eq("id", contact_sequence_id);
          const { data: dueRows, error: dueErr } = await query;
          if (dueErr) throw dueErr;
          if (!dueRows || dueRows.length === 0) {
            return jsonResponse(
              {
                error:
                  "Nenhum contato pronto para envio nesta sequência (todos aguardando delay ou pausados)",
              },
              404,
            );
          }

          // Filtra contatos válidos (não blacklistados)
          const contactIds = dueRows.map((r: any) => r.contact_id);
          const { data: candidates, error: candErr } = await admin
            .from("crm_contacts")
            .select("id,name,phone,email,is_ignored")
            .in("id", contactIds);
          if (candErr) throw candErr;
          const validContact = (candidates ?? []).find((c: any) => !c.is_ignored);
          const cs = dueRows.find((r: any) => r.contact_id === validContact?.id);
          if (!cs || !validContact) {
            return jsonResponse(
              { error: "Todos os contatos prontos estão na blacklist" },
              404,
            );
          }

          const contact = validContact;

          const { data: steps, error: stErr } = await admin
            .from("crm_sequence_steps")
            .select(
              '"order",message,delay_value,delay_unit,typing_seconds,media_base64,media_type,media_mime,media_filename,media_caption',
            )
            .eq("sequence_id", sequence_id)
            .order("order", { ascending: true });
          if (stErr) throw stErr;
          const step = (steps ?? []).find((s: any) => s.order === cs.current_step);
          if (!step) return jsonResponse({ error: "Step atual não encontrado" }, 404);

          const phoneNorm = String(contact.phone ?? "").replace(/\D/g, "");
          if (!phoneNorm || phoneNorm.length < 8)
            return jsonResponse({ error: "Telefone inválido" }, 400);

          const optoutUrl = await buildOptoutUrlFor(userId, phoneNorm);
          const vars = {
            nome: contact.name ?? "",
            primeiro_nome: primeiroNome(contact.name ?? ""),
            saudacao: saudacao(),
            empresa: contact.email ?? "",
            link_descadastro: optoutUrl,
          };
          const message = applyVars(step.message, vars);
          const delayMs =
            Math.max(0, Math.min(60, Number(step.typing_seconds ?? 0))) * 1000;

          const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
          const apiKey = process.env.EVOLUTION_API_KEY?.trim();
          if (!apiUrl || !apiKey)
            return jsonResponse({ error: "Evolution não configurada" }, 500);

          let res: Response;
          if (step.media_base64 && step.media_type) {
            const caption = step.media_caption
              ? applyVars(String(step.media_caption), vars)
              : message;
            if (step.media_type === "audio") {
              res = await fetch(`${apiUrl}/message/sendWhatsAppAudio/zapcrm`, {
                method: "POST",
                headers: { apikey: apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                  number: phoneNorm,
                  audio: step.media_base64,
                  delay: delayMs,
                }),
              });
            } else {
              res = await fetch(`${apiUrl}/message/sendMedia/zapcrm`, {
                method: "POST",
                headers: { apikey: apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                  number: phoneNorm,
                  mediatype: step.media_type,
                  media: step.media_base64,
                  mimetype: step.media_mime ?? undefined,
                  fileName: step.media_filename ?? undefined,
                  caption,
                  delay: delayMs,
                }),
              });
            }
          } else {
            res = await fetch(`${apiUrl}/message/sendText/zapcrm`, {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ number: phoneNorm, text: message, delay: delayMs }),
            });
          }
          const evData = await res.json().catch(() => ({}));

          // Log da tentativa (mesmo esquema do /sequences/sent).
          await admin.from("crm_sequence_send_log").insert({
            user_id: userId,
            contact_sequence_id: cs.id,
            step_order: cs.current_step,
            message,
            status: res.ok ? "sent" : "failed",
            error: res.ok ? null : `HTTP ${res.status}`,
          });

          if (!res.ok) {
            // Não avança step; devolve detalhe para o CRM mostrar.
            return jsonResponse(
              { ok: false, error: "Falha no envio", detail: evData, status: res.status },
              502,
            );
          }

          // Avança o step (ou completa).
          const nextOrder = cs.current_step + 1;
          const nextStep = (steps ?? []).find((s: any) => s.order === nextOrder);
          if (!nextStep) {
            await admin
              .from("crm_contact_sequences")
              .update({ status: "completed", next_send_at: null })
              .eq("id", cs.id);
          } else {
            const ms =
              Number(nextStep.delay_value ?? 0) *
              (nextStep.delay_unit === "hours" ? 3600_000 : 86_400_000);
            await admin
              .from("crm_contact_sequences")
              .update({
                current_step: nextOrder,
                next_send_at: new Date(Date.now() + ms).toISOString(),
              })
              .eq("id", cs.id);
          }

          return jsonResponse({
            ok: true,
            sent_to: { id: contact.id, name: contact.name, phone: phoneNorm },
            step_order: cs.current_step,
            next_step: nextStep ? nextOrder : null,
            completed: !nextStep,
            evolution: evData,
          });
        } catch (err: any) {
          console.error("[sequences/test-run]", err);
          return jsonResponse({ error: err?.message ?? "Internal error" }, 500);
        }
      },
    },
  },
});
