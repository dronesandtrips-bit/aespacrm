import { expect, test } from "bun:test";
import { agendaEntryView, AGENDA_PENDING_URL } from "../src/lib/agenda-closure";

test("link do resumo abre pendências sem executar uma ação", () => {
  const url = new URL(AGENDA_PENDING_URL);
  expect(url.pathname).toBe("/agenda");
  expect(agendaEntryView(url.searchParams.get("view"))).toBe("pendentes");
  expect(url.searchParams.has("action")).toBe(false);
});
test("entrada comum preserva semana e rejeita valores desconhecidos", () => {
  expect(agendaEntryView(undefined)).toBe("semana");
  expect(agendaEntryView("completed")).toBe("semana");
  expect(agendaEntryView("lista")).toBe("lista");
});