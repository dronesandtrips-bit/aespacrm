// /api/public/settings/secret
// Cofre de segredos do CRM (ex.: Global API Key da Evolution).
//
// Segurança:
//  * Exige JWT do usuário logado (sem atalho por x-api-key).
//  * O valor NUNCA é devolvido — apenas máscara + data de atualização.
//  * Gravação/leitura via service_role (tabela sem grants para authenticated).
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, requireUserJwt, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

/** Nomes permitidos no cofre (allowlist). */
const ALLOWED = new Set(["EVOLUTION_GLOBAL_API_KEY"]);

function mask(value: string) {
  const v = String(value ?? "");
  if (v.length <= 8) return "•".repeat(Math.max(v.length, 4));
  return `${v.slice(0, 4)}${"•".repeat(8)}${v.slice(-4)}`;
}

async function loadMeta(userId: string, name: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("crm_app_secrets")
    .select("value,updated_at")
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { configured: false, masked: null, updatedAt: null };
  return { configured: true, masked: mask(data.value), updatedAt: data.updated_at };
}

/** Testa a chave contra a Evolution API (endpoint global de instâncias). */
async function testEvolutionKey(key: string) {
  const url = (process.env.EVOLUTION_API_URL ?? "").replace(/\/+$/, "");
  if (!url) return { ok: false, error: "EVOLUTION_API_URL não configurada" };
  try {
    const res = await fetch(`${url}/instance/fetchInstances`, {
      method: "GET",
      headers: { apikey: key, "Content-Type": "application/json" },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Chave rejeitada pela Evolution (401/403)" };
    if (!res.ok) return { ok: false, error: `Evolution respondeu ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "falha ao contatar a Evolution" };
  }
}

export const Route = createFileRoute("/api/public/settings/secret")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),

      // GET ?name=EVOLUTION_GLOBAL_API_KEY -> metadados (nunca o valor)
      GET: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
        const name = new URL(request.url).searchParams.get("name") ?? "";
        if (!ALLOWED.has(name)) return jsonResponse({ ok: false, error: "segredo não permitido" }, 400);
        try {
          return jsonResponse({ ok: true, name, ...(await loadMeta(auth.userId, name)) });
        } catch (err: any) {
          return jsonResponse({ ok: false, error: err?.message ?? "erro ao ler segredo" }, 500);
        }
      },

      // POST { name, value, test? } -> salva (upsert). DELETE lógico via action:"delete".
      POST: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);

        let body: any = {};
        try { body = await request.json(); } catch {}
        const name = String(body?.name ?? "");
        if (!ALLOWED.has(name)) return jsonResponse({ ok: false, error: "segredo não permitido" }, 400);

        const admin = getSupabaseAdmin();

        if (body?.action === "delete") {
          const { error } = await admin
            .from("crm_app_secrets")
            .delete()
            .eq("user_id", auth.userId)
            .eq("name", name);
          if (error) return jsonResponse({ ok: false, error: error.message }, 500);
          return jsonResponse({ ok: true, configured: false, masked: null, updatedAt: null });
        }

        const value = String(body?.value ?? "").trim();
        if (value.length < 8) return jsonResponse({ ok: false, error: "chave muito curta" }, 400);

        let test: { ok: boolean; error?: string } | null = null;
        if (body?.test !== false && name === "EVOLUTION_GLOBAL_API_KEY") {
          test = await testEvolutionKey(value);
          if (!test.ok && body?.force !== true) {
            return jsonResponse({ ok: false, error: test.error, testFailed: true }, 400);
          }
        }

        const { error } = await admin
          .from("crm_app_secrets")
          .upsert(
            { user_id: auth.userId, name, value, updated_at: new Date().toISOString() },
            { onConflict: "user_id,name" },
          );
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);

        try {
          return jsonResponse({ ok: true, test, ...(await loadMeta(auth.userId, name)) });
        } catch {
          return jsonResponse({ ok: true, test, configured: true, masked: mask(value), updatedAt: new Date().toISOString() });
        }
      },
    },
  },
});
