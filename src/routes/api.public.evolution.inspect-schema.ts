// GET /api/public/evolution/inspect-schema
// Endpoint TEMPORÁRIO para inspecionar o schema aespacrm e checar tabelas.
// Remover após Etapa 3.
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

export const Route = createFileRoute("/api/public/evolution/inspect-schema")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const sb = getSupabaseAdmin();
          // Lista tabelas do schema aespacrm
          const { data: tables, error: e1 } = await sb
            .schema("information_schema" as any)
            .from("tables")
            .select("table_name")
            .eq("table_schema", "aespacrm");
          if (e1) return jsonResponse({ ok: false, step: "tables", error: e1.message }, 500);

          // Colunas de crm_mensagens (se existir)
          const { data: cols, error: e2 } = await sb
            .schema("information_schema" as any)
            .from("columns")
            .select("column_name,data_type,is_nullable")
            .eq("table_schema", "aespacrm")
            .eq("table_name", "crm_mensagens");
          if (e2) return jsonResponse({ ok: false, step: "columns", error: e2.message }, 500);

          return jsonResponse({
            ok: true,
            tables: (tables ?? []).map((t: any) => t.table_name).sort(),
            crm_mensagens_exists: (cols ?? []).length > 0,
            crm_mensagens_columns: cols ?? [],
          });
        } catch (err: any) {
          return jsonResponse({ ok: false, error: err?.message ?? String(err) }, 500);
        }
      },
    },
  },
});
