// GET /api/public/widget/config/:id
// Retorna config visual pública do widget (sem dados sensíveis).
// Usado pela página /widget/form/:id (iframe) para renderizar o form.
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, PUBLIC_CORS, jsonResponse } from "@/integrations/supabase/server";

export const Route = createFileRoute("/api/public/widget/config/$id")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      GET: async ({ params }) => {
        try {
          const id = params.id;
          if (!id || id.length > 64) return jsonResponse({ error: "Invalid id" }, 400);
          const admin = getSupabaseAdmin();
          const { data, error } = await admin
            .from("crm_capture_widgets")
            .select("id,title,subtitle,button_text,primary_color,success_message,is_active")
            .eq("id", id)
            .maybeSingle();
          if (error) throw error;
          if (!data || !data.is_active) return jsonResponse({ error: "Not found" }, 404);
          return jsonResponse({
            id: data.id,
            title: data.title,
            subtitle: data.subtitle,
            buttonText: data.button_text,
            primaryColor: data.primary_color,
            successMessage: data.success_message,
          });
        } catch (err: any) {
          console.error("[widget/config]", err);
          return jsonResponse({ error: err?.message ?? "Internal" }, 500);
        }
      },
    },
  },
});
