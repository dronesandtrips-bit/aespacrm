import { describe, expect, it } from "vitest";
import { EMPTY_STATE, decideWatchdog, isLivenessEvent } from "../src/lib/evolution-watchdog";

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

describe("sentinela: sinais de vida e horários", () => {
  it("mensagem enviada pelo celular ou confirmação de entrega conta como sinal (sem alarme falso)", () => {
    const prev = { ...EMPTY_STATE, status: "stuck" as const, restarts: 2, alertedAt: minAgo(60) };
    const d = decideWatchdog({ now: NOW, connection: "open", lastInboundAt: minAgo(150), lastSignalAt: minAgo(10), prev });
    expect(d.action).toBe("none");
    expect(d.next.status).toBe("ok");
  });

  it("sábado à tarde tolera até 3 horas sem sinal", () => {
    const sat = new Date("2026-11-14T19:00:00Z"); // sábado 16:00 SP
    const ago = (m: number) => new Date(sat.getTime() - m * 60_000).toISOString();
    expect(decideWatchdog({ now: sat, connection: "open", lastInboundAt: ago(130), prev: { ...EMPTY_STATE } }).action).toBe("none");
    expect(decideWatchdog({ now: sat, connection: "open", lastInboundAt: ago(190), prev: { ...EMPTY_STATE } }).action).toBe("restart");
  });

  it("dia útil depois das 19h também tolera até 3 horas", () => {
    const eve = new Date("2026-11-12T23:30:00Z"); // quinta 20:30 SP
    const ago = (m: number) => new Date(eve.getTime() - m * 60_000).toISOString();
    expect(decideWatchdog({ now: eve, connection: "open", lastInboundAt: ago(90), prev: { ...EMPTY_STATE } }).action).toBe("none");
  });

  it("só conta como sinal mensagens e confirmações de entrega/leitura", () => {
    expect(isLivenessEvent("messages.upsert")).toBe(true);
    expect(isLivenessEvent("messages.update", "DELIVERY_ACK")).toBe(true);
    expect(isLivenessEvent("messages.update", "READ")).toBe(true);
    expect(isLivenessEvent("messages.update", "SERVER_ACK")).toBe(false);
    expect(isLivenessEvent("connection.update")).toBe(false);
  });
});
