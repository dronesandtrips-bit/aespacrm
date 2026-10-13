/** Read-only presentation helpers. Dispatch and scheduling stay database-authoritative. */
export type MonitorSequence = {
  id: string; name: string; is_active: boolean; window_start_hour: number;
  window_end_hour: number; window_days: number[]; client_interval_seconds: number;
  recurrence_enabled: boolean; recurrence_activated_at: string | null; next_client_at: string | null;
};
export type MonitorContact = { name: string; phone: string; is_ignored: boolean };
export type MonitorEnrollment = {
  id: string; sequence_id: string; contact_id: string; current_step: number; status: string;
  next_send_at: string | null; pause_reason: string | null; paused_at?: string | null; started_at: string;
  crm_contacts: MonitorContact | null;
};
export type MonitorLog = {
  id: string; contact_sequence_id: string; step_order: number; message: string;
  status: string; error: string | null; sent_at: string;
  occurrence_id: string | null; dispatch_claim_id: string | null;
  contact_sequences: { sequence_id: string; crm_contacts: MonitorContact | null; crm_sequences: { name: string } | null } | null;
};
export type MonitorOccurrence = {
  id: string; sequence_id: string; contact_sequence_id: string; scheduled_date: string;
  scheduled_at: string; current_step: number; next_send_at: string | null; status: string; completed_at: string | null;
};
export type MonitorClaim = {
  id: string; sequence_id: string; contact_sequence_id: string; occurrence_id: string | null;
  step_order: number; reserved_at: string; status: string;
};
export type MonitorSnapshot = {
  sequences: MonitorSequence[]; enrollments: MonitorEnrollment[]; logs: MonitorLog[];
  occurrences: MonitorOccurrence[]; claims: MonitorClaim[];
  steps: { sequence_id: string; order: number }[];
  warnings: string[]; claimsAvailable: boolean; occurrencesAvailable: boolean;
};
export const emptySnapshot: MonitorSnapshot = {
  sequences: [], enrollments: [], logs: [], occurrences: [], claims: [], steps: [],
  warnings: [], claimsAvailable: false, occurrencesAvailable: false,
};
export function spDay(date: Date | string = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
}
export function spTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" });
}
export function dateBounds(start: string, end: string) {
  return { since: start ? new Date(`${start}T00:00:00-03:00`).toISOString() : null,
    until: end ? new Date(new Date(`${end}T00:00:00-03:00`).getTime() + 86400_000).toISOString() : null };
}
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function logsCsv(logs: MonitorLog[]): string {
  const rows = [["Data (São Paulo)", "Sequência", "Contato", "Telefone", "Etapa", "Resultado", "Mensagem", "Erro", "Rodada", "Registro"]];
  logs.forEach(log => rows.push([spTime(log.sent_at), log.contact_sequences?.crm_sequences?.name ?? "Sequência removida",
    log.contact_sequences?.crm_contacts?.name ?? "Contato removido", log.contact_sequences?.crm_contacts?.phone ?? "",
    String(log.step_order), log.status === "sent" ? "Aceito pela API" : "Falhou", log.message, log.error ?? "", log.occurrence_id ?? "", log.id]));
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n");
}
export function canProceed(enrollment: MonitorEnrollment | undefined, sequence: MonitorSequence | undefined) {
  return Boolean(enrollment?.crm_contacts && sequence?.is_active && !enrollment.crm_contacts.is_ignored && ["active", "completed"].includes(enrollment.status));
}
export const pauseLabels: Record<string, string> = {
  inbound_reply: "Contato respondeu", invalid_whatsapp_number: "Número inválido no WhatsApp",
  blacklisted: "Contato excluído dos envios", manual: "Pausa manual", stage_changed: "Mudança de etapa",
};
export function pausedEnrollments(enrollments: MonitorEnrollment[], reason = "all") {
  return enrollments.filter(e => e.status === "paused" && (reason === "all" || e.pause_reason === reason));
}