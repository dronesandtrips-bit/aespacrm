// Integração Bling v3 (Propostas Comerciais) — server-side.
// Credenciais e tokens ficam no cofre aespacrm.crm_app_secrets (service_role).
import { getSupabaseAdmin } from "@/integrations/supabase/server";

export const BLING_API = "https://api.bling.com.br/Api/v3";
export const BLING_AUTH_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";
export const BLING_TOKEN_URL = "https://www.bling.com.br/Api/v3/oauth/token";

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
  const proxyUrl = (process.env.BLING_TOKEN_PROXY_URL ?? "").trim();

  let res: Response | null = null;
  let raw = "";
  let status = 0;

  if (proxyUrl) {
    // O endpoint de tokens do Bling bloqueia o IP de saída do runtime do CRM
    // com Cloudflare 1015. A troca é feita pela VPS dedicada do ZapCRM.
    res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        authorization: `Basic ${basic}`,
        grant_type: body.grant_type ?? "",
        code: body.code ?? "",
        redirect_uri: body.redirect_uri ?? "",
        refresh_token: body.refresh_token ?? "",
      }),
    });
    raw = await res.text();
    status = res.status;
  } else {
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
      status = res.status;
      if (status !== 429 && status !== 503) break;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }

  let json: any = {};
  try {
    json = JSON.parse(raw);
  } catch {}
  // O HTTP Request do n8n retorna a resposta completa em { body, statusCode }.
  if (proxyUrl && json?.body) {
    status = Number(json.statusCode ?? status);
    json = json.body;
  }
  if (!res || !res.ok || status >= 400 || !json?.access_token) {
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

/**
 * Extrai um telefone/WhatsApp BR de um texto livre (Introdução, Observações etc.).
 * Aceita formatos: (54) 99149-5959, 54 9 9149-5959, 54991495959, +55 54 9149-5959...
 */
export function extractBrPhoneFromText(text: string | null | undefined): string {
  const src = String(text ?? "");
  if (!src) return "";
  const matches =
    src.match(/(?:\+?55[\s.\-/]?)?\(?\d{2}\)?[\s.\-/]?9?\s?\d{4}[\s.\-/]?\d{4}/g) ?? [];
  for (const m of matches) {
    const p = normalizeBrPhone(m);
    if (p) return p;
  }
  return "";
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
  phoneFonte: "cadastro" | "texto" | null; // de onde veio o telefone
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
        phoneFonte: null,
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
      p.phoneFonte = d.phone ? "cadastro" : null;
      p.email = d.email;
      if (d.nome) p.nome = d.nome;
    }
  }

  // Fallback: propostas sem telefone (ou sem nome) no cadastro do contato —
  // abre a proposta e varre TODOS os campos de texto do payload em busca de
  // um WhatsApp e de um nome de cliente.
  const semFone = out.filter((p) => p.id && (!p.phone || !p.nome || p.nome === "Sem nome"));
  const detQueue = [...semFone];
  const detWorkers = Array.from({ length: Math.min(4, detQueue.length) }, async () => {
    while (detQueue.length) {
      const p = detQueue.shift();
      if (!p) break;
      try {
        const res: any = await blingGet(token, `/propostas-comerciais/${p.id}`);
        const d = res?.data ?? {};

        // Nome: contato da proposta (mesmo sem cadastro completo)
        const nomeDet =
          d?.contato?.nome ?? d?.cliente?.nome ?? d?.nomeContato ?? d?.nome ?? null;
        if ((!p.nome || p.nome === "Sem nome") && nomeDet) p.nome = String(nomeDet);

        if (!p.phone) {
          // 1) campos estruturados de telefone em qualquer nível do payload
          const phoneKeys = ["celular", "telefone", "fone", "whatsapp"];
          const collected: string[] = [];
          const walk = (node: any, depth = 0) => {
            if (!node || depth > 6) return;
            if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
            if (typeof node !== "object") return;
            for (const [k, v] of Object.entries(node)) {
              if (typeof v === "string" && phoneKeys.some((pk) => k.toLowerCase().includes(pk))) {
                collected.push(v);
              } else if (v && typeof v === "object") {
                walk(v, depth + 1);
              }
            }
          };
          walk(d);
          for (const c of collected) {
            const norm = normalizeBrPhone(c);
            if (norm) {
              p.phone = norm;
              p.phoneRaw = c;
              p.phoneFonte = "cadastro";
              break;
            }
          }
        }

        if (!p.phone) {
          // 2) varredura de texto livre em todo o payload (Introdução, Observações,
          //    descrições de itens, campos personalizados etc.)
          const texts: string[] = [];
          const walkText = (node: any, depth = 0) => {
            if (!node || depth > 6) return;
            if (typeof node === "string") return void texts.push(node);
            if (Array.isArray(node)) return node.forEach((n) => walkText(n, depth + 1));
            if (typeof node === "object") Object.values(node).forEach((v) => walkText(v, depth + 1));
          };
          // prioriza os campos de texto "editoriais" da proposta
          const prio = [d?.introducao, d?.observacoes, d?.observacoesInternas, d?.observacao]
            .filter(Boolean)
            .join("\n");
          walkText(d);
          const phone =
            extractBrPhoneFromText(prio) || extractBrPhoneFromText(texts.join("\n"));
          if (phone) {
            p.phone = phone;
            p.phoneRaw = phone;
            p.phoneFonte = "texto";
          }
        }
      } catch {
        // ignora — proposta segue sem telefone
      }
    }
  });
  await Promise.all(detWorkers);

  return out;
}
