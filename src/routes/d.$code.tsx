// Página pública /d/$code — confirmação de descadastro via SHORTLINK.
// Standalone (sem chrome do app, sem auth). Mesmo fluxo de /u/$token,
// mas usa /api/public/optout/short-* em vez do token HMAC.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/d/$code")({
  component: OptOutShortPage,
  head: () => ({
    meta: [
      { title: "Descadastrar mensagens" },
      { name: "description", content: "Página para confirmar descadastro de mensagens automáticas." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Descadastrar mensagens" },
      { property: "og:description", content: "Confirme seu descadastro." },
    ],
  }),
});

type Info = {
  ok: true;
  phone_masked: string;
  already_opted_out: boolean;
  first_name: string;
};

type Status =
  | { kind: "loading" }
  | { kind: "ready"; info: Info }
  | { kind: "submitting"; info: Info }
  | { kind: "done"; info: Info }
  | { kind: "reversing"; info: Info }
  | { kind: "reversed"; info: Info }
  | { kind: "error"; message: string };

function OptOutShortPage() {
  const { code } = Route.useParams();
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/public/optout/short-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok || !data?.ok) {
          setStatus({
            kind: "error",
            message: "Link inválido ou expirado. Se o problema persistir, entre em contato.",
          });
          return;
        }
        const info: Info = {
          ok: true,
          phone_masked: data.phone_masked,
          already_opted_out: !!data.already_opted_out,
          first_name: data.first_name ?? "",
        };
        setStatus(info.already_opted_out ? { kind: "done", info } : { kind: "ready", info });
      } catch {
        if (!cancelled) {
          setStatus({ kind: "error", message: "Falha ao carregar. Verifique sua conexão." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function handleConfirm() {
    if (status.kind !== "ready") return;
    const prev = status;
    setStatus({ kind: "submitting", info: prev.info });
    try {
      const r = await fetch("/api/public/optout/short-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        setStatus({ kind: "error", message: "Falha ao descadastrar. Tente novamente." });
        return;
      }
      setStatus({ kind: "done", info: prev.info });
    } catch {
      setStatus({ kind: "error", message: "Falha de conexão. Tente novamente." });
    }
  }

  async function handleReverse() {
    if (status.kind !== "done") return;
    const prev = status;
    setStatus({ kind: "reversing", info: prev.info });
    try {
      const r = await fetch("/api/public/optout/short-reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        setStatus({ kind: "error", message: "Falha ao reativar. Tente novamente." });
        return;
      }
      setStatus({ kind: "reversed", info: prev.info });
    } catch {
      setStatus({ kind: "error", message: "Falha de conexão. Tente novamente." });
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-8">
        {status.kind === "loading" && (
          <div className="text-center text-muted-foreground">Carregando…</div>
        )}

        {status.kind === "error" && (
          <div className="text-center space-y-3">
            <div className="text-4xl">⚠️</div>
            <h1 className="text-xl font-semibold">Não foi possível processar</h1>
            <p className="text-sm text-muted-foreground">{status.message}</p>
          </div>
        )}

        {(status.kind === "ready" || status.kind === "submitting") && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="text-4xl">🔕</div>
              <h1 className="text-xl font-semibold">Descadastrar mensagens</h1>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {status.info.first_name ? `Olá, ${status.info.first_name}. ` : ""}
              Você está prestes a parar de receber mensagens automáticas neste número:
            </p>
            <div className="text-center text-lg font-mono tracking-wider bg-muted rounded-lg py-3">
              +{status.info.phone_masked}
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={status.kind === "submitting"}
                className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-60"
              >
                {status.kind === "submitting" ? "Processando…" : "Confirmar descadastro"}
              </button>
              <p className="text-xs text-center text-muted-foreground">
                Você pode reativar a qualquer momento.
              </p>
            </div>
          </div>
        )}

        {(status.kind === "done" || status.kind === "reversing") && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="text-4xl">✅</div>
              <h1 className="text-xl font-semibold">
                {status.info.first_name ? `Pronto, ${status.info.first_name}!` : "Pronto!"}
              </h1>
              <p className="text-sm text-muted-foreground">
                Você não receberá mais mensagens automáticas no número{" "}
                <span className="font-mono">+{status.info.phone_masked}</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={handleReverse}
              disabled={status.kind === "reversing"}
              className="w-full h-11 rounded-lg border border-border text-foreground font-medium hover:bg-muted transition disabled:opacity-60"
            >
              {status.kind === "reversing" ? "Reativando…" : "Voltar a receber mensagens"}
            </button>
          </div>
        )}

        {status.kind === "reversed" && (
          <div className="text-center space-y-3">
            <div className="text-4xl">🔔</div>
            <h1 className="text-xl font-semibold">Reativado</h1>
            <p className="text-sm text-muted-foreground">
              Você voltou a receber mensagens no número{" "}
              <span className="font-mono">+{status.info.phone_masked}</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
