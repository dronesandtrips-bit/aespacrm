// Disparo automático de novas propostas comerciais do Bling.
// Fluxo: lista propostas recentes → filtra as novas (log idempotente) →
// cadastra/atualiza o contato na categoria BLING → envia texto/mídia pré-configurado.
// Aditivo: não altera nenhum fluxo existente.
import { getSupabaseAdmin } from "@/integrations/supabase/server";
import { getSecret, setSecret, listProposals, type BlingProposal } from "@/server/bling.server";

const INSTANCE = "zapcrm";
const CONFIG_SECRET = "BLING_AUTO_CONFIG";
const LEASE_SECRET = "BLING_AUTO_LEASE";
const CATEGORY_NAME = "BLING";

export type BlingAutoConfig = {
  enabled: boolean;
  dias: number;
  maxPerRun: number;
  /** Situações da proposta que disparam o envio (vazio = todas). */
  situacoes: string[];
  text: string;
  mediaUrl: string;
  mediaType: "image" | "video" | "document" | "";
  /** Só propostas com data >= since (ISO date) — evita disparar histórico. */
  since: string;
  /** Minutos de espera entre detectar a proposta e enviar a mensagem. */
  delayMin: number;
};

export const DEFAULT_AUTO_CONFIG: BlingAutoConfig = {
  enabled: false,
  dias: 7,
  maxPerRun: 10,
  situacoes: [],
  text:
    "Olá {nome}! 👋\n\nSua proposta comercial *{numero}* já está pronta: *{valor}*.\n\nQualquer dúvida é só responder por aqui que eu te ajudo. 😉",
  mediaUrl: "",
  mediaType: "",
  since: new Date().toISOString().slice(0, 10),
  delayMin: 60,
};

export async function getAutoConfig(userId: string): Promise<BlingAutoConfig> {
  const raw = await getSecret(userId, CONFIG_SECRET);
  if (!raw) return { ...DEFAULT_AUTO_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AUTO_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_AUTO_CONFIG };
  }
}

export async function saveAutoConfig(
  userId: string,
  patch: Partial<BlingAutoConfig>,
): Promise<BlingAutoConfig> {
  const current = await getAutoConfig(userId);
  const next: BlingAutoConfig = {
    ...current,
    ...patch,
    dias: Math.min(Math.max(Number(patch.dias ?? current.dias) || 7, 1), 90),
    maxPerRun: Math.min(Math.max(Number(patch.maxPerRun ?? current.maxPerRun) || 10, 1), 50),
    situacoes: Array.isArray(patch.situacoes) ? patch.situacoes : current.situacoes,
    delayMin: Math.min(
      Math.max(Number(patch.delayMin ?? current.delayMin ?? 60), 0),
      7 * 24 * 60,
    ),
  };
  await setSecret(userId, CONFIG_SECRET, JSON.stringify(next));
  return next;
}

/** Lock de execução única (lease com expiração). */
async function acquireLease(userId: string, ms = 120_000): Promise<boolean> {
  const raw = await getSecret(userId, LEASE_SECRET);
  const until = raw ? Number(raw) : 0;
  if (until && until > Date.now()) return false;
  await setSecret(userId, LEASE_SECRET, String(Date.now() + ms));
  return true;
}

async function releaseLease(userId: string) {
  await setSecret(userId, LEASE_SECRET, "0");
}

