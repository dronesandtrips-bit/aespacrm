import { AGENDA_CONFIG_KEY, AGENDA_EVENT_PREFIX, AGENDA_DIGEST_PREFIX, digestDue, parseClosureReply, unresolved, closureDate, type ClosureEvent, type ClosureStatus } from "@/lib/agenda-closure";
import { listCalendarEvents, calendarRequest } from "@/server/calendar-events.server";

async function read(sb: any, userId: string, name: string) {
  const { data, error } = await sb.from("crm_app_secrets").select("value").eq("user_id", userId).eq("name", name).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ?? null;
}
async function insertOnce(sb: any, userId: string, name: string, value: unknown) {
  const { error } = await sb.from("crm_app_secrets").insert({ user_id: userId, name, value: JSON.stringify(value) });
  if (error?.code === "23505") return false;
  if (error) throw new Error(error.message);
  return true;
}
async function cas(sb: any, userId: string, name: string, prev: string, next: unknown) {
  const { data, error } = await sb.from("crm_app_secrets").update({ value: JSON.stringify(next), updated_at: new Date().toISOString() })
    .eq("user_id", userId).eq("name", name).eq("value", prev).select("name");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("O compromisso mudou durante a operação; atualize e tente novamente.");
}
export async function closureEvents(sb: any, userId: string): Promise<ClosureEvent[]> {
  const rows: ClosureEvent[] = [];
  for (let offset = 0; ; offset += 250) {
    const { data, error } = await sb.from("crm_app_secrets").select("name,value").eq("user_id", userId)
      .like("name", `${AGENDA_EVENT_PREFIX}%`).order("name").range(offset, offset + 249);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) rows.push(JSON.parse(row.value));
    if ((data?.length ?? 0) < 250) return rows;
  }
}
export async function syncClosures(sb: any, userId: string, events: any[]) {
  for (const event of events) {
    if (!event.id) continue;
    const name = `${AGENDA_EVENT_PREFIX}${event.id}`;
    const prev = await read(sb, userId, name);
    if (event.status === "cancelled") {
      if (prev) await cas(sb, userId, name, prev, { ...JSON.parse(prev), status: "canceled", updatedAt: new Date().toISOString() });
      continue;
    }
    const start = event.start?.dateTime ?? event.start?.date;
    const end = event.end?.dateTime ?? event.end?.date;
    if (!start || !end) continue;
    const old: ClosureEvent | null = prev ? JSON.parse(prev) : null;
    const moved = old && (old.start !== start || old.end !== end);
    const next: ClosureEvent = { eventId: event.id, code: !old || moved ? crypto.randomUUID().replace(/-/g, "").slice(0, 8) : old.code,
      title: event.summary ?? "(sem título)", start, end, allDay: Boolean(event.start?.date),
      status: moved ? "open" : old?.status ?? "open", updatedAt: new Date().toISOString() };
    if (!prev) await insertOnce(sb, userId, name, next);
    else if (moved || old?.title !== next.title) await cas(sb, userId, name, prev, next);
  }
}
export async function setClosure(sb: any, userId: string, eventId: string, status: ClosureStatus) {
  const name = `${AGENDA_EVENT_PREFIX}${eventId}`;
  const prev = await read(sb, userId, name);
  if (!prev) throw new Error("Compromisso ainda não carregado; atualize a Agenda.");
  const old: ClosureEvent = JSON.parse(prev);
  // Revalidate the current Google event before applying an old WhatsApp answer.
  const current = await calendarRequest(`/events/${encodeURIComponent(eventId)}`);
  if (current.status === "cancelled") throw new Error("Compromisso cancelado no Google Agenda.");
  if ((current.start?.dateTime ?? current.start?.date) !== old.start || (current.end?.dateTime ?? current.end?.date) !== old.end) {
    await syncClosures(sb, userId, [current]);
    throw new Error("Compromisso reagendado; use o novo código do próximo resumo.");
  }
  const next = { ...old, status, updatedAt: new Date().toISOString() };
  if (old.status !== status) await cas(sb, userId, name, prev, next);
  // CRM is authoritative; Google title mirroring is retry-safe and reports failures.
  const cleanTitle = String(current.summary ?? old.title).replace(/^\((concluído|não compareceu)\)\s*/i, "");
  const title = status === "completed" ? `(concluído) ${cleanTitle}` : status === "no_show" ? `(não compareceu) ${cleanTitle}` : cleanTitle;
  let calendarWarning: string | null = null;
  try { if (title !== current.summary) await calendarRequest(`/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: JSON.stringify({ summary: title }) }); }
  catch (error) { calendarWarning = error instanceof Error ? error.message : String(error); }
  return { event: next, calendarWarning };
}
async function ownerPhone(apiUrl: string, apiKey: string): Promise<string> {
  const res = await fetch(`${apiUrl}/instance/fetchInstances?instanceName=zapcrm`, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Evolution [${res.status}]: ${text}`);
  const data = JSON.parse(text);
  const row = Array.isArray(data) ? data.find((r: any) => r.name === "zapcrm") : null;
  const phone = String(row?.ownerJid ?? "").split("@")[0].replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(phone)) throw new Error("Não foi possível identificar o WhatsApp do proprietário.");
  if (row.connectionStatus !== "open") throw new Error("WhatsApp desconectado; resumo não foi reservado.");
  return phone;
}
export async function runAgendaDigest(opts: { sb: any; userId: string; apiUrl: string; apiKey: string; now?: Date }) {
  const { sb, userId, apiKey } = opts;
  const apiUrl = opts.apiUrl.replace(/\/+$/, "");
  const now = opts.now ?? new Date();
  if (!digestDue(now)) return { ran: false };
  const config = await read(sb, userId, AGENDA_CONFIG_KEY);
  if (!config || !JSON.parse(config).enabled) return { ran: false };
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const name = `${AGENDA_DIGEST_PREFIX}${day}`;
  if (await read(sb, userId, name)) return { ran: false, reason: "already_reserved" };
  const phone = await ownerPhone(apiUrl, apiKey);
  const events = await listCalendarEvents(1, 90, now);
  await syncClosures(sb, userId, events);
  const live = new Set(events.filter(e => e.status !== "cancelled").map(e => e.id));
  const candidates = (await closureEvents(sb, userId)).filter(e => unresolved(e, now)).sort((a, b) => a.start.localeCompare(b.start));
  // Check older tracked events individually; Google may have deleted/moved them.
  const pending: ClosureEvent[] = [];
  for (const event of candidates) {
    if (live.has(event.eventId)) pending.push(event);
    else {
      try {
        const current = await calendarRequest(`/events/${encodeURIComponent(event.eventId)}`);
        await syncClosures(sb, userId, [current]);
        if (current.status !== "cancelled" && (current.end?.dateTime ?? current.end?.date) === event.end) pending.push(event);
      } catch (error) {
        const msg = String(error);
        if (msg.includes("[404]") || msg.includes("[410]")) {
          const key = `${AGENDA_EVENT_PREFIX}${event.eventId}`; const prev = await read(sb, userId, key);
          if (prev) await cas(sb, userId, key, prev, { ...JSON.parse(prev), status: "canceled" });
        } else throw error;
      }
    }
  }
  const shown = pending.slice(0, 25);
  const text = shown.length ? ["📋 *ZapCRM — pendentes de fechamento*", `Jones, há ${pending.length} compromisso(s) em aberto:`, "",
    ...shown.map(e => `• ${e.code.toUpperCase()} — ${e.title} — ${closureDate(e.start, e.allDay)}${e.status === "reschedule" ? " (remarcação pendente)" : ""}`), "",
    "Responda com o código: AGENDA CODIGO CONCLUIDO, AGENDA CODIGO REMARCAR ou AGENDA CODIGO FALTA.",
    "Os pendentes continuam no próximo resumo até registrar o desfecho.", "https://crm.aespa.com.br/agenda", pending.length > 25 ? "Os demais compromissos estão na Agenda." : ""].filter(Boolean).join("\n") : "";
  const checkpoint = { state: text ? "reserved" : "empty", phone, eventIds: shown.map(e => e.eventId), reservedAt: now.toISOString() };
  if (!(await insertOnce(sb, userId, name, checkpoint))) return { ran: false, reason: "race" };
  if (!text) return { ran: true, pending: 0 };
  const prev = JSON.stringify(checkpoint);
  let outcome: any;
  try {
    const res = await fetch(`${apiUrl}/message/sendText/zapcrm`, { method: "POST", headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number: phone, text, linkPreview: false }), signal: AbortSignal.timeout(20_000) });
    const body = await res.text();
    if (!res.ok) { console.error(`Agenda Evolution [${res.status}]: ${body}`); outcome = { state: "unresolved", error: `Evolution [${res.status}]: ${body}` }; }
    else { const data = JSON.parse(body); outcome = data?.key?.id ? { state: "accepted", messageId: data.key.id } : { state: "unresolved", error: "Resposta sem ID da mensagem" }; }
  } catch (error) { outcome = { state: "unresolved", error: String(error) }; }
  await cas(sb, userId, name, prev, { ...checkpoint, ...outcome });
  return { ran: true, pending: pending.length, state: outcome.state };
}
export async function handleClosureReply(opts: { sb: any; userId: string; phone: string; text: string; apiUrl: string; apiKey: string }) {
  const reply = parseClosureReply(opts.text);
  if (!reply) return false;
  // Only the instance owner's self-chat can close appointments, never customers.
  if (opts.phone !== await ownerPhone(opts.apiUrl.replace(/\/+$/, ""), opts.apiKey)) return false;
  const matches = (await closureEvents(opts.sb, opts.userId)).filter(e => e.code === reply.code);
  if (matches.length !== 1) return false;
  await setClosure(opts.sb, opts.userId, matches[0].eventId, reply.status);
  return true;
}