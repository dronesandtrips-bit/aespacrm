// Repasse dos avisos da conexão única (zapcrm) para o Robô (Fase 2).
// Só entrega avisos: nunca envia mensagens de WhatsApp. Desligado por padrão;
// liga com crm_app_secrets.ROBO_FORWARD_ENABLED = "true".
const DEFAULT_URL = "https://robo.aespa.com.br/api/public/evolution-webhook";
export const FORWARD_EVENTS = new Set(["messages.upsert", "messages.update", "connection.update"]);

let cache: { at: number; enabled: boolean; url: string } | null = null;

async function readConfig(sb: any, userId: string) {
  if (cache && Date.now() - cache.at < 30_000) return cache;
  let enabled = false;
  let url = DEFAULT_URL;
  try {
    const { data } = await sb
      .from("crm_app_secrets")
      .select("name,value")
      .eq("user_id", userId)
      .in("name", ["ROBO_FORWARD_ENABLED", "ROBO_WEBHOOK_URL"]);
    for (const r of data ?? []) {
      if (r.name === "ROBO_FORWARD_ENABLED") enabled = String(r.value).trim().toLowerCase() === "true";
      if (r.name === "ROBO_WEBHOOK_URL" && /^https:\/\//.test(String(r.value))) url = String(r.value).trim();
    }
  } catch {
    /* sem config = desligado */
  }
  cache = { at: Date.now(), enabled, url };
  return cache;
}

export async function forwardToRobo(opts: {
  sb: any;
  userId: string;
  event: string;
  rawBody: string;
  apikey: string;
}): Promise<void> {
  if (!FORWARD_EVENTS.has(opts.event)) return;
  const cfg = await readConfig(opts.sb, opts.userId);
  if (!cfg.enabled) return;
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: opts.apikey },
        body: opts.rawBody,
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return;
      lastErr = `HTTP ${r.status}`;
      if (r.status < 500) break;
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
  }
  try {
    await opts.sb.from("crm_webhook_events").insert({
      user_id: opts.userId,
      instance: "zapcrm",
      event: "robo_forward_failed",
      payload: { event: opts.event, body: opts.rawBody.slice(0, 20000) },
      error: lastErr,
    });
  } catch {
    /* best effort */
  }
}
