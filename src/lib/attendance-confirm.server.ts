// Confirmação automática de presença a partir da resposta do cliente no WhatsApp.
//
// Fluxo: o lembrete enviado ao cliente pede "Responda SIM para confirmar ou NÃO
// para cancelar". Quando a resposta chega no webhook da Evolution, este módulo
// detecta a intenção, atualiza o status no CRM (crm_appointment_reminders),
// reflete no Google Agenda (título "(confirmado)" ou evento cancelado) e
// responde ao cliente.
//
// Totalmente aditivo e best-effort: qualquer falha é apenas logada.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";
const INSTANCE = "zapcrm";
const PENDING_PREFIX = "(a confirmar)";
const CONFIRMED_PREFIX = "(confirmado)";

export type AttendanceIntent = "confirmed" | "declined" | null;

/** Detecta SIM/NÃO em respostas curtas do cliente. */
export function detectAttendanceIntent(raw: string): AttendanceIntent {
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s👍👎✅❌]/g, " ")
    .trim();
  if (!t || t.length > 60) return null;

  if (
    /^(sim|s|ok|okay|confirmo|confirmado|confirmar|confirma|positivo|isso|combinado|beleza|blz|pode ser|estarei ai|estarei la|vou sim|tudo certo)\b/.test(
      t,
    ) ||
    /^[👍✅]/.test(raw.trim())
  ) {
    return "confirmed";
  }
  if (
    /^(nao|n|negativo|cancelar|cancela|cancele|desmarcar|desmarca|remarcar|remarca|nao vou|nao posso|nao da|nao dara|infelizmente nao)\b/.test(
      t,
    ) ||
    /^[👎❌]/.test(raw.trim())
  ) {
    return "declined";
  }
  return null;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

async function sendWhatsApp(phone: string, text: string) {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!apiUrl || !apiKey || !phone) return;
  const res = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ number: phone.replace(/\D/g, ""), text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[attendance] Evolution [${res.status}]: ${body.slice(0, 200)}`);
  }
}

/** Reflete a resposta do cliente no Google Agenda. */
async function updateGoogleEvent(eventId: string, intent: "confirmed" | "declined") {
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const connKey = process.env.GOOGLE_CALENDAR_API_KEY?.trim();
  if (!lovableKey || !connKey || !eventId) return;

  const url = `${GATEWAY_URL}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`;
  const headers = {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };

  const getRes = await fetch(url, { headers });
  if (!getRes.ok) {
    console.error(`[attendance] GET evento [${getRes.status}]`);
    return;
  }
  let ev: any = null;
  try {
    ev = JSON.parse(await getRes.text());
  } catch {
    return;
  }

  const base = String(ev?.summary ?? "")
    .replace(PENDING_PREFIX, "")
    .replace(CONFIRMED_PREFIX, "")
    .trim();

  const patch: Record<string, unknown> =
    intent === "confirmed"
      ? {
          summary: `${CONFIRMED_PREFIX} ${base}`.trim(),
          extendedProperties: { private: { zapcrmAttendance: "confirmed" } },
        }
      : {
          status: "cancelled",
          extendedProperties: { private: { zapcrmAttendance: "declined" } },
        };

  const res = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(patch) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`[attendance] PATCH evento [${res.status}]: ${t.slice(0, 200)}`);
  }
}

/**
 * Processa uma mensagem recebida do cliente e, se for resposta a um pedido de
 * confirmação, atualiza CRM + Google Agenda.
 */
export async function maybeConfirmAttendance(opts: {
  sb: any;
  userId: string;
  phone: string;
  text: string;
}): Promise<void> {
  const { sb, userId, phone, text } = opts;
  if (!phone || !text) return;

  const intent = detectAttendanceIntent(text);
  if (!intent) return;

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await sb
    .from("crm_appointment_reminders")
    .select("id, event_id, title, start_at, phone, contact_name, attendance_status")
    .eq("user_id", userId)
    .eq("target", "client")
    .eq("phone", phone.replace(/\D/g, ""))
    .eq("attendance_status", "awaiting")
    .gt("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(1);
  if (error) {
    console.error(`[attendance] busca: ${error.message}`);
    return;
  }
  const appt = rows?.[0];
  if (!appt) return;

  // Atualiza todas as linhas do mesmo compromisso (cliente e dono).
  const update: Record<string, unknown> = {
    attendance_status: intent,
    attendance_answered_at: nowIso,
    attendance_reply: text.slice(0, 200),
  };
  let q = sb.from("crm_appointment_reminders").update(update).eq("user_id", userId);
  q = appt.event_id ? q.eq("event_id", appt.event_id) : q.eq("id", appt.id);
  const { error: upErr } = await q;
  if (upErr) console.error(`[attendance] update: ${upErr.message}`);

  if (intent === "declined" && appt.event_id) {
    await sb
      .from("crm_appointment_reminders")
      .update({ status: "canceled" })
      .eq("user_id", userId)
      .eq("event_id", appt.event_id)
      .in("status", ["pending", "paused"]);
  }

  if (appt.event_id) {
    try {
      await updateGoogleEvent(appt.event_id, intent);
    } catch (e: any) {
      console.error(`[attendance] Google: ${e?.message ?? String(e)}`);
    }
  }

  const quando = formatWhen(appt.start_at);
  const clientMsg =
    intent === "confirmed"
      ? `✅ Presença confirmada! Nos vemos em ${quando}. Obrigado!`
      : `❌ Tudo bem, seu compromisso de ${quando} foi cancelado. Se quiser remarcar, é só me chamar.`;
  await sendWhatsApp(appt.phone, clientMsg).catch(() => {});

  const ownerPhone = process.env.ZAPCRM_OWNER_PHONE?.trim() || "5554991495959";
  const ownerMsg =
    intent === "confirmed"
      ? `✅ ${appt.contact_name || appt.phone} CONFIRMOU presença: ${appt.title} — ${quando}`
      : `❌ ${appt.contact_name || appt.phone} CANCELOU: ${appt.title} — ${quando}`;
  await sendWhatsApp(ownerPhone, ownerMsg).catch(() => {});
}
