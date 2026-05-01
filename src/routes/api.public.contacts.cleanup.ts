// POST /api/public/contacts/cleanup
// Hard-delete de contatos lixo em aespacrm.crm_contacts:
//   - phone_norm vazio / não numérico
//   - phone_norm fora de E.164 (10–15 dígitos)
//   - name contendo '@' (parece JID)
// Cascata via FK on delete cascade remove crm_messages, crm_contact_sequences etc.
//
// Auth: header x-api-key === N8N_API_KEY (mesma chave do contact-enrich).
// Suporta ?dryRun=1 para apenas contar sem apagar.

import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

export const Route = createFileRoute("/api/public/contacts/cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.N8N_API_KEY?.trim();
        if (!apiKey) {
          return jsonResponse({ ok: false, error: "N8N_API_KEY ausente" }, 500);
        }
        const got = request.headers.get("x-api-key");
        if (!got || got !== apiKey) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }

        const url = new URL(request.url);
        const dryRun = url.searchParams.get("dryRun") === "1";

        const sb = getSupabaseAdmin();

        // Busca todos os contatos e filtra em JS (postgrest não tem regex fácil em todas as instâncias).
        const { data: all, error } = await sb
          .from("crm_contacts")
          .select("id,name,phone,phone_norm");
        if (error) {
          return jsonResponse({ ok: false, error: error.message }, 500);
        }

        const isE164 = (p: string | null | undefined) =>
          !!p && /^\d{10,15}$/.test(p);
        const looksLikeJidName = (n: string | null | undefined) =>
          !!n && (String(n).includes("@") || /^\d{14,}$/.test(String(n).trim()));

        const trash = (all ?? []).filter((c: any) => {
          const badPhone = !isE164(c.phone_norm) && !isE164(c.phone);
          const badName = looksLikeJidName(c.name);
          return badPhone || badName;
        });

        if (dryRun) {
          return jsonResponse({
            ok: true,
            dryRun: true,
            total: all?.length ?? 0,
            wouldDelete: trash.length,
            sample: trash.slice(0, 10).map((c: any) => ({
              id: c.id,
              name: c.name,
              phone_norm: c.phone_norm,
            })),
          });
        }

        if (trash.length === 0) {
          return jsonResponse({ ok: true, deleted: 0, total: all?.length ?? 0 });
        }

        // Apaga em lotes de 200 ids (cascade cuida das mensagens / sequências).
        const ids = trash.map((c: any) => c.id);
        let deleted = 0;
        for (let i = 0; i < ids.length; i += 200) {
          const batch = ids.slice(i, i + 200);
          const { error: delErr, count } = await sb
            .from("crm_contacts")
            .delete({ count: "exact" })
            .in("id", batch);
          if (delErr) {
            return jsonResponse(
              { ok: false, error: delErr.message, deleted },
              500,
            );
          }
          deleted += count ?? batch.length;
        }

        return jsonResponse({
          ok: true,
          deleted,
          remaining: (all?.length ?? 0) - deleted,
        });
      },
    },
  },
});
