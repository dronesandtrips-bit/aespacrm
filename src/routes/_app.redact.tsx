import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, Shield, Eraser } from "lucide-react";

export const Route = createFileRoute("/_app/redact")({
  head: () => ({
    meta: [
      { title: "Redigir Segredos | ZapCRM" },
      { name: "description", content: "Cole YAML/env/JSON e obtenha uma versão sanitizada, com chaves sensíveis substituídas por placeholders antes de compartilhar." },
      { property: "og:title", content: "Redigir Segredos | ZapCRM" },
      { property: "og:description", content: "Sanitize YAML/env/JSON antes de compartilhar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RedactPage,
});

// Chaves cujo valor sempre deve ser mascarado (case-insensitive, match parcial)
const SENSITIVE_KEY_PATTERNS = [
  "api_key", "apikey", "api-key",
  "secret", "token", "password", "passwd", "pwd",
  "auth", "authorization", "bearer",
  "private_key", "privatekey",
  "database_url", "database_uri", "db_url", "db_uri", "connection_uri", "connection_string",
  "dsn",
  "jwt", "session",
  "webhook_secret", "signing_secret",
  "access_key", "secret_key",
  "client_secret",
  "smtp_pass", "smtp_password",
  "encryption_key",
  "service_role",
  "anon_key", "publishable_key",
  "sentry_dsn",
];

// Padrões de valores que são obviamente segredos, mesmo sem chave conhecida
const VALUE_PATTERNS: { re: RegExp; placeholder: string }[] = [
  // Postgres/Mysql/Mongo com credenciais
  { re: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s"'<>]+:[^\s"'<>@]+@[^\s"'<>]+/gi, placeholder: "URI_COM_CREDENCIAIS_REDIGIDA" },
  // Supabase keys
  { re: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/g, placeholder: "SUPABASE_KEY_REDIGIDA" },
  // JWT
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, placeholder: "JWT_REDIGIDO" },
  // Stripe / OpenAI / GitHub / etc
  { re: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}/g, placeholder: "STRIPE_KEY_REDIGIDA" },
  { re: /\bsk-[A-Za-z0-9_-]{20,}/g, placeholder: "API_KEY_REDIGIDA" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, placeholder: "GITHUB_TOKEN_REDIGIDO" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, placeholder: "SLACK_TOKEN_REDIGIDO" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, placeholder: "AWS_ACCESS_KEY_REDIGIDA" },
  // Chaves privadas PEM
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, placeholder: "-----PRIVATE_KEY_REDIGIDA-----" },
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

function placeholderFor(key: string): string {
  // Normaliza para SCREAMING_SNAKE_CASE
  const norm = key
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `SUA_${norm || "SECRET"}`;
}

function stripQuotes(v: string): { quote: string; inner: string; trailing: string } {
  const m = v.match(/^(\s*)(["']?)(.*?)\2(\s*(?:#.*)?)$/s);
  if (!m) return { quote: "", inner: v, trailing: "" };
  return { quote: m[2] || "", inner: m[3], trailing: m[4] || "" };
}

function redact(input: string): { output: string; count: number } {
  let count = 0;
  const lines = input.split(/\r?\n/);

  const redactedLines = lines.map((line) => {
    // Preserva indentação e comentários
    // YAML: key: value    |  ENV/dotenv: KEY=value    |  export KEY=value
    const yamlMatch = line.match(/^(\s*-?\s*)([A-Za-z_][A-Za-z0-9_.-]*)(\s*:\s*)(.*)$/);
    const envMatch = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);

    const m = yamlMatch || envMatch;
    if (m) {
      const [, prefix, key, sep, rawValue] = m;
      if (isSensitiveKey(key) && rawValue.trim() !== "" && !rawValue.trim().startsWith("#")) {
        const { quote, inner, trailing } = stripQuotes(rawValue);
        // Se o valor já é um placeholder (SUA_..., ${...}, <...>, xxx), mantém
        const looksPlaceholder =
          /^(SUA_|COLOQUE_|REPLACE_|CHANGE_|YOUR_|<.*>|\$\{.*\}|xxx+|\*+)$/i.test(inner.trim());
        if (!looksPlaceholder && inner.trim().length > 0) {
          count += 1;
          const ph = placeholderFor(key);
          const q = quote || '"';
          return `${prefix}${key}${sep}${q}${ph}${q}${trailing}`;
        }
      }
    }

    // JSON-ish: "key": "value"
    const jsonLine = line.replace(
      /("(?:[^"\\]|\\.)*")(\s*:\s*)"((?:[^"\\]|\\.)*)"/g,
      (full, k: string, sep: string, v: string) => {
        const keyName = k.slice(1, -1);
        if (isSensitiveKey(keyName) && v.length > 0) {
          count += 1;
          return `${k}${sep}"${placeholderFor(keyName)}"`;
        }
        return full;
      },
    );
    if (jsonLine !== line) return jsonLine;

    return line;
  });

  let output = redactedLines.join("\n");

  // Segunda passada: padrões de valor conhecidos (JWT, URIs com senha, sk_live_..., etc.)
  for (const { re, placeholder } of VALUE_PATTERNS) {
    output = output.replace(re, () => {
      count += 1;
      return placeholder;
    });
  }

  return { output, count };
}

function RedactPage() {
  const [input, setInput] = useState("");
  const { output, count } = useMemo(() => (input ? redact(input) : { output: "", count: 0 }), [input]);

  const copy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    toast.success("Copiado para a área de transferência");
  };

  return (
    <div className="container mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Redigir Segredos</h1>
          <p className="text-sm text-muted-foreground">
            Cole YAML, docker-compose, .env ou JSON. Chaves sensíveis (API keys, tokens, senhas, URIs com credenciais, JWT) são
            substituídas por placeholders automaticamente antes de você compartilhar. O processamento é 100% local no seu navegador.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Entrada (com segredos)</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setInput("")}>
              <Eraser className="h-4 w-4 mr-1" /> Limpar
            </Button>
          </CardHeader>
          <CardContent>
            <Label htmlFor="in" className="sr-only">Entrada</Label>
            <Textarea
              id="in"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Cole aqui. Ex.:\n\nservices:\n  evolution:\n    environment:\n      AUTHENTICATION_API_KEY: "abc123realkey"\n      DATABASE_CONNECTION_URI: "postgres://user:senha@host/db"`}
              className="font-mono text-xs min-h-[420px]"
              spellCheck={false}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Saída redigida {count > 0 && <span className="text-xs text-muted-foreground">({count} substituição{count === 1 ? "" : "ões"})</span>}
            </CardTitle>
            <Button size="sm" onClick={copy} disabled={!output}>
              <Copy className="h-4 w-4 mr-1" /> Copiar
            </Button>
          </CardHeader>
          <CardContent>
            <Textarea
              readOnly
              value={output}
              placeholder="A versão sanitizada aparecerá aqui."
              className="font-mono text-xs min-h-[420px] bg-muted/30"
              spellCheck={false}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">O que é detectado</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p><strong>Por nome de chave:</strong> api_key, apikey, secret, token, password, auth, authorization, bearer, private_key, database_url/uri, connection_uri, dsn, jwt, session, webhook_secret, access_key, client_secret, smtp_pass, service_role, anon_key, publishable_key, sentry_dsn.</p>
          <p><strong>Por formato do valor:</strong> URIs com credenciais (postgres://user:senha@...), JWT (eyJ...), chaves Stripe (sk_live_/pk_test_/...), OpenAI (sk-...), GitHub (ghp_/gho_/...), Slack (xoxb-...), AWS (AKIA...), Supabase (sb_secret_/sb_publishable_), blocos PEM de chave privada.</p>
          <p><strong>Não é enviado nada para o servidor.</strong> Se quiser conferir, abra o DevTools → Network enquanto cola.</p>
        </CardContent>
      </Card>
    </div>
  );
}
