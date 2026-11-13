// Sentinela da conexão do WhatsApp (instância zapcrm).
// - Verifica a cada ~5 min se a conexão está recebendo mensagens.
// - Conexão "zumbi" (ligada, mas sem receber nada no horário ativo): reinicia
//   a instância zapcrm até 2 vezes. Persistindo, avisa o dono uma única vez
//   por incidente (WhatsApp para o próprio número + faixa no CRM).
// - Nunca toca em outras instâncias, nunca reenvia mensagens de clientes.
import {
  WATCHDOG_STATE_KEY,
  decideWatchdog,
  isCheckDue,
  parseState,
  type WatchdogState,
} from "@/lib/evolution-watchdog";

const INSTANCE = "zapcrm";

export async function readWatchdogState(sb: any, ownerUserId: string): Promise<WatchdogState> {
  const { data } = await sb
    .from("crm_app_secrets")
    .select("value")
    .eq("user_id", ownerUserId)
    .eq("name", WATCHDOG_STATE_KEY)
    .maybeSingle();
  return parseState(data?.value);
}

async function writeState(sb: any, ownerUserId: string, state: WatchdogState) {
  const { error } = await sb.from("crm_app_secrets").upsert(
    { user_id: ownerUserId, name: WATCHDOG_STATE_KEY, value: JSON.stringify(state), updated_at: new Date().toISOString() },
    { onConflict: "user_id,name" },
  );
  if (error) throw new Error(`watchdog state: ${error.message}`);
}

async function evo(apiUrl: string, apiKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { apikey: apiKey, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* texto */ }
  return { ok: res.ok, status: res.status, body };
}

function fmtSp(iso: string | null) {
  if (!iso) return "há muito tempo";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export async function runWatchdog(opts: {
  sb: any;
  apiUrl: string;
  apiKey: string;
  ownerUserId: string;
  force?: boolean;
  now?: Date;
}) {
  const { sb, apiUrl, apiKey, ownerUserId } = opts;
  const now = opts.now ?? new Date();
  const prev = await readWatchdogState(sb, ownerUserId);
  if (!opts.force && !isCheckDue(prev, now)) return { ran: false, state: prev };

  const inst = await evo(apiUrl, apiKey, `/instance/fetchInstances?instanceName=${INSTANCE}`);
  const row = Array.isArray(inst.body) ? inst.body.find((i: any) => i?.name === INSTANCE) ?? inst.body[0] : null;
  if (!inst.ok || !row) {
    // Evolution fora do ar ou sem resposta: registra a verificação sem agir.
    const next = { ...prev, lastCheckAt: now.toISOString() };
    await writeState(sb, ownerUserId, next);
    return { ran: true, action: "none", error: `Evolution respondeu ${inst.status}`, state: next };
  }

  const { data: last, error: lastErr } = await sb
    .from("crm_messages")
    .select("at")
    .eq("user_id", ownerUserId)
    .eq("from_me", false)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(`last inbound: ${lastErr.message}`);

  const decision = decideWatchdog({
    now,
    connection: String(row.connectionStatus ?? "unknown"),
    disconnectionReasonCode: typeof row.disconnectionReasonCode === "number" ? row.disconnectionReasonCode : null,
    lastInboundAt: last?.at ?? null,
    prev,
  });

  // Grava a decisão ANTES de agir: um alerta nunca é enviado duas vezes.
  await writeState(sb, ownerUserId, decision.next);

  let actionResult: unknown = null;
  if (decision.action === "restart") {
    const r = await evo(apiUrl, apiKey, `/instance/restart/${INSTANCE}`, { method: "POST" });
    actionResult = { status: r.status };
  } else if (decision.action === "alert") {
    const number = String(row.ownerJid ?? "").split("@")[0];
    const reason = decision.next.status === "logged_out"
      ? "a conexão do WhatsApp foi desconectada no celular."
      : `a conexão do WhatsApp parou de receber mensagens (última recebida: ${fmtSp(decision.next.lastInboundAt)}). Já tentei reiniciar 2 vezes, sem sucesso.`;
    if (/^\d{10,15}$/.test(number)) {
      const r = await evo(apiUrl, apiKey, `/message/sendText/${INSTANCE}`, {
        method: "POST",
        body: JSON.stringify({
          number,
          text: `⚠️ *Aviso do ZapCRM*: ${reason}\n\nPara resolver, abra https://crm.aespa.com.br/whatsapp e clique em *Reconectar do zero* para ler um novo QR Code.\n_Mensagem automática, enviada uma vez por ocorrência._`,
        }),
      });
      actionResult = { status: r.status };
    }
  }
  return { ran: true, action: decision.action, actionResult, state: decision.next };
}
