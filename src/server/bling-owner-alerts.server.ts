import { BLING_ALERT_CONFIG, BLING_ALERT_TRACK, BLING_ALERT_NOTICE, alertKind, proposalAlertText, type ProposalTracking } from "@/lib/bling-owner-alerts";
import { ownerPhone } from "@/server/agenda-closure.server";

async function read(sb: any, userId: string, name: string) {
  const { data, error } = await sb.from("crm_app_secrets").select("value").eq("user_id", userId).eq("name", name).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ? JSON.parse(data.value) : null;
}
async function insertOnce(sb: any, userId: string, name: string, value: unknown) {
  const { error } = await sb.from("crm_app_secrets").insert({ user_id: userId, name, value: JSON.stringify(value) });
  if (error?.code === "23505") return false;
  if (error) throw new Error(error.message);
  return true;
}
export async function trackProposalForOwner(sb: any, userId: string, track: ProposalTracking) {
  // Keep original send time forever; no recipient/client automation mutation.
  await insertOnce(sb, userId, `${BLING_ALERT_TRACK}${track.proposalId}`, track);
}
export async function sendOwnerProposalNotice(opts: { sb: any; userId: string; apiUrl: string; apiKey: string; track: ProposalTracking; kind: "reply" | "stagnant"; now: Date }) {
  const { sb, userId, track, kind, now } = opts;
  const name = `${BLING_ALERT_NOTICE}${track.proposalId}_${kind}`;
  if (await read(sb, userId, name)) return "already_reserved";
  const apiUrl = opts.apiUrl.replace(/\/+$/, "");
  const phone = await ownerPhone(apiUrl, opts.apiKey);
  const checkpoint = { state: "reserved", phone, kind, proposalId: track.proposalId, reservedAt: now.toISOString() };
  if (!(await insertOnce(sb, userId, name, checkpoint))) return "already_reserved";
  let outcome: Record<string, unknown>;
  try {
    const res = await fetch(`${apiUrl}/message/sendText/zapcrm`, {
      method: "POST", headers: { apikey: opts.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number: phone, text: proposalAlertText(track, kind), linkPreview: false }), signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    if (!res.ok) { console.error(`Bling owner Evolution [${res.status}]: ${body}`); outcome = { state: "unresolved", error: `Evolution [${res.status}]: ${body}` }; }
    else { const data = JSON.parse(body); outcome = data?.key?.id ? { state: "accepted", messageId: data.key.id } : { state: "unresolved", error: "Resposta sem ID da mensagem" }; }
  } catch (error) { outcome = { state: "unresolved", error: String(error) }; }
  const { data, error } = await sb.from("crm_app_secrets").update({ value: JSON.stringify({ ...checkpoint, ...outcome }), updated_at: now.toISOString() })
    .eq("user_id", userId).eq("name", name).eq("value", JSON.stringify(checkpoint)).select("name");
  if (error || !data?.length) throw new Error(error?.message ?? "Reserva do aviso mudou durante envio");
  return outcome.state;
}
export async function runBlingOwnerAlerts(opts: { sb: any; userId: string; apiUrl: string; apiKey: string; now?: Date }) {
  const { sb, userId } = opts;
  const now = opts.now ?? new Date();
  const config = await read(sb, userId, BLING_ALERT_CONFIG);
  if (!config?.enabled || !Number.isFinite(Date.parse(config.activatedAt))) return { ran: false };
  // Recover tracking from existing scheduled followups without touching them.
  const { data: followups, error: followupError } = await sb.from("crm_bling_auto_log").select("proposal_id,contact_id,detail")
    .eq("user_id", userId).eq("status", "followup").order("created_at", { ascending: false }).limit(50);
  if (followupError) throw new Error(followupError.message);
  for (const row of followups ?? []) {
    let info: any; try { info = JSON.parse(row.detail ?? "{}"); } catch { continue; }
    if (!row.contact_id || !info.sentAt || !Number.isFinite(Date.parse(info.sentAt))) continue;
    await trackProposalForOwner(sb, userId, { proposalId: String(row.proposal_id).split("#")[0], numero: String(info.numero ?? ""), nome: String(info.nome ?? "Cliente"), contactId: row.contact_id, sentAt: info.sentAt });
  }
  // Fair bounded round-robin: completed/blocked proposals never starve new work.
  const cursorKey = "BLING_OWNER_ALERT_CURSOR";
  const cursor = await read(sb, userId, cursorKey);
  let query = sb.from("crm_app_secrets").select("name,value").eq("user_id", userId).like("name", `${BLING_ALERT_TRACK}%`).order("name").limit(20);
  if (cursor?.after) query = query.gt("name", cursor.after);
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  let notices = 0;
  let lastVisited = "";
  for (const row of rows ?? []) {
    lastVisited = row.name;
    const track: ProposalTracking = JSON.parse(row.value);
    const { data: replies, error: replyError } = await sb.from("crm_messages").select("at").eq("user_id", userId).eq("contact_id", track.contactId)
      .eq("from_me", false).gt("at", track.sentAt).order("at", { ascending: true }).limit(1);
    if (replyError) throw new Error(replyError.message);
    const kind = alertKind(track, replies?.[0]?.at ?? null, config.activatedAt, now);
    if (kind) {
      try { const state = await sendOwnerProposalNotice({ ...opts, track, kind, now }); if (state !== "already_reserved") notices++; }
      catch (error) { console.error("[bling-owner-notice]", track.proposalId, error); }
    }
    if (notices >= 2) break;
  }
  const { error: cursorError } = await sb.from("crm_app_secrets").upsert({ user_id: userId, name: cursorKey, value: JSON.stringify({ after: notices >= 2 || rows?.length === 20 ? lastVisited : "" }), updated_at: now.toISOString() }, { onConflict: "user_id,name" });
  if (cursorError) throw new Error(cursorError.message);
  return { ran: true, checked: rows?.length ?? 0, notices };
}