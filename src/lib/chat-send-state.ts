export function chatSendState(status: string | null | undefined) {
  const value = (status ?? "").toLowerCase();
  if (["failed", "error", "0"].includes(value)) return "failed";
  if (["4", "5", "read", "read_ack", "played", "played_ack"].includes(value)) return "read";
  if (["3", "delivery_ack", "delivered"].includes(value)) return "delivered";
  if (["2", "server_ack", "sent"].includes(value)) return "sent";
  return "pending";
}

export function chatSendError(error: unknown): string {
  const text = typeof error === "string" ? error : JSON.stringify(error ?? "");
  if (/connection closed/i.test(text)) {
    return "A conexão do WhatsApp do ZapCRM foi encerrada. Abra WhatsApp no menu e reconecte pelo QR Code. Não há confirmação deste envio; confira a conversa no celular antes de tentar novamente.";
  }
  return text;
}