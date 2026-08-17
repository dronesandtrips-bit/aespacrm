// Detector conservador de agendamento em mensagens enviadas pelo Robô.
//
// Objetivo: quando o Robô fecha um horário na conversa ("confirmado para
// quarta às 14h"), extrair data/hora para criar o evento "(a confirmar)".
// Regra de ouro: na dúvida, NÃO detecta (retorna null). Um falso negativo
// é inofensivo; um falso positivo cria evento errado.

const CONFIRM_WORDS = [
  "agendad",
  "agendei",
  "agendamos",
  "marcad",
  "marquei",
  "marcamos",
  "confirmad",
  "confirmo",
  "confirmei",
  "reservad",
  "te espero",
  "nos vemos",
  "fica marcado",
  "ficou marcado",
  "ficamos então",
  "ficamos entao",
];

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  "segunda-feira": 1,
  terca: 2,
  "terça": 2,
  "terca-feira": 2,
  "terça-feira": 2,
  quarta: 3,
  "quarta-feira": 3,
  quinta: 4,
  "quinta-feira": 4,
  sexta: 5,
  "sexta-feira": 5,
  sabado: 6,
  "sábado": 6,
};

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  "março": 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

const TZ_OFFSET_MIN = -180; // America/Sao_Paulo (sem horário de verão)

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Constrói um ISO UTC a partir de data/hora locais de São Paulo. */
function saoPauloToISO(y: number, m: number, d: number, hh: number, mm: number): string {
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - TZ_OFFSET_MIN * 60_000;
  return new Date(utcMs).toISOString();
}

/** Partes da data/hora atual em São Paulo. */
function nowInSaoPaulo(now: Date) {
  const local = new Date(now.getTime() + TZ_OFFSET_MIN * 60_000);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    weekday: local.getUTCDay(),
  };
}

function extractTime(text: string): { hh: number; mm: number } | null {
  // "14h", "14h30", "14:30", "às 14", "as 9 horas"
  const m =
    text.match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})\b/) ||
    text.match(/(\d{1,2})\s*h\b/) ||
    text.match(/\b(?:às|as)\s+(\d{1,2})(?!\d)\s*(?:horas?)?\b/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(hh) || hh > 23 || mm > 59) return null;
  return { hh, mm };
}

export type DetectedAppointment = {
  startISO: string;
  /** trecho que gerou a detecção (para log/depuração) */
  matched: string;
};

/**
 * Retorna a data/hora detectada ou null. Exige simultaneamente:
 *  1) uma palavra de confirmação
 *  2) uma hora explícita
 *  3) uma referência de dia (hoje/amanhã/dia da semana/dd-mm)
 */
export function detectAppointment(
  rawText: string,
  now: Date = new Date(),
): DetectedAppointment | null {
  if (!rawText) return null;
  const text = normalize(rawText);
  if (text.length > 1200) return null;
  if (!CONFIRM_WORDS.some((w) => text.includes(w))) return null;

  const time = extractTime(text);
  if (!time) return null;

  const today = nowInSaoPaulo(now);
  let y = today.y;
  let m: number | null = null;
  let d: number | null = null;
  let matched = "";

  // 1) dd/mm[/yyyy]
  const numeric = text.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/);
  // 2) "dia 12 de março" ou "12 de março"
  const written = text.match(/\b(\d{1,2})\s+de\s+([a-zçã]+)/);

  if (numeric) {
    d = Number(numeric[1]);
    m = Number(numeric[2]);
    if (numeric[3]) {
      const yy = Number(numeric[3]);
      y = yy < 100 ? 2000 + yy : yy;
    }
    matched = numeric[0];
  } else if (written && MONTHS[written[2]]) {
    d = Number(written[1]);
    m = MONTHS[written[2]];
    matched = written[0];
  } else if (/\bhoje\b/.test(text)) {
    d = today.d;
    m = today.m;
    matched = "hoje";
  } else if (/\bamanh[ãa]\b/.test(text)) {
    const base = new Date(saoPauloToISO(today.y, today.m, today.d, 12, 0));
    base.setUTCDate(base.getUTCDate() + 1);
    const p = nowInSaoPaulo(base);
    y = p.y;
    m = p.m;
    d = p.d;
    matched = "amanhã";
  } else {
    // dia da semana → próxima ocorrência (inclui hoje se ainda não passou)
    const wdKey = Object.keys(WEEKDAYS).find((k) =>
      new RegExp(`\\b${k.replace("-", "-")}\\b`).test(text),
    );
    if (!wdKey) return null;
    const target = WEEKDAYS[wdKey];
    let delta = (target - today.weekday + 7) % 7;
    const base = new Date(saoPauloToISO(today.y, today.m, today.d, 12, 0));
    if (delta === 0) {
      const candidate = saoPauloToISO(today.y, today.m, today.d, time.hh, time.mm);
      if (new Date(candidate).getTime() <= now.getTime()) delta = 7;
    }
    base.setUTCDate(base.getUTCDate() + delta);
    const p = nowInSaoPaulo(base);
    y = p.y;
    m = p.m;
    d = p.d;
    matched = wdKey;
  }

  if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;

  const startISO = saoPauloToISO(y, m, d, time.hh, time.mm);
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return null;
  // Precisa ser futuro e dentro de 120 dias (evita datas absurdas)
  const diff = start.getTime() - now.getTime();
  if (diff < 5 * 60_000 || diff > 120 * 24 * 3600_000) return null;

  return { startISO, matched: `${matched} ${time.hh}:${String(time.mm).padStart(2, "0")}` };
}
