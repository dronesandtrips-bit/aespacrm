import { describe, expect, test } from "bun:test";
import { chatSendError, chatSendState } from "../src/lib/chat-send-state";

describe("confirmações de envio no chat", () => {
  test("falha Connection Closed registrada não é envio confirmado", () => {
    expect(chatSendState("failed")).toBe("failed");
  });
  test("anexo pendente e resultado incerto não são envio confirmado", () => {
    expect(chatSendState("pending")).toBe("pending");
    expect(chatSendState("uncertain")).toBe("pending");
    expect(chatSendState(null)).toBe("pending");
  });
  test("server_ack indica aceitação pelo servidor e não entrega ao cliente", () => {
    expect(chatSendState("2")).toBe("sent");
    expect(chatSendState("server_ack")).toBe("sent");
    expect(chatSendState("3")).toBe("delivered");
    expect(chatSendState("delivery_ack")).toBe("delivered");
    expect(chatSendState("read")).toBe("read");
  });
  test("interpreta Connection Closed em resposta de texto e mídia", () => {
    const error = { status: 500, response: { message: ["Error: Connection Closed"] } };
    expect(chatSendError(error)).toBe(chatSendError(JSON.stringify(error)));
    expect(chatSendError("outra falha")).toBe("outra falha");
  });
});