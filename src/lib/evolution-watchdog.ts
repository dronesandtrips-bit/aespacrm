// Regras puras da "Sentinela da conexão" do WhatsApp (instância zapcrm).
// Detecta a conexão "zumbi": aparece ligada, mas o WhatsApp parou de entregar
// mensagens recebidas. Sem efeitos colaterais aqui — só decide o que fazer.

export const WATCHDOG_STATE_KEY = "EVOLUTION_WATCHDOG_STATE";
/** Sem nenhum sinal do WhatsApp por este tempo (dias úteis, 8h–18h59) = suspeita. */
export const SILENCE_MINUTES = 45;
/** Fora do expediente (noite até 22h, sábado e domingo) o movimento é bem menor. */
export const OFF_PEAK_SILENCE_MINUTES = 180;
/** Fim do expediente (dias úteis) para o limite curto. */
export const BUSINESS_TO_HOUR = 19;
/** Intervalo mínimo entre reinícios automáticos. */
export const RESTART_COOLDOWN_MINUTES = 20;
/** Reinícios automáticos antes de pedir um novo QR Code. */
export const MAX_AUTO_RESTARTS = 2;
/** Horário ativo (São Paulo): das 8h até 21h59. */
export const ACTIVE_FROM_HOUR = 8;
export const ACTIVE_TO_HOUR = 22;
/** Intervalo entre verificações reais. */
export const CHECK_EVERY_MINUTES = 5;

export type WatchdogStatus = "ok" | "quiet" | "restarting" | "stuck" | "disconnected" | "logged_out";

/** Silêncio não comprova perda da sessão; novo QR só para logout confirmado. */
export function watchdogRecoveryAction(status: WatchdogStatus): "reconnect" | "verify" | "none" {
  if (status === "logged_out") return "reconnect";
  if (status === "stuck" || status === "disconnected" || status === "restarting") return "verify";
  return "none";
}

export type WatchdogState = {
  status: WatchdogStatus;
  lastCheckAt: string | null;
  lastInboundAt: string | null;
  /** Último sinal vindo do WhatsApp (mensagem, confirmação de entrega/leitura, envio pelo celular). */
  lastSignalAt: string | null;
  incidentSince: string | null;
  lastRestartAt: string | null;
  restarts: number;
  alertedAt: string | null;
};

export const EMPTY_STATE: WatchdogState = {
  status: "ok",
  lastCheckAt: null,
  lastInboundAt: null,
  lastSignalAt: null,
  incidentSince: null,
  lastRestartAt: null,
  restarts: 0,
  alertedAt: null,
};

