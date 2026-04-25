// Página standalone (sem chrome do app) renderizada DENTRO do iframe do site cliente.
// Carrega config pública do widget e envia para /api/public/widget/submit.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

type WidgetConfig = {
  id: string;
  title: string;
  subtitle: string | null;
  buttonText: string;
  primaryColor: string;
  successMessage: string;
};

export const Route = createFileRoute("/widget/form/$id")({
  component: WidgetFormPage,
});

function WidgetFormPage() {
  const { id } = Route.useParams();
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot

  useEffect(() => {
    fetch(`/api/public/widget/config/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Widget não encontrado");
        return r.json();
      })
      .then((c) => setConfig(c))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Auto-resize: avisa o parent (script embed) sobre a altura
  useEffect(() => {
    if (!wrapRef.current) return;
    const send = () => {
      const h = wrapRef.current?.scrollHeight ?? 0;
      try {
        window.parent?.postMessage({ type: "zapcrm:resize", id, height: h }, "*");
      } catch {}
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [id, config, done, error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!config || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/widget/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          widget_id: id,
          name,
          phone,
          email,
          message,
          website, // honeypot
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha ao enviar");
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? "Erro ao enviar");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#64748b" }}>
        Carregando…
      </div>
    );
  }
  if (error && !config) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#dc2626" }}>
        {error}
      </div>
    );
  }
  if (!config) return null;

  const c = config.primaryColor;

  return (
    <div
      ref={wrapRef}
      style={{
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        padding: 20,
        background: "#fff",
        color: "#0f172a",
        borderRadius: 12,
      }}
    >
      {done ? (
        <div style={{ textAlign: "center", padding: "32px 8px" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: c,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 16px",
              fontSize: 28,
            }}
          >
            ✓
          </div>
          <p style={{ margin: 0, fontSize: 15 }}>{config.successMessage}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{config.title}</h2>
            {config.subtitle && (
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
                {config.subtitle}
              </p>
            )}
          </div>

          {/* honeypot — invisível para humanos */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            style={{
              position: "absolute",
              left: "-10000px",
              width: 1,
              height: 1,
              opacity: 0,
            }}
            aria-hidden="true"
          />

          <Field label="Nome *" required value={name} onChange={setName} />
          <Field label="Telefone / WhatsApp *" required value={phone} onChange={setPhone} type="tel" />
          <Field label="E-mail" value={email} onChange={setEmail} type="email" />
          <Field label="Mensagem" value={message} onChange={setMessage} textarea />

          {error && (
            <div style={{ fontSize: 13, color: "#dc2626" }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              background: c,
              color: "#fff",
              border: 0,
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Enviando…" : config.buttonText}
          </button>

          <p style={{ margin: 0, fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
            Powered by ZapCRM
          </p>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  textarea,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  textarea?: boolean;
  required?: boolean;
}) {
  const baseStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    boxSizing: "border-box",
    background: "#fff",
  };
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: "#475569" }}>{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          rows={3}
          style={{ ...baseStyle, resize: "vertical", minHeight: 70 }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          style={baseStyle}
        />
      )}
    </label>
  );
}
