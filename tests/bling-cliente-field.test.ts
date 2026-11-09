import { describe, expect, it } from "bun:test";
import { splitClienteField } from "../src/server/bling.server";

describe("Bling proposal Cliente field", () => {
  it("extracts WhatsApp typed with the name and cleans the name", () => {
    const r = splitClienteField("João Silva (54) 99149-5959");
    expect(r.nome).toBe("João Silva");
    expect(r.phone).toContain("54991495959");
  });
  it("handles phone before the name", () => {
    const r = splitClienteField("54991495959 - Maria Souza");
    expect(r.nome).toBe("Maria Souza");
    expect(r.phone).toContain("54991495959");
  });
  it("keeps plain names without phone untouched", () => {
    expect(splitClienteField("Eldorado Caxias")).toEqual({ nome: "Eldorado Caxias", phone: "", phoneRaw: null });
  });
});
