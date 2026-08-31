// /api/public/bling/callback — retorno do OAuth do Bling.
// Identifica o usuário pelo `state` salvo no cofre e troca o code por tokens.
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin } from "@/integrations/supabase/server";
import { blingRedirectUri, deleteSecret, exchangeCode } from "@/server/bling.server";

function redirect(to: string) {
  return new Response(null, { status: 302, headers: { Location: to } });
}

export const Route = createFileRoute("/api/public/bling/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        if (!code || !state) return redirect("/configuracoes?bling=erro&msg=code_ausente");

        try {
          const admin = getSupabaseAdmin();
          const { data } = await admin
            .from("crm_app_secrets")
            .select("user_id")
            .eq("name", "BLING_OAUTH_STATE")
            .eq("value", state)
            .maybeSingle();
          const userId = data?.user_id ? String(data.user_id) : "";
          if (!userId) return redirect("/configuracoes?bling=erro&msg=state_invalido");

          await exchangeCode(userId, code, blingRedirectUri(request));
          await deleteSecret(userId, "BLING_OAUTH_STATE");
          return redirect("/configuracoes?bling=ok");
        } catch (err: any) {
          const msg = encodeURIComponent(String(err?.message ?? "falha").slice(0, 120));
          return redirect(`/configuracoes?bling=erro&msg=${msg}`);
        }
      },
    },
  },
});
