import { describe, expect, it } from "bun:test";
import { DEFAULT_AUTO_CONFIG, withOptout } from "../src/server/bling-auto.server";

describe("Bling: cadência de envios", () => {
  it("1º envio 24h após detectar", () => expect(DEFAULT_AUTO_CONFIG.delayMin).toBe(1440));
  it("lembretes 72h e 5 dias após o 1º envio", () =>
    expect(DEFAULT_AUTO_CONFIG.followups.map((f) => f.hours)).toEqual([72, 120]));
  it("link de descadastro sempre no final", () =>
    expect(withOptout("Oi", "https://crm.aespa.com.br/d/abc")).toContain("https://crm.aespa.com.br/d/abc"));
});
