// POST /api/public/optout/info
// Recebe { token } e devolve dados mínimos para a página de confirmação
// renderizar (telefone mascarado, estado atual).
// Não muta nada — seguro contra pre-fetch de antivírus/WhatsApp preview.
import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_CORS, jsonResponse, getSupabaseAdmin } from "@/integrations/supabase/server";
import { verifyOptoutToken } from "@/server/optout.server";

function maskPhone(phone: string): string {
  const d = String(phone).replace(/\D/g, "");
  if (d.length < 4) return d;
  const tail = d.slice(-4);
  const masked = "•".repeat(Math.max(0, d.length - 4));
  // Formato BR: 55 54 99613-7255 → •• •• •••••-7255
  return `${masked.slice(0, 2)} ${masked.slice(2, 4)} ${masked.slice(4)}-${tail}`.trim();
}

export const Route = createFileRoute("/api/public/optout/info")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        try {
          const { token } = await request.json().catch(() => ({}));
          if (!token || typeof token !== "string") {
            return jsonResponse({ ok: false, error: "missing token" }, 400);
          }
          const verified = await verifyOptoutToken(token);
          if (!verified) {
            return jsonResponse({ ok: false, error: "invalid token" }, 400);
          }
          const sb = getSupabaseAdmin();
          const { data: black } = await sb
            .from("crm_ignored_phones")
            .select("id")
            .eq("user_id", verified.userId)
            .eq("phone_norm", verified.phone)
            .maybeSingle();
          // Busca o nome do contato (best effort, só para personalizar).
          const { data: contact } = await sb
            .from("crm_contacts")
            .select("name")
            .eq("user_id", verified.userId)
            .eq("phone_norm", verified.phone)
            .eq("is_group", false)
            .maybeSingle();
          const firstName = (contact?.name as string | undefined)?.trim().split(/\s+/)[0] ?? "";
          return jsonResponse({
            ok: true,
            phone_masked: maskPhone(verified.phone),
            already_opted_out: !!black?.id,
            first_name: firstName,
          });
        } catch (err: any) {
          console.error("[optout/info]", err);
          return jsonResponse({ ok: false, error: "internal error" }, 500);
        }
      },
    },
  },
});
