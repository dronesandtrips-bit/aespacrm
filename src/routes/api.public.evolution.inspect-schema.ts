// GET /api/public/evolution/inspect-schema (TEMPORÁRIO)
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

export const Route = createFileRoute("/api/public/evolution/inspect-schema")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const sb = getSupabaseAdmin();
          const tables = ["crm_mensagens", "crm_messages", "crm_conversas", "crm_chats", "crm_contatos", "crm_leads", "crm_disparos_log"];
          const results: Record<string, any> = {};
          for (const t of tables) {
            const { data, error } = await sb.from(t).select("*").limit(1);
            if (error) {
              results[t] = { exists: false, error: error.message, code: (error as any).code };
            } else {
              results[t] = { exists: true, sample_columns: data && data[0] ? Object.keys(data[0]) : [], row_count_sample: data?.length ?? 0 };
            }
          }
          return jsonResponse({ ok: true, schema: "aespacrm", tables: results });
        } catch (err: any) {
          return jsonResponse({ ok: false, error: err?.message ?? String(err) }, 500);
        }
      },
    },
  },
});
