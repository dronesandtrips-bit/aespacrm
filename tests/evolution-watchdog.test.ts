import { describe, expect, it } from "vitest";
import { EMPTY_STATE, decideWatchdog } from "../src/lib/evolution-watchdog";

// 15:00 em São Paulo (horário ativo) = 18:00 UTC
const NOW = new Date("2026-11-12T18:00:00Z");
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("sentinela da conexão", () => {
  it("não age se houve mensagem recebida há menos de 45 min", () => {
    const d = decideWatchdog({ now: NOW, connection: "open", lastInboundAt: minAgo(30), prev: { ...EMPTY_STATE } });
    expect(d.action).toBe("none");
    expect(d.next.status).toBe("ok");
  });

  it("reinicia após 45 min sem receber, no horário ativo", () => {
    const d = decideWatchdog({ now: NOW, connection: "open", lastInboundAt: minAgo(50), prev: { ...EMPTY_STATE } });
    expect(d.action).toBe("restart");
    expect(d.next.restarts).toBe(1);
  });

  it("não reinicia de madrugada (fora das 8h–22h de São Paulo)", () => {
    const night = new Date("2026-11-13T05:00:00Z"); // 02:00 SP
    const d = decideWatchdog({ now: night, connection: "open", lastInboundAt: minAgo(300), prev: { ...EMPTY_STATE } });
    expect(d.action).toBe("none");
  });

  it("após 2 reinícios sem sucesso, avisa uma única vez", () => {
    const prev = { ...EMPTY_STATE, restarts: 2, lastRestartAt: minAgo(25), incidentSince: minAgo(70) };
    const first = decideWatchdog({ now: NOW, connection: "open", lastInboundAt: minAgo(120), prev });
    expect(first.action).toBe("alert");
    expect(first.next.status).toBe("stuck");
    const second = decideWatchdog({ now: NOW, connection: "open", lastInboundAt: minAgo(125), prev: first.next });
    expect(second.action).toBe("none");
  });

  it("espera 20 min entre reinícios", () => {
    const prev = { ...EMPTY_STATE, restarts: 1, lastRestartAt: minAgo(10), incidentSince: minAgo(10) };
    const d = decideWatchdog({ now: NOW, connection: "open", lastInboundAt: minAgo(60), prev });
    expect(d.action).toBe("none");
  });

  it("sessão encerrada no celular (401) pede novo QR, sem reiniciar", () => {
    const d = decideWatchdog({ now: NOW, connection: "close", disconnectionReasonCode: 401, lastInboundAt: minAgo(10), prev: { ...EMPTY_STATE } });
    expect(d.action).toBe("alert");
    expect(d.next.status).toBe("logged_out");
  });
});
