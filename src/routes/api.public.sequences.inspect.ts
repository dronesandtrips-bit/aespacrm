// GET /api/public/sequences/inspect?name=<partial>
// Diagnóstico: retorna config da sequência + contatos ativos e seus next_send_at.
// Header obrigatório: x-api-key: <N8N_API_KEY>
import { createFileRoute } from "@tanstack/react-router";
import {
  getSupabaseAdmin,
  checkApiKey,
  PUBLIC_CORS,
  jsonResponse,
} from "@/integrations/supabase/server";

export const Route = createFileRoute("/api/public/sequences/inspect")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      GET: async ({ request }) => {
        if (!checkApiKey(request)) return jsonResponse({ error: "Unauthorized" }, 401);
        try {
          const url = new URL(request.url);
          const name = (url.searchParams.get("name") ?? "").trim();
          const admin = getSupabaseAdmin();

          let sq = admin
            .from("crm_sequences")
            .select("id,name,is_active,window_start_hour,window_end_hour,window_days,auto_resume_after_days,user_id");
          if (name) sq = sq.ilike("name", `%${name}%`);
          const { data: seqs, error: e1 } = await sq;
          if (e1) throw e1;
          if (!seqs?.length) return jsonResponse({ sequences: [] });

          const seqIds = seqs.map((s: any) => s.id);
          const since = new Date(Date.now() - 7 * 86400_000).toISOString();
          const [{ data: cs }, { data: steps }, { data: logs }] = await Promise.all([
            admin
              .from("crm_contact_sequences")
              .select("id,sequence_id,contact_id,current_step,status,next_send_at,paused_at,pause_reason")
              .in("sequence_id", seqIds)
              .order("next_send_at", { ascending: true })
              .limit(500),
            admin
              .from("crm_sequence_steps")
              .select('id,sequence_id,"order",delay_value,delay_unit')
              .in("sequence_id", seqIds),
            admin
              .from("crm_sequence_send_log")
              .select("id,contact_sequence_id,step_order,status,error,created_at")
              .gte("created_at", since)
              .order("created_at", { ascending: false })
              .limit(200),
          ]);

          const now = new Date();
          const brtNow = new Date(now.getTime() - 3 * 3600_000);

          const out = seqs.map((s: any) => {
            const contacts = (cs ?? []).filter((c: any) => c.sequence_id === s.id);
            const byStatus: Record<string, number> = {};
            for (const c of contacts) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
            return {
              id: s.id,
              name: s.name,
              is_active: s.is_active,
              window_days: s.window_days,
              window_start_hour: s.window_start_hour,
              window_end_hour: s.window_end_hour,
              auto_resume_after_days: s.auto_resume_after_days,
              steps: (steps ?? []).filter((x: any) => x.sequence_id === s.id).sort((a: any, b: any) => a.order - b.order),
              contacts_count: contacts.length,
              contacts_by_status: byStatus,
              contacts: contacts.slice(0, 50),
            };
          });

          return jsonResponse({
            now_utc: now.toISOString(),
            now_brt: brtNow.toISOString().replace("Z", "-03:00"),
            brt_dow: brtNow.getUTCDay(),
            brt_hour: brtNow.getUTCHours(),
            recent_send_log: logs ?? [],
            sequences: out,
          });
        } catch (err: any) {
          console.error("[sequences/inspect]", err);
          return jsonResponse({ error: err?.message ?? "Internal error" }, 500);
        }
      },
    },
  },
});
