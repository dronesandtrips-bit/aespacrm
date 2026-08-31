// Integração Bling v3 (Propostas Comerciais) — server-side.
// Credenciais e tokens ficam no cofre aespacrm.crm_app_secrets (service_role).
import { getSupabaseAdmin } from "@/integrations/supabase/server";

export const BLING_API = "https://api.bling.com.br/Api/v3";
export const BLING_AUTH_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";
export const BLING_TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";

export const BLING_SECRET_NAMES = [
  "BLING_CLIENT_ID",
  "BLING_CLIENT_SECRET",
  "BLING_TOKENS",
  "BLING_OAUTH_STATE",
] as const;

export type BlingTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
};

export async function getSecret(userId: string, name: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("crm_app_secrets")
    .select("value")
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();
  return data?.value ? String(data.value) : null;
}

export async function setSecret(userId: string, name: string, value: string) {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("crm_app_secrets").upsert(
    { user_id: userId, name, value, updated_at: new Date().toISOString() },
    { onConflict: "user_id,name" },
  );
  if (error) throw new Error(error.message);
}

export async function deleteSecret(userId: string, name: string) {
  const admin = getSupabaseAdmin();
  await admin.from("crm_app_secrets").delete().eq("user_id", userId).eq("name", name);
}

/** URL pública do CRM (usada como redirect_uri do OAuth do Bling). */
export const BLING_PUBLIC_ORIGIN = "https://crm.aespa.com.br";

export function blingRedirectUri(request: Request): string {
  const configured = (process.env.BLING_REDIRECT_URI ?? "").trim();
  if (configured) return configured;
  const origin = new URL(request.url).origin;
  // Domínios de preview/localhost não estão cadastrados no app do Bling —
  // usa sempre a URL pública para o redirect_uri bater com o cadastro.
  const isPublic = origin === BLING_PUBLIC_ORIGIN;
  return `${isPublic ? origin : BLING_PUBLIC_ORIGIN}/api/public/bling/callback`;
}

async function requestTokens(
  clientId: string,
  clientSecret: string,
  body: Record<string, string>,
): Promise<BlingTokens> {
  const basic = btoa(`${clientId}:${clientSecret}`);
  const payload = new URLSearchParams(body).toString();

  let res: Response | null = null;
  let raw = "";
  // O Bling fica atrás da Cloudflare: requisições sem User-Agent "de browser"
  // costumam levar 429 / error code 1015. Enviamos headers completos e
  // aplicamos retry com backoff quando ainda assim for limitado.
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(BLING_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ZapCRM/1.0",
      },
      body: payload,
    });
    raw = await res.text();
    if (res.status !== 429 && res.status !== 503) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }

  let json: any = {};
  try {
    json = JSON.parse(raw);
  } catch {}
  if (!res || !res.ok || !json?.access_token) {
    const status = res?.status ?? 0;
    if (status === 429) {
      throw new Error(
        "Bling recusou temporariamente a conexão (limite de requisições / proteção Cloudflare). Aguarde ~1 minuto e clique em Conectar novamente.",
      );
    }
    const err = json?.error ?? json?.errors?.[0];
    const detail =
      err?.description ?? err?.message ?? err?.type ?? (typeof err === "string" ? err : null) ?? raw.slice(0, 200) ?? `HTTP ${status}`;
    throw new Error(
      `Bling OAuth ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
    );
  }
  return {
    access_token: String(json.access_token),
    refresh_token: String(json.refresh_token ?? ""),
    expires_at: Date.now() + Number(json.expires_in ?? 3600) * 1000,
  };
}


export async function exchangeCode(userId: string, code: string, redirectUri: string) {
  const clientId = await getSecret(userId, "BLING_CLIENT_ID");
  const clientSecret = await getSecret(userId, "BLING_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Client ID/Secret do Bling não configurados");
  const tokens = await requestTokens(clientId, clientSecret, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  await setSecret(userId, "BLING_TOKENS", JSON.stringify(tokens));
  return tokens;
}

/** Retorna um access_token válido, renovando quando necessário. */
export async function getAccessToken(userId: string): Promise<string> {
  const raw = await getSecret(userId, "BLING_TOKENS");
  if (!raw) throw new Error("Bling não conectado");
  let tokens: BlingTokens;
  try {
    tokens = JSON.parse(raw);
  } catch {
    throw new Error("Tokens do Bling inválidos — reconecte");
  }
  if (tokens.expires_at - 60_000 > Date.now()) return tokens.access_token;

  const clientId = await getSecret(userId, "BLING_CLIENT_ID");
  const clientSecret = await getSecret(userId, "BLING_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Client ID/Secret do Bling não configurados");
  const fresh = await requestTokens(clientId, clientSecret, {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  if (!fresh.refresh_token) fresh.refresh_token = tokens.refresh_token;
  await setSecret(userId, "BLING_TOKENS", JSON.stringify(fresh));
  return fresh.access_token;
}

async function blingGet(token: string, path: string) {
  const res = await fetch(`${BLING_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ZapCRM/1.0",
    },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.error?.description ?? json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return json;
}

/** Normaliza telefone BR para o formato usado no CRM (com DDI 55). */
export function normalizeBrPhone(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12 || d.length > 13) return "";
  return d;
}

