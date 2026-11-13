// Regras puras da "Sentinela da conexão" do WhatsApp (instância zapcrm).
// Detecta a conexão "zumbi": aparece ligada, mas o WhatsApp parou de entregar
// mensagens recebidas. Sem efeitos colaterais aqui — só decide o que fazer.

export const WATCHDOG_STATE_KEY = "EVOLUTION_WATCHDOG_STATE";
/** Sem nenhuma mensagem recebida por este tempo (no horário ativo) = suspeita. */
export const SILENCE_MINUTES = 45;
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

export type WatchdogState = {
  status: WatchdogStatus;
  lastCheckAt: string | null;
  lastInboundAt: string | null;
  incidentSince: string | null;
  lastRestartAt: string | null;
  restarts: number;
  alertedAt: string | null;
};

export const EMPTY_STATE: WatchdogState = {
  status: "ok",
  lastCheckAt: null,
  lastInboundAt: null,
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
  prev: WatchdogState;
};

export type WatchdogDecision = { action: "none" | "restart" | "alert"; next: WatchdogState };

export function decideWatchdog({ now, connection, disconnectionReasonCode, lastInboundAt, prev }: WatchdogInput): WatchdogDecision {
  const nowIso = now.toISOString();
  const base: WatchdogState = { ...prev, lastCheckAt: nowIso, lastInboundAt };
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

  const silence = minutesSince(lastInboundAt, now);
  if (silence < SILENCE_MINUTES) {
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