export function parseState(raw: unknown): WatchdogState {
  if (typeof raw !== "string" || !raw) return { ...EMPTY_STATE };
  try {
    const j = JSON.parse(raw);
    return { ...EMPTY_STATE, ...(j && typeof j === "object" ? j : {}) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function saoPauloHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(h) % 24;
}

export function isActiveHour(now: Date): boolean {
  const h = saoPauloHour(now);
  return h >= ACTIVE_FROM_HOUR && h < ACTIVE_TO_HOUR;
}

function saoPauloWeekday(now: Date): number {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(d);
}

/** Quanto silêncio é aceitável agora: curto no expediente, longo à noite e no fim de semana. */
export function silenceLimitMinutes(now: Date): number {
  const wd = saoPauloWeekday(now);
  const h = saoPauloHour(now);
  const business = wd >= 1 && wd <= 5 && h >= ACTIVE_FROM_HOUR && h < BUSINESS_TO_HOUR;
  return business ? SILENCE_MINUTES : OFF_PEAK_SILENCE_MINUTES;
}

const latestIso = (...xs: (string | null | undefined)[]) =>
  xs.filter((x): x is string => !!x && !Number.isNaN(Date.parse(x)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

/** Status de mensagem que só chegam se o WhatsApp está entregando eventos ao servidor. */
const SIGNAL_STATUSES = new Set(["delivery_ack", "read", "played"]);

/**
 * Eventos brutos que provam que o WhatsApp está entregando ao CRM.
 * Ignora "connection.update" (gerado pelo próprio servidor) e "SERVER_ACK"
 * (só confirma que um envio saiu, não que o recebimento funciona).
 */
export function isLivenessEvent(event: string, status?: unknown): boolean {
  const e = String(event || "").toLowerCase();
  if (e === "messages.upsert") return true;
  if (e === "messages.update") return SIGNAL_STATUSES.has(String(status ?? "").toLowerCase());
  return false;
}

export function isCheckDue(prev: WatchdogState, now: Date): boolean {
  if (!prev.lastCheckAt) return true;
  return now.getTime() - Date.parse(prev.lastCheckAt) >= (CHECK_EVERY_MINUTES * 60_000 - 15_000);
}

const minutesSince = (iso: string | null, now: Date) =>
  iso ? (now.getTime() - Date.parse(iso)) / 60_000 : Number.POSITIVE_INFINITY;

export type WatchdogInput = {
  now: Date;
  connection: string; // open | connecting | close | unknown
  disconnectionReasonCode?: number | null;
  lastInboundAt: string | null;
  /** Último evento do WhatsApp que prova que a conexão entrega (ver isLivenessEvent). */
  lastSignalAt?: string | null;
  prev: WatchdogState;
};

export type WatchdogDecision = { action: "none" | "restart" | "alert"; next: WatchdogState };

export function decideWatchdog({ now, connection, disconnectionReasonCode, lastInboundAt, lastSignalAt, prev }: WatchdogInput): WatchdogDecision {
  const nowIso = now.toISOString();
  const signal = latestIso(lastInboundAt, lastSignalAt);
  const base: WatchdogState = { ...prev, lastCheckAt: nowIso, lastInboundAt, lastSignalAt: signal };
  const incidentSince = prev.incidentSince ?? nowIso;

  if (connection !== "open") {
    // 401 = sessão encerrada no celular: só um novo QR Code resolve.
    if (connection === "close" && disconnectionReasonCode === 401) {
      const next: WatchdogState = { ...base, status: "logged_out", incidentSince };
      return { action: prev.alertedAt ? "none" : "alert", next: { ...next, alertedAt: prev.alertedAt ?? nowIso } };
    }
    if (minutesSince(prev.lastRestartAt, now) >= RESTART_COOLDOWN_MINUTES / 2) {
      return { action: "restart", next: { ...base, status: "disconnected", incidentSince, lastRestartAt: nowIso, restarts: prev.restarts + 1 } };
    }
    return { action: "none", next: { ...base, status: "disconnected", incidentSince } };
  }

  const silence = minutesSince(signal, now);
  if (silence < silenceLimitMinutes(now)) {
    return { action: "none", next: { ...base, status: "ok", incidentSince: null, lastRestartAt: prev.lastRestartAt, restarts: 0, alertedAt: null } };
  }
  if (!isActiveHour(now)) {
    // Fora do horário o silêncio é normal: não reinicia nem alerta.
    return { action: "none", next: { ...base, status: prev.status === "stuck" ? "stuck" : "quiet" } };
  }
  if (prev.restarts < MAX_AUTO_RESTARTS) {
    if (minutesSince(prev.lastRestartAt, now) >= RESTART_COOLDOWN_MINUTES) {
      return { action: "restart", next: { ...base, status: "restarting", incidentSince, lastRestartAt: nowIso, restarts: prev.restarts + 1 } };
    }
    return { action: "none", next: { ...base, status: "restarting", incidentSince } };
  }
  if (minutesSince(prev.lastRestartAt, now) < RESTART_COOLDOWN_MINUTES) {
    return { action: "none", next: { ...base, status: "restarting", incidentSince } };
  }
  const next: WatchdogState = { ...base, status: "stuck", incidentSince, alertedAt: prev.alertedAt ?? nowIso };
  return { action: prev.alertedAt ? "none" : "alert", next };
}
