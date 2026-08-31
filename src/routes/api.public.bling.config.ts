// /api/public/bling/config — credenciais + status da integração Bling (JWT obrigatório).
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, requireUserJwt, PUBLIC_CORS } from "@/integrations/supabase/server";
import {
  BLING_AUTH_URL,
  blingRedirectUri,
  deleteSecret,
  getSecret,
  setSecret,
} from "@/server/bling.server";

function mask(v: string) {
  if (v.length <= 8) return "•".repeat(Math.max(v.length, 4));
  return `${v.slice(0, 4)}${"•".repeat(8)}${v.slice(-4)}`;
}

async function status(userId: string) {
  const [id, secret, tokens] = await Promise.all([
    getSecret(userId, "BLING_CLIENT_ID"),
    getSecret(userId, "BLING_CLIENT_SECRET"),
    getSecret(userId, "BLING_TOKENS"),
  ]);
  let connected = false;
  let expiresAt: string | null = null;
  if (tokens) {
    try {
      const t = JSON.parse(tokens);
      connected = Boolean(t?.access_token);
      expiresAt = t?.expires_at ? new Date(t.expires_at).toISOString() : null;
    } catch {
      connected = false;
    }
  }
  return {
    hasCredentials: Boolean(id && secret),
    clientIdMasked: id ? mask(id) : null,
    clientSecretMasked: secret ? mask(secret) : null,
    connected,
    expiresAt,
  };
}

export const Route = createFileRoute("/api/public/bling/config")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),

      GET: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
        try {
          return jsonResponse({
            ok: true,
            ...(await status(auth.userId)),
            redirectUri: blingRedirectUri(request),
          });
        } catch (err: any) {
          return jsonResponse({ ok: false, error: err?.message ?? "erro" }, 500);
        }
      },

      POST: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
        let body: any = {};
        try {
          body = await request.json();
        } catch {}
        const action = String(body?.action ?? "save");

        try {
          if (action === "disconnect") {
            await deleteSecret(auth.userId, "BLING_TOKENS");
            return jsonResponse({ ok: true, ...(await status(auth.userId)) });
          }

          if (action === "authorize") {
            const clientId = await getSecret(auth.userId, "BLING_CLIENT_ID");
            if (!clientId) return jsonResponse({ ok: false, error: "Configure o Client ID primeiro" }, 400);
            const state = crypto.randomUUID().replace(/-/g, "");
            await setSecret(auth.userId, "BLING_OAUTH_STATE", state);
            const redirectUri = blingRedirectUri(request);
            const url = `${BLING_AUTH_URL}?response_type=code&client_id=${encodeURIComponent(
              clientId,
            )}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
            return jsonResponse({ ok: true, url, redirectUri });
          }

          const clientId = String(body?.clientId ?? "").trim();
          const clientSecret = String(body?.clientSecret ?? "").trim();
          if (clientId) await setSecret(auth.userId, "BLING_CLIENT_ID", clientId);
          if (clientSecret) await setSecret(auth.userId, "BLING_CLIENT_SECRET", clientSecret);
          if (!clientId && !clientSecret) {
            return jsonResponse({ ok: false, error: "Informe Client ID e Client Secret" }, 400);
          }
          return jsonResponse({
            ok: true,
            ...(await status(auth.userId)),
            redirectUri: blingRedirectUri(request),
          });
        } catch (err: any) {
          return jsonResponse({ ok: false, error: err?.message ?? "erro" }, 500);
        }
      },
    },
  },
});