export type BlingProposal = {
  id: string;
  numero: string | null;
  data: string | null;
  total: number | null;
  situacao: string | null;
  contatoId: string | null;
  nome: string;
  phone: string; // normalizado (pode vir vazio)
  phoneRaw: string | null;
  email: string | null;
};

/**
 * Lista propostas comerciais recentes com os dados de contato resolvidos.
 * `dias` filtra por data inicial; `limite` limita o total retornado.
 */
export async function listProposals(
  userId: string,
  opts: { dias?: number; limite?: number } = {},
): Promise<BlingProposal[]> {
  const token = await getAccessToken(userId);
  const limite = Math.min(Math.max(opts.limite ?? 100, 1), 300);
  const dias = Math.min(Math.max(opts.dias ?? 90, 1), 720);
  const since = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

  const out: BlingProposal[] = [];
  for (let pagina = 1; pagina <= 5 && out.length < limite; pagina++) {
    const qs = new URLSearchParams({
      pagina: String(pagina),
      limite: "100",
      dataInicial: since,
    });
    const page: any = await blingGet(token, `/propostas-comerciais?${qs.toString()}`);
    const items: any[] = page?.data ?? [];
    if (!items.length) break;
    for (const it of items) {
      const contato = it?.contato ?? {};
      out.push({
        id: String(it?.id ?? ""),
        numero: it?.numero != null ? String(it.numero) : null,
        data: it?.data ?? it?.dataEmissao ?? null,
        total: typeof it?.total === "number" ? it.total : Number(it?.total ?? 0) || null,
        situacao: it?.situacao?.valor != null ? String(it.situacao.valor) : (it?.situacao ?? null),
        contatoId: contato?.id != null ? String(contato.id) : null,
        nome: String(contato?.nome ?? it?.contato?.nome ?? "Sem nome"),
        phone: "",
        phoneRaw: null,
        email: null,
      });
      if (out.length >= limite) break;
    }
    if (items.length < 100) break;
  }

  // Resolve telefone/e-mail dos contatos (cache por contatoId, concorrência 4)
  const ids = Array.from(new Set(out.map((p) => p.contatoId).filter(Boolean))) as string[];
  const details = new Map<string, { phone: string; raw: string | null; email: string | null; nome?: string }>();
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      try {
        const res: any = await blingGet(token, `/contatos/${id}`);
        const d = res?.data ?? {};
        const raw = d?.celular || d?.telefone || null;
        details.set(id, {
          phone: normalizeBrPhone(raw),
          raw: raw ? String(raw) : null,
          email: d?.email ? String(d.email) : null,
          nome: d?.nome ? String(d.nome) : undefined,
        });
      } catch {
        details.set(id, { phone: "", raw: null, email: null });
      }
    }
  });
  await Promise.all(workers);

  for (const p of out) {
    const d = p.contatoId ? details.get(p.contatoId) : null;
    if (d) {
      p.phone = d.phone;
      p.phoneRaw = d.raw;
      p.email = d.email;
      if (d.nome) p.nome = d.nome;
    }
  }
  return out;
}
