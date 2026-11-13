import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { getSupabaseClient } from "@/integrations/supabase/client";

type State = { status: string; lastInboundAt: string | null };

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Faixa no topo do CRM quando a sentinela detecta a conexão parada. */
export function ConnectionHealthBanner() {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const c = await getSupabaseClient();
        const token = c ? (await c.auth.getSession()).data.session?.access_token : null;
        if (!token) return;
        const r = await fetch("/api/public/evolution/watchdog", { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json().catch(() => null);
        if (!stopped && j?.ok) setState(j.state);
      } catch {
        /* silencioso: a faixa é só um aviso */
      }
    };
    void load();
    const t = window.setInterval(load, 60_000);
    return () => { stopped = true; window.clearInterval(t); };
  }, []);

  if (!state) return null;
  if (state.status === "restarting") {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-xs bg-warning/15 text-foreground border-b border-warning/40">
        <Loader2 className="size-3.5 animate-spin text-warning" />
        Nenhuma mensagem recebida desde {fmt(state.lastInboundAt)}. Reiniciando a conexão do WhatsApp automaticamente…
      </div>
    );
  }
  if (state.status === "stuck" || state.status === "logged_out") {
    return (
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm bg-destructive/10 text-destructive border-b border-destructive/40">
        <AlertTriangle className="size-4" />
        <span>
          {state.status === "logged_out"
            ? "O WhatsApp foi desconectado no celular. As mensagens não estão chegando ao CRM."
            : `A conexão do WhatsApp parou de receber mensagens (última: ${fmt(state.lastInboundAt)}).`}
        </span>
        <Link to="/whatsapp" className="underline font-semibold">Reconectar agora</Link>
      </div>
    );
  }
  return null;
}
