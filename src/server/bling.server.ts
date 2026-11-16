// Integração Bling v3 (Propostas Comerciais) — server-side.
// Credenciais e tokens ficam no cofre aespacrm.crm_app_secrets (service_role).
import { getSupabaseAdmin } from "@/integrations/supabase/server";

export const BLING_API = "https://api.bling.com.br/Api/v3";
export const BLING_AUTH_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";
export const BLING_TOKEN_URL = "https://www.bling.com.br/Api/v3/oauth/token";

// O Bling aceita somente 3 chamadas por segundo. Todas as consultas desta
// instância passam pela mesma fila para propostas, contatos e detalhes não
// disputarem o limite e fazerem a primeira página voltar vazia.
let blingRequestQueue: Promise<void> = Promise.resolve();
let blingNextRequestAt = 0;

async function waitForBlingRequestSlot() {
  const previous = blingRequestQueue;
  let release: (() => void) | undefined;
  blingRequestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const waitMs = Math.max(0, blingNextRequestAt - Date.now());
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  blingNextRequestAt = Date.now() + 360;
  release?.();
}

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
  let res: Response | null = null;
  let json: any = {};
  // O Bling limita requisições (429). Sem retry, os detalhes das propostas
  // falhavam silenciosamente e nome/telefone ficavam vazios.
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitForBlingRequestSlot();
    res = await fetch(`${BLING_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ZapCRM/1.0",
      },
    });
    json = await res.json().catch(() => ({}));
    if (res.status !== 429 && res.status !== 503) break;
    const retryAfter = Number(res.headers.get("retry-after") ?? 0);
    const retryMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1);
    await new Promise((r) => setTimeout(r, retryMs));
  }

  if (!res || !res.ok) {
    if (!res) throw new Error("Bling não respondeu à consulta");
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
 * Aceita formatos: (54) 99149-5959, 54 9 9149-5959, 54991495959, +55 54 9149-5959,
 * 54.99149.5959, 54 99149 5959, "Fone: 5499149-5959" etc.
 */
export function extractBrPhoneFromText(text: string | null | undefined): string {
  // normaliza separadores exóticos (nbsp, traços unicode, bullets)
  const src = String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u2010-\u2015]/g, "-");
  if (!src) return "";
  const SEP = "[\\s.\\-/_]*";
  const patterns = [
    // com DDI opcional + DDD + 8/9 dígitos
    new RegExp(`(?:\\+?55${SEP})?\\(?\\d{2}\\)?${SEP}9?${SEP}\\d{4}${SEP}\\d{4}`, "g"),
    // bloco contínuo de exatamente 10 ou 11 dígitos (evita casar datas/IDs)
    /(?<!\d)\d{10,11}(?!\d)/g,
  ];
  for (const re of patterns) {
    const matches = src.match(re) ?? [];
    for (const m of matches) {
      const p = normalizeBrPhone(m);
      if (p) return p;
    }
  }
  return "";
}

/** Tenta achar um nome de cliente em texto livre (ex.: "Cliente: Fulano"). */
export function extractNameFromText(text: string | null | undefined): string {
  const src = String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ");
  const m = src.match(
    /(?:cliente|contato|nome|resp(?:ons[áa]vel)?)\s*[:\-]\s*([\p{L}][\p{L}\s.'&-]{2,60})/iu,
  );
  if (m) return m[1].replace(/\s+/g, " ").trim();
  // Fallback: texto livre no formato "Eldorado Caxias 5551996690395" —
  // remove números/telefones e usa o trecho de palavras restante como nome.
  const firstLine = src.split(/[\n;|]/).map((s) => s.trim()).find(Boolean) ?? "";
  const cleaned = firstLine
    .replace(/(?:\+?55)?[\s().\-/_]*\d[\d\s().\-/_]{7,}/g, " ")
    .replace(/[^\p{L}\s.'&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const noPrefix = cleaned
    .replace(/^(?:a\s*\/?\s*c|att\.?|aos?\s+cuidados\s+de|ref\.?|sr\.?|sra\.?)\s+/i, "")
    .trim();
  const final = noPrefix.length >= 3 ? noPrefix : cleaned;
  if (final.length >= 3 && /\p{L}{2,}/u.test(final)) return final.slice(0, 60);
  return "";
}


/** Extrai somente os dois últimos itens do campo Cliente da proposta. */
export function splitClienteField(value: string | null | undefined): { nome: string; phone: string; phoneRaw: string | null } {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { nome: "", phone: "", phoneRaw: null };
  const raw = parts[parts.length - 1];
  const nome = parts[parts.length - 2];
  if (!raw || !nome || !/^[\p{L}][\p{L}.'’–-]*$/u.test(nome) || !/^\+?\d[\d()./-]*$/.test(raw)) {
    return { nome: "", phone: "", phoneRaw: null };
  }
  const phone = normalizeBrPhone(raw);
  return { nome, phone, phoneRaw: phone ? raw : null };
}

/** Resolve o Cliente referenciado pela proposta, sem consultar textos ou telefones alheios ao campo. */
export async function resolveProposalCliente(
  proposal: { contato?: { id?: string | number; nome?: string }; cliente?: { id?: string | number; nome?: string } },
  readContact: (id: string) => Promise<{ nome?: string }>,
) {
  const contato = proposal.contato ?? proposal.cliente;
  const field = contato?.nome;
  if (field != null) return splitClienteField(field);
  if (contato?.id == null) return splitClienteField(null);
  const detail = await readContact(String(contato.id));
  return splitClienteField(detail.nome);
}

/** Payload cru de uma proposta — usado pelo diagnóstico da tela do Bling. */
export async function getProposalRaw(userId: string, id: string): Promise<any> {
  const token = await getAccessToken(userId);
  return blingGet(token, `/propostas-comerciais/${id}`);
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
  const t0 = Date.now();
  // Orçamento de tempo para o enriquecimento (detalhes de contato/proposta).
  // Sem isso, com muitos itens + retry de 429 a requisição nunca terminava
  // e a tela ficava carregando para sempre.
  const BUDGET_MS = 18_000;
  const outOfTime = () => Date.now() - t0 > BUDGET_MS;

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
      const cli = splitClienteField(contato?.nome ?? null);
      out.push({
        id: String(it?.id ?? ""),
        numero: it?.numero != null ? String(it.numero) : null,
        data: it?.data ?? it?.dataEmissao ?? null,
        total: typeof it?.total === "number" ? it.total : Number(it?.total ?? 0) || null,
        situacao: it?.situacao?.valor != null ? String(it.situacao.valor) : (it?.situacao ?? null),
        contatoId: contato?.id != null ? String(contato.id) : null,
        nome: cli.nome || "Sem nome",
        phone: cli.phone,
        phoneRaw: cli.phoneRaw,
        phoneFonte: cli.phone ? "texto" : null,
        email: null,
      });
      if (out.length >= limite) break;
    }
    if (items.length < 100) break;
  }

  // O Bling pode retornar apenas contato.id; consulta o nome desse mesmo Cliente.
  // Nunca usar Introdução, observações ou campos separados de telefone como reserva.
  const details = new Map<string, Promise<{ nome?: string }>>();
  const readContact = (id: string) => {
    let pending = details.get(id);
    if (!pending) {
      pending = blingGet(token, `/contatos/${id}`).then((res) => res?.data ?? {});
      details.set(id, pending);
    }
    return pending;
  };
  const queue = out.filter((p) => !p.phone).slice(0, 40);
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && !outOfTime()) {
      const p = queue.shift();
      if (!p) break;
      try {
        let proposal: { contato?: { id?: string | number; nome?: string }; cliente?: { id?: string | number; nome?: string } };
        if (p.contatoId) {
          proposal = { contato: { id: p.contatoId } };
        } else {
          const res = await blingGet(token, `/propostas-comerciais/${p.id}`);
          proposal = res?.data ?? {};
        }
        const cli = await resolveProposalCliente(proposal, readContact);
        p.nome = cli.nome || "Sem nome";
        p.phone = cli.phone;
        p.phoneRaw = cli.phoneRaw;
        p.phoneFonte = cli.phone ? "texto" : null;
      } catch {
        // Falha de leitura mantém destinatário vazio, sem aproveitar outros campos.
      }
    }
  });
  await Promise.all(workers);

  return out;
}

// ===================== Contatos (clientes/fornecedores) =====================

export type BlingContact = {
  id: string;
  nome: string;
  phone: string; // normalizado (pode vir vazio)
  phoneRaw: string | null;
  email: string | null;
  documento: string | null; // CPF/CNPJ só dígitos
  tipo: string | null;
};

/** Só dígitos do CPF/CNPJ (usado para casar contato ↔ proposta sem duplicar). */
export function onlyDigits(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Normaliza nome para comparação (sem acento, minúsculo, espaços colapsados). */
export function normalizeName(v: string | null | undefined): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tipos de contato cadastrados no Bling (Cliente, Fornecedor, Transportador…).
 * Usado para importar apenas clientes (quem recebe nota de saída).
 */
export async function listContactTypes(
  token: string,
): Promise<{ id: string; descricao: string }[]> {
  try {
    const res: any = await blingGet(token, `/contatos/tipos-contato`);
    const items: any[] = res?.data ?? [];
    return items.map((t) => ({ id: String(t?.id ?? ""), descricao: String(t?.descricao ?? "") }));
  } catch {
    return [];
  }
}

/**
 * Lista contatos cadastrados no Bling.
 * - `apenasClientes`: filtra pelos tipos de contato "Cliente" (exclui quem é só fornecedor).
 * - `comDocumento`: mantém apenas quem tem CPF (11) ou CNPJ (14) cadastrado.
 */
export async function listContacts(
  userId: string,
  opts: { limite?: number; apenasClientes?: boolean; comDocumento?: boolean; busca?: string } = {},
): Promise<BlingContact[]> {
  const token = await getAccessToken(userId);
  const limite = Math.min(Math.max(opts.limite ?? 2000, 1), 5000);
  const busca = String(opts.busca ?? "").trim().slice(0, 120);
  const out: BlingContact[] = [];

  // Antes filtrávamos pelos tipos "Cliente" — mas a maioria dos cadastros não tem
  // essa marcação, então quase todo mundo ficava de fora. Agora trazemos TODOS os
  // cadastros e removemos apenas quem é exclusivamente fornecedor.
  const fornecedorIds = new Set<string>();
  if (opts.apenasClientes) {
    let tipos: { id: string; descricao: string }[] = [];
    try {
      tipos = await listContactTypes(token);
    } catch (err) {
      console.warn("[bling] falha ao listar tipos de contato:", (err as any)?.message ?? err);
    }
    const soFornecedor = tipos
      .filter((t) => /fornecedor/i.test(t.descricao) && !/cliente/i.test(t.descricao))
      .map((t) => t.id)
      .filter(Boolean);
    for (const tipoId of soFornecedor) {
      for (let pagina = 1; pagina <= 10; pagina++) {
        const qs = new URLSearchParams({
          pagina: String(pagina),
          limite: "100",
          idTipoContato: tipoId,
        });
        if (busca) qs.set("criterio", busca);
        let items: any[] = [];
        try {
          const page: any = await blingGet(token, `/contatos?${qs.toString()}`);
          items = page?.data ?? [];
        } catch {
          break;
        }
        for (const d of items) if (d?.id) fornecedorIds.add(String(d.id));
        if (items.length < 100) break;
      }
    }
  }

  const seenIds = new Set<string>();
  const deadline = Date.now() + 20000; // orçamento de tempo para não estourar o gateway
  for (let pagina = 1; pagina <= 60 && out.length < limite; pagina++) {
    const qs = new URLSearchParams({ pagina: String(pagina), limite: "100" });
    if (busca) qs.set("criterio", busca);
    let items: any[] = [];
    try {
      const page: any = await blingGet(token, `/contatos?${qs.toString()}`);
      items = page?.data ?? [];
    } catch (err) {
      console.warn(`[bling] falha ao listar página ${pagina}:`, (err as any)?.message ?? err);
      // Nunca transforma falha da primeira página em uma lista válida com 0
      // contatos. Assim a tela pode preservar o resultado anterior e tentar de novo.
      if (pagina === 1) throw err;
      break; // devolve o que já foi coletado em vez de derrubar a requisição
    }
    if (!items.length) break;
    for (const d of items) {
      const id = String(d?.id ?? "");
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      if (id && fornecedorIds.has(id)) continue;
      const raw = d?.celular || d?.telefone || null;
      out.push({
        id,
        nome: String(d?.nome ?? "Sem nome"),
        phone: normalizeBrPhone(raw),
        phoneRaw: raw ? String(raw) : null,
        email: d?.email ? String(d.email) : null,
        documento: onlyDigits(d?.numeroDocumento ?? d?.cpfCnpj ?? d?.documento) || null,
        tipo: d?.tipo ? String(d.tipo) : null,
      });
      if (out.length >= limite) break;
    }
    if (items.length < 100) break;
  }


  const listados = out.length;
  const semDocNaLista = out.filter((c) => !c.documento).length;

  // Alguns registros vêm sem telefone/documento na listagem — busca no detalhe.
  // Limitado para não estourar o limite de requisições do Bling nem o tempo da requisição.
  // Numa busca nominal há poucos resultados, então consultamos todos os detalhes.
  // Isso evita que clientes mais antigos (fora dos primeiros 120 sem documento da
  // listagem geral) nunca apareçam, mesmo tendo CPF/CNPJ no cadastro completo.
  const pend = out
    .filter((c) => c.id && (!c.phone || !c.documento))
    .slice(0, busca ? Math.min(out.length, 300) : 120);

  const checados = new Set<string>();
  let falhasDetalhe = 0;
  const queue = [...pend];

  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      if (Date.now() > deadline) break;
      const c = queue.shift();
      if (!c) break;
      try {
        const res: any = await blingGet(token, `/contatos/${c.id}`);
        const d = res?.data ?? {};
        const raw = d?.celular || d?.telefone || null;
        const norm = normalizeBrPhone(raw);
        if (norm) {
          c.phone = norm;
          c.phoneRaw = String(raw);
        }
        if (!c.email && d?.email) c.email = String(d.email);
        if (!c.documento) c.documento = onlyDigits(d?.numeroDocumento ?? d?.cpfCnpj) || null;
        if (!c.tipo && d?.tipo) c.tipo = String(d.tipo);
        checados.add(c.id);
      } catch {
        falhasDetalhe++;
      }
      // O espaçamento global em blingGet controla o limite também entre
      // consultas simultâneas de propostas, contatos e detalhes.
    }
  });
  await Promise.all(workers);

  const semDocFinal = out.filter((c) => !c.documento).length;
  console.log(
    `[bling] contatos listados=${listados} semDocNaLista=${semDocNaLista} detalhes=${pend.length} falhas=${falhasDetalhe} semDocFinal=${semDocFinal} fornecedoresExcluidos=${fornecedorIds.size}`,
  );

  if (opts.comDocumento) {
    // Só descarta quem comprovadamente não tem CPF/CNPJ: se o detalhe não pôde ser
    // consultado (limite de requisições do Bling), o cadastro continua na lista.
    return out.filter((c) => {
      if (c.documento) return c.documento.length === 11 || c.documento.length === 14;
      return !checados.has(c.id);
    });
  }
  return out;

}
