import { describe, expect, test } from "bun:test";
import { buildLidMap, dedupeByMessageId, recoverableRecords, resolveChatJid, unresolvedLids } from "../src/lib/evolution-catchup";

describe("resolveChatJid", () => {
  test("mensagem do celular para o próprio número (@lid) usa o número real", () => {
    expect(
      resolveChatJid({ remoteJid: "124064542814283@lid", remoteJidAlt: "555491495959@s.whatsapp.net" }),
    ).toBe("555491495959@s.whatsapp.net");
  });
  test("@lid sem número real é ignorado", () => {
    expect(resolveChatJid({ remoteJid: "205918432186493@lid" })).toBe("");
  });
  test("conversa individual e grupo continuam iguais", () => {
    expect(resolveChatJid({ remoteJid: "555484272263@s.whatsapp.net" })).toBe("555484272263@s.whatsapp.net");
    expect(resolveChatJid({ remoteJid: "120363020391758258@g.us" })).toBe("120363020391758258@g.us");
  });
  test("status/broadcast é ignorado", () => {
    expect(resolveChatJid({ remoteJid: "status@broadcast" })).toBe("");
  });
});

describe("número aprendido para conversas @lid", () => {
  test("mensagem @lid sem número usa o número de outra mensagem da mesma conversa", () => {
    const records = [
      { key: { id: "A", remoteJid: "124064542814283@lid", remoteJidAlt: "555491495959@s.whatsapp.net" } },
      { key: { id: "B", remoteJid: "124064542814283@lid" } },
    ];
    const map = buildLidMap(records);
    expect(resolveChatJid(records[1].key, map)).toBe("555491495959@s.whatsapp.net");
    expect(unresolvedLids(records, map)).toEqual([]);
  });
  test("conversa @lid desconhecida continua pendente", () => {
    const records = [{ key: { id: "C", remoteJid: "205918432186493@lid" } }];
    expect(unresolvedLids(records, buildLidMap(records))).toEqual(["205918432186493@lid"]);
  });
});

describe("recoverableRecords", () => {
  const rec = (id: string, ts: number, jid = "555484272263@s.whatsapp.net") => ({
    key: { id, remoteJid: jid },
    messageTimestamp: ts,
  });
  test("remove a mesma mensagem duplicada", () => {
    expect(dedupeByMessageId([rec("A", 10), rec("A", 10), rec("B", 11)]).map((r) => r.key.id)).toEqual(["A", "B"]);
  });
  test("ignora mensagens fora da janela e conversas inválidas", () => {
    const out = recoverableRecords([rec("A", 99), rec("B", 100), rec("C", 200, "status@broadcast")], 100);
    expect(out.map((r) => r.key.id)).toEqual(["B"]);
  });
});