function brl(v: number | null) {
  if (v == null) return "";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function renderTemplate(tpl: string, p: BlingProposal) {
  return tpl
    .replaceAll("{nome}", p.nome && p.nome !== "Sem nome" ? p.nome : "tudo bem")
    .replaceAll("{numero}", p.numero ?? "")
    .replaceAll("{valor}", brl(p.total))
    .replaceAll("{data}", p.data ? new Date(`${p.data}T12:00:00`).toLocaleDateString("pt-BR") : "");
}

async function ensureBlingCategory(sb: any, userId: string): Promise<string | null> {
  const { data } = await sb
    .from("crm_categories")
    .select("id,name")
    .eq("user_id", userId);
  const found = (data ?? []).find(
    (c: any) => String(c.name).trim().toLowerCase() === CATEGORY_NAME.toLowerCase(),
  );
  if (found) return found.id;
  const { data: created } = await sb
    .from("crm_categories")
    .insert({ user_id: userId, name: CATEGORY_NAME, color: "#F59E0B" })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
}

async function ensureContact(
  sb: any,
  userId: string,
  categoryId: string | null,
  p: BlingProposal,
): Promise<{ id: string } | null> {
  const norm = p.phone.replace(/\D/g, "");
  if (!norm) return null;

  const { data: existing } = await sb
    .from("crm_contacts")
    .select("id")
    .eq("user_id", userId)
    .eq("is_group", false)
    .eq("phone_norm", norm)
    .maybeSingle();

  let contactId: string | null = existing?.id ?? null;

  if (!contactId) {
    const { data: created, error } = await sb
      .from("crm_contacts")
      .insert({
        user_id: userId,
        name: p.nome && p.nome !== "Sem nome" ? p.nome : norm,
        phone: p.phone,
        email: p.email || null,
        notes: p.numero ? `Proposta comercial Bling nº ${p.numero}` : null,
        category_id: categoryId,
      })
      .select("id")
      .maybeSingle();
    if (error && !created) {
      const { data: retry } = await sb
        .from("crm_contacts")
        .select("id")
        .eq("user_id", userId)
        .eq("phone_norm", norm)
        .maybeSingle();
      contactId = retry?.id ?? null;
    } else {
      contactId = created?.id ?? null;
    }
  }

  if (contactId && categoryId) {
    await sb
      .from("crm_contact_categories")
      .upsert(
        { contact_id: contactId, category_id: categoryId, user_id: userId, source: "manual" },
        { onConflict: "contact_id,category_id" },
      );
  }
  return contactId ? { id: contactId } : null;
}

async function isBlacklisted(sb: any, userId: string, phone: string): Promise<boolean> {
  const { data } = await sb
    .from("crm_ignored_phones")
    .select("phone")
    .eq("user_id", userId)
    .eq("phone", phone)
    .maybeSingle();
  return Boolean(data);
}

async function sendWhatsapp(
  userId: string,
  contactId: string,
  phone: string,
  cfg: BlingAutoConfig,
  text: string,
) {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!apiUrl || !apiKey) throw new Error("EVOLUTION_API_URL/KEY ausentes");

  const useMedia = Boolean(cfg.mediaUrl && cfg.mediaType);
  const endpoint = useMedia ? "sendMedia" : "sendText";
  const body = useMedia
    ? { number: phone, mediatype: cfg.mediaType, media: cfg.mediaUrl, caption: text }
    : { number: phone, text, linkPreview: false };

  const res = await fetch(`${apiUrl}/message/${endpoint}/${INSTANCE}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Evolution [${res.status}]: ${raw.slice(0, 250)}`);
  let ev: any = {};
  try {
    ev = JSON.parse(raw);
  } catch {}

  const sb = getSupabaseAdmin();
  await sb.from("crm_messages").insert({
    user_id: userId,
    contact_id: contactId,
    body: text,
    from_me: true,
    at: new Date().toISOString(),
    type: useMedia ? cfg.mediaType : "text",
    message_id: ev?.key?.id ?? null,
    remote_jid: ev?.key?.remoteJid ?? `${phone}@s.whatsapp.net`,
    status: "sent",
    raw: ev,
    ...(useMedia ? { media_caption: text, media_url: cfg.mediaUrl } : {}),
  });
}

export type AutoRunResult = {
  ok: boolean;
  checked: number;
  sent: number;
  /** Propostas detectadas nesta rodada e agendadas para envio após o atraso. */
  queued?: number;
  skipped: number;
  errors: number;
  detail: Array<{ proposal: string; status: string; info?: string }>;
};

