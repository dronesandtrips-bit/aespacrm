import { describe, expect, it } from "bun:test";
import { resolveProposalCliente, splitClienteField } from "../src/server/bling.server";

describe("Bling proposal Cliente field", () => {
  it("uses the penultimate item as the client name", () => {
    expect(splitClienteField("Projeto CFTV Tais 555484057527").nome).toBe("Tais");
  });
  it("uses the last item as the phone", () => {
    expect(splitClienteField("Projeto CFTV Tais 555484057527").phone).toBe("555484057527");
  });
  it("does not accept a phone before the client name", () => {
    expect(splitClienteField("555484057527 Tais").phone).toBe("");
  });
  it("leaves a missing or invalid final phone unavailable", () => {
    expect(splitClienteField("Projeto CFTV Tais").phone).toBe("");
    expect(splitClienteField("Projeto CFTV Tais 123").phone).toBe("");
  });
  it("resolves the referenced Cliente using the same final-item rule", async () => {
    const ids: string[] = [];
    const result = await resolveProposalCliente({ contato: { id: 550 } }, async (id) => {
      ids.push(id);
      return { nome: "Projeto CFTV Tais 555484057527", celular: "5554999999999" };
    });
    expect(ids).toEqual(["550"]);
    expect(result).toEqual({ nome: "Tais", phone: "555484057527", phoneRaw: "555484057527" });
  });
  it("never uses Introduction, other proposal text or separate phone fields", async () => {
    const proposal = {
      contato: { id: 550 }, introducao: "Lucélia 555591392177",
      observacoes: "Outro 5554999999999", telefone: "5554999999999",
    };
    const result = await resolveProposalCliente(proposal, async () => ({ nome: "Projeto CFTV Tais", telefone: "5554999999999" }));
    expect(result.phone).toBe("");
  });
});
