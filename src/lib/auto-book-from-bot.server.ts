// Detecta agendamentos fechados pelo Robô nas mensagens enviadas (from_me)
// e cria o evento "(a confirmar)" via /api/public/calendar/auto-book.
//
// Totalmente aditivo e best-effort: qualquer falha aqui é apenas logada e
// nunca interrompe o processamento do webhook da Evolution.

import { detectAppointment } from "@/lib/appointment-detect";

function publicBase(): string {
  return (
    process.env.ZAPCRM_PUBLIC_URL?.trim().replace(/\/+$/, "") ?? "https://crm.aespa.com.br"
  );
}

/** Desliga o detector com ZAPCRM_AUTO_BOOK=off */
function isEnabled(): boolean {
  const v = process.env.ZAPCRM_AUTO_BOOK?.trim().toLowerCase();
  return v !== "off" && v !== "0" && v !== "false";
}

export async function maybeAutoBookFromBotMessage(opts: {
  sb: any;
  userId: string;
  phone: string;
  name?: string | null;
  text: string;
}): Promise<void> {
  const { sb, userId, phone, name, text } = opts;
  if (!isEnabled()) return;
  if (!phone || !text) return;

  const hit = detectAppointment(text);
  if (!hit) return;

  const apiKey = process.env.N8N_API_KEY?.trim();
  if (!apiKey) {
    console.error("[auto-book-detect] N8N_API_KEY ausente — ignorando detecção");
    return;
  }

  // Dedup: já existe lembrete para este telefone em ±30 min do horário?
  const start = new Date(hit.startISO);
  const from = new Date(start.getTime() - 30 * 60_000).toISOString();
  const to = new Date(start.getTime() + 30 * 60_000).toISOString();
  const { data: dup } = await sb
    .from("crm_appointment_reminders")
    .select("id")
    .eq("user_id", userId)
    .eq("phone", phone)
    .gte("start_at", from)
    .lte("start_at", to)
    .limit(1);
  if (dup?.length) return;

  const res = await fetch(`${publicBase()}/api/public/calendar/auto-book`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      phone,
      name: name ?? undefined,
      startISO: hit.startISO,
      durationMinutes: 60,
      title: `Atendimento — ${name?.trim() || phone}`,
      description: `Detectado automaticamente na conversa do Robô (${hit.matched}).`,
      userId,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[auto-book-detect] auto-book falhou [${res.status}]: ${body.slice(0, 300)}`);
  }
}
