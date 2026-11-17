export const BLING_ALERT_CONFIG = "BLING_OWNER_ALERT_CONFIG";
export const BLING_ALERT_TRACK = "BLING_OWNER_TRACK_";
export const BLING_ALERT_NOTICE = "BLING_OWNER_NOTICE_";
export const STAGNANT_HOURS = 120;
export type ProposalTracking = {
  proposalId: string; numero: string; nome: string; contactId: string; sentAt: string;
};
export function alertKind(track: ProposalTracking, replyAt: string | null, activatedAt: string, now: Date): "reply" | "stagnant" | null {
  if (replyAt && Date.parse(replyAt) > Date.parse(track.sentAt)) {
    return Date.parse(replyAt) >= Date.parse(activatedAt) ? "reply" : null;
  }
  return Date.parse(track.sentAt) >= Date.parse(activatedAt) && now.getTime() >= Date.parse(track.sentAt) + STAGNANT_HOURS * 3_600_000 ? "stagnant" : null;
}
export function proposalAlertText(track: ProposalTracking, kind: "reply" | "stagnant") {
  const link = "https://crm.aespa.com.br/inbox";
  return kind === "reply"
    ? `💬 *ZapCRM — resposta de cliente*\n${track.nome} respondeu após o lembrete da proposta ${track.numero}.\nConfira a conversa para saber se a resposta se refere à proposta:\n${link}`
    : `📌 *ZapCRM — proposta sem retorno*\nA proposta ${track.numero}, de ${track.nome}, completou 5 dias desde o primeiro lembrete sem resposta registrada no CRM.\nQue tal entrar em contato pessoalmente?\n${link}`;
}