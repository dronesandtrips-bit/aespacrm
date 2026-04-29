// GET /api/public/sequences/due
// Retorna contatos com follow-up vencido, prontos para o n8n disparar.
// Header obrigatório: x-api-key: <N8N_API_KEY>
// Query opcional: user_id (filtra por usuário), limit (default 50, max 200)
import { createFileRoute } from "@tanstack/react-router";
import {
  getSupabaseAdmin,
  checkApiKey,
  PUBLIC_CORS,
  jsonResponse,
} from "@/integrations/supabase/server";

function applyVars(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

// Janela em horário de Brasília (UTC-3, sem DST desde 2019)
function inWindow(seq: any, now = new Date()) {
  const brt = new Date(now.getTime() - 3 * 3600_000);
  const dow = brt.getUTCDay(); // 0=Dom ... 6=Sáb
  const hour = brt.getUTCHours();
  const days = (seq.window_days ?? [1, 2, 3, 4, 5]) as number[];
  if (!days.includes(dow)) return false;
  return hour >= (seq.window_start_hour ?? 9) && hour < (seq.window_end_hour ?? 18);
}

export const Route = createFileRoute("/api/public/sequences/due")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      GET: async ({ request }) => {
        if (!checkApiKey(request)) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        try {
          const url = new URL(request.url);
          const userId = url.searchParams.get("user_id");
          const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

          const admin = getSupabaseAdmin();

          // Auto-retomar sequências pausadas por inbound_reply após auto_resume_after_days.
          // Busca sequências com auto_resume_after_days > 0 e atualiza as pausadas há tempo suficiente.
          const { data: resumeSeqs } = await admin
            .from("crm_sequences")
            .select("id,auto_resume_after_days")
            .gt("auto_resume_after_days", 0);
          for (const s of resumeSeqs ?? []) {
            const cutoff = new Date(
              Date.now() - s.auto_resume_after_days * 86400_000,
            ).toISOString();
            await admin
              .from("crm_contact_sequences")
              .update({
                status: "active",
                paused_at: null,
                pause_reason: null,
                next_send_at: new Date().toISOString(),
              })
              .eq("sequence_id", s.id)
              .eq("status", "paused")
              .eq("pause_reason", "inbound_reply")
              .lte("paused_at", cutoff);
          }

          let q = admin
            .from("crm_contact_sequences")
            .select(
              "id,user_id,contact_id,sequence_id,current_step,next_send_at",
            )
            .eq("status", "active")
            .lte("next_send_at", new Date().toISOString())
            .order("next_send_at", { ascending: true })
            .limit(limit);
          if (userId) q = q.eq("user_id", userId);
          const { data: due, error } = await q;
          if (error) throw error;
          if (!due || due.length === 0) {
            return jsonResponse({ items: [] });
          }

          const seqIds = [...new Set(due.map((d: any) => d.sequence_id))];
          const contactIds = [...new Set(due.map((d: any) => d.contact_id))];

          const [seqsRes, stepsRes, contactsRes] = await Promise.all([
            admin
              .from("crm_sequences")
              .select(
                "id,name,is_active,window_start_hour,window_end_hour,window_days",
              )
              .in("id", seqIds),
            admin
              .from("crm_sequence_steps")
              .select('id,sequence_id,"order",message,delay_value,delay_unit')
              .in("sequence_id", seqIds),
            admin
              .from("crm_contacts")
              .select("id,name,phone,email,category_id")
              .in("id", contactIds),
          ]);
          if (seqsRes.error) throw seqsRes.error;
          if (stepsRes.error) throw stepsRes.error;
          if (contactsRes.error) throw contactsRes.error;

          const seqMap = new Map((seqsRes.data ?? []).map((s: any) => [s.id, s]));
          const contactMap = new Map(
            (contactsRes.data ?? []).map((c: any) => [c.id, c]),
          );
          const stepsBySeq = new Map<string, any[]>();
          (stepsRes.data ?? []).forEach((s: any) => {
            const arr = stepsBySeq.get(s.sequence_id) ?? [];
            arr.push(s);
            stepsBySeq.set(s.sequence_id, arr);
          });

          const items = due
            .map((d: any) => {
              const seq = seqMap.get(d.sequence_id) as any;
              const contact = contactMap.get(d.contact_id) as any;
              if (!seq || !contact || !seq.is_active) return null;
              if (!inWindow(seq)) return null;
              const steps = (stepsBySeq.get(d.sequence_id) ?? []).sort(
                (a: any, b: any) => a.order - b.order,
              );
              const step = steps.find((s: any) => s.order === d.current_step);
              if (!step) return null;
              const message = applyVars(step.message, {
                nome: contact.name ?? "",
                empresa: contact.email ?? "", // placeholder, mapear depois
              });
              return {
                contact_sequence_id: d.id,
                user_id: d.user_id,
                sequence_id: d.sequence_id,
                sequence_name: seq.name,
                step_order: d.current_step,
                contact: {
                  id: contact.id,
                  name: contact.name,
                  phone: contact.phone,
                  email: contact.email,
                },
                message,
              };
            })
            .filter(Boolean);

          return jsonResponse({ items });
        } catch (err: any) {
          console.error("[sequences/due]", err);
          return jsonResponse({ error: err?.message ?? "Internal error" }, 500);
        }
      },
    },
  },
});