/** Executa um ciclo do disparo automático para um usuário. */
export async function runBlingAutoTick(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<AutoRunResult> {
  const cfg = await getAutoConfig(userId);
  const out: AutoRunResult = { ok: true, checked: 0, sent: 0, skipped: 0, errors: 0, detail: [] };
  if (!cfg.enabled && !opts.force) return out;

  if (!(await acquireLease(userId))) {
    out.detail.push({ proposal: "-", status: "lock", info: "outra execução em andamento" });
    return out;
  }

  try {
    const sb = getSupabaseAdmin();
    const proposals = await listProposals(userId, { dias: cfg.dias, limite: 100 });
    out.checked = proposals.length;

    const sinceTs = cfg.since ? new Date(`${cfg.since.slice(0, 10)}T00:00:00`).getTime() : 0;
    const wanted = proposals.filter((p) => {
      if (!p.id) return false;
      if (sinceTs && p.data && new Date(`${p.data.slice(0, 10)}T12:00:00`).getTime() < sinceTs)
        return false;
      if (cfg.situacoes.length) {
        const s = String(p.situacao ?? "").toLowerCase();
        if (!cfg.situacoes.some((w) => s.includes(String(w).toLowerCase()))) return false;
      }
      return true;
    });

    const categoryId = await ensureBlingCategory(sb, userId);

    // --- Fase 1: registra as propostas novas como "pending" (não envia agora) ---
    const { data: done } = await sb
      .from("crm_bling_auto_log")
      .select("proposal_id")
      .eq("user_id", userId)
      .in(
        "proposal_id",
        wanted.slice(0, 200).map((p) => p.id),
      );
    const already = new Set((done ?? []).map((r: any) => String(r.proposal_id)));

    for (const p of wanted.filter((x) => !already.has(x.id))) {
      if (!p.phone) {
        await sb.from("crm_bling_auto_log").insert({
          user_id: userId,
          proposal_id: p.id,
          status: "skipped",
          detail: "sem telefone",
        });
        out.skipped++;
        out.detail.push({ proposal: p.numero ?? p.id, status: "sem telefone" });
        continue;
      }
      const { error } = await sb.from("crm_bling_auto_log").insert({
        user_id: userId,
        proposal_id: p.id,
        phone: p.phone,
        status: "pending",
        detail: `aguardando ${cfg.delayMin} min`,
      });
      if (!error) {
        out.queued = (out.queued ?? 0) + 1;
        out.detail.push({
          proposal: p.numero ?? p.id,
          status: "agendado",
          info: `envio em ${cfg.delayMin} min`,
        });
      }
    }

    // --- Fase 2: envia as pendentes que já venceram o tempo de espera ---
    const delayMs = Math.max(0, Number(cfg.delayMin ?? 60)) * 60_000;
    const cutoff = new Date(Date.now() - (opts.force ? 0 : delayMs)).toISOString();

    const { data: pending } = await sb
      .from("crm_bling_auto_log")
      .select("proposal_id, created_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(cfg.maxPerRun);

    const byId = new Map(proposals.map((p) => [String(p.id), p]));

    for (const row of pending ?? []) {
      const p = byId.get(String(row.proposal_id));
      if (!p) continue; // fora da janela atual; tenta na próxima rodada
      try {
        const contact = await ensureContact(sb, userId, categoryId, p);
        if (!contact) throw new Error("não foi possível criar o contato");

        if (await isBlacklisted(sb, userId, p.phone)) {
          await sb
            .from("crm_bling_auto_log")
            .update({ contact_id: contact.id, status: "skipped", detail: "blacklist" })
            .eq("user_id", userId)
            .eq("proposal_id", p.id);
          out.skipped++;
          out.detail.push({ proposal: p.numero ?? p.id, status: "blacklist" });
          continue;
        }

        // Marca ANTES de enviar (idempotência): evita duplicar se o worker cair.
        const { data: claimed } = await sb
          .from("crm_bling_auto_log")
          .update({ contact_id: contact.id, phone: p.phone, status: "sent", detail: null })
          .eq("user_id", userId)
          .eq("proposal_id", p.id)
          .eq("status", "pending")
          .select("proposal_id")
          .maybeSingle();
        if (!claimed) {
          out.skipped++;
          continue;
        }

        await sendWhatsapp(userId, contact.id, p.phone, cfg, renderTemplate(cfg.text, p));
        out.sent++;
        out.detail.push({ proposal: p.numero ?? p.id, status: "enviado", info: p.phone });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        out.errors++;
        out.detail.push({ proposal: p.numero ?? p.id, status: "erro", info: msg });
        await sb
          .from("crm_bling_auto_log")
          .update({ status: "error", detail: msg.slice(0, 400) })
          .eq("user_id", userId)
          .eq("proposal_id", p.id);
      }
    }
  } catch (e: any) {
    out.ok = false;
    out.detail.push({ proposal: "-", status: "erro", info: e?.message ?? String(e) });
  } finally {
    await releaseLease(userId);
  }

  return out;
}
