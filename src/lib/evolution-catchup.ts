// Regras puras da recuperação automática de mensagens (catch-up).
//
// A Evolution guarda as mensagens no próprio banco mesmo quando o aviso
// (webhook) para o ZapCRM se perde durante quedas/reconexões. O catch-up lê
// esse histórico recente (somente leitura — nunca envia nada) e grava no CRM
// apenas o que ainda não existe.

export type EvolutionKey = {
  id?: string;
  remoteJid?: string;
  remoteJidAlt?: string;
  senderPn?: string;
  fromMe?: boolean;
};

const isIndividual = (jid: string) => /@(s\.whatsapp\.net|c\.us)$/i.test(jid);
const isGroup = (jid: string) => /@g\.us$/i.test(jid);

/**
 * Resolve o JID da conversa. Mensagens enviadas pelo celular (inclusive para o
 * próprio número) podem chegar no formato "@lid"; nesse caso a Evolution
 * informa o número real em `remoteJidAlt` (ou `senderPn`).
 * Devolve "" quando não é uma conversa individual ou de grupo.
 */
export function resolveChatJid(key: EvolutionKey | null | undefined): string {
  const primary = String(key?.remoteJid ?? "").trim();
  if (isIndividual(primary) || isGroup(primary)) return primary;
  if (/@lid$/i.test(primary)) {
    for (const alt of [key?.remoteJidAlt, key?.senderPn]) {
      const a = String(alt ?? "").trim();
      if (isIndividual(a)) return a;
    }
  }
  return "";
}

export function isGroupChatJid(jid: string): boolean {
  return isGroup(jid);
}

/** Remove registros duplicados (a Evolution às vezes guarda a mesma mensagem 2x). */
export function dedupeByMessageId<T extends { key?: EvolutionKey }>(records: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of records) {
    const id = String(r?.key?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

/** Mantém só mensagens dentro da janela (em segundos) e com conversa válida. */
export function recoverableRecords<T extends { key?: EvolutionKey; messageTimestamp?: number | string }>(
  records: T[],
  sinceSec: number,
): T[] {
  return dedupeByMessageId(records).filter((r) => {
    const ts = Number(r?.messageTimestamp);
    return Number.isFinite(ts) && ts >= sinceSec && resolveChatJid(r.key) !== "";
  });
}
