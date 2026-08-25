// Prompt do Robô — versionamento do system prompt consumido pelo n8n.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  Copy,
  FileText,
  History,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { botPromptsDb, type BotPrompt } from "@/lib/db";

export const Route = createFileRoute("/_app/robo-prompt")({
  component: RoboPromptPage,
  head: () => ({
    meta: [
      { title: "Prompt do Robô | Aespa CRM" },
      {
        name: "description",
        content:
          "Crie, edite e troque versões do system prompt do Robô do WhatsApp usado pelo fluxo no n8n.",
      },
      { property: "og:title", content: "Prompt do Robô | Aespa CRM" },
      {
        property: "og:description",
        content: "Versionamento do system prompt do Robô com ativação e rollback em um clique.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function RoboPromptPage() {
  const [items, setItems] = useState<BotPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  async function load(preferId?: string) {
    setLoading(true);
    try {
      const rows = await botPromptsDb.list();
      setItems(rows);
      const pick = preferId
        ? rows.find((r) => r.id === preferId)
        : (rows.find((r) => r.isActive) ?? rows[0]);
      if (pick) {
        setSelectedId(pick.id);
        setTitle(pick.title);
        setContent(pick.content);
      } else {
        setSelectedId(null);
        setTitle("");
        setContent("");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao carregar versões");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function selectVersion(p: BotPrompt) {
    setSelectedId(p.id);
    setTitle(p.title);
    setContent(p.content);
  }

  async function saveEdits() {
    if (!selected) return;
    setSaving(true);
    try {
      await botPromptsDb.update(selected.id, { title, content });
      toast.success(`Versão ${selected.version} salva`);
      await load(selected.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function createVersion(activate: boolean) {
    setSaving(true);
    try {
      const created = await botPromptsDb.create({
        title: title.trim() || undefined as any,
        content,
        activate,
      });
      toast.success(
        activate ? `Versão ${created.version} criada e ativada` : `Versão ${created.version} criada`,
      );
      await load(created.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao criar versão");
    } finally {
      setSaving(false);
    }
  }

  async function activate(p: BotPrompt) {
    setBusyId(p.id);
    try {
      await botPromptsDb.activate(p.id);
      toast.success(`Versão ${p.version} ativada — o Robô já usa esse prompt`);
      await load(p.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao ativar");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(p: BotPrompt) {
    if (p.isActive) {
      toast.error("Ative outra versão antes de apagar esta");
      return;
    }
    if (!confirm(`Apagar a versão ${p.version}?`)) return;
    setBusyId(p.id);
    try {
      await botPromptsDb.remove(p.id);
      toast.success("Versão apagada");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao apagar");
    } finally {
      setBusyId(null);
    }
  }

  const endpoint = "https://crm.aespa.com.br/api/public/ai/system-prompt";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <FileText className="h-6 w-6 text-primary" />
          Prompt do Robô
        </h1>
        <p className="text-sm text-muted-foreground">
          Guarde versões do system prompt e troque a versão ativa quando precisar corrigir as
          respostas. O fluxo no n8n lê sempre a versão ativa.
        </p>
      </header>

      <Card className="space-y-2 p-4">
        <Label className="text-xs uppercase text-muted-foreground">Endpoint para o n8n</Label>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 text-xs">GET {endpoint}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(endpoint);
              toast.success("Endpoint copiado");
            }}
          >
            <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Header obrigatório <code>x-api-key</code>. Use <code>?version=2</code> para testar uma
          versão específica sem trocar a ativa. Resposta: <code>{"{ ok, version, content }"}</code>.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <History className="h-4 w-4" /> Versões
          </div>
          {loading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Nenhuma versão ainda. Cole o prompt ao lado e clique em “Criar versão”.
            </p>
          ) : (
            <ul className="space-y-1">
              {items.map((p) => (
                <li key={p.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => selectVersion(p)}
                    onKeyDown={(e) => e.key === "Enter" && selectVersion(p)}
                    className={`w-full cursor-pointer rounded-md border p-2 text-left transition ${
                      selectedId === p.id ? "border-primary bg-accent" : "border-transparent hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        v{p.version} · {p.title || "Sem título"}
                      </span>
                      {p.isActive && <Badge className="shrink-0">Ativa</Badge>}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(p.updatedAt).toLocaleString("pt-BR")}
                      </span>
                      <span className="flex gap-1">
                        {!p.isActive && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void activate(p);
                            }}
                          >
                            {busyId === p.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === p.id || p.isActive}
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(p);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <div className="space-y-1">
            <Label htmlFor="prompt-title">Título da versão</Label>
            <Input
              id="prompt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Corrige resposta sobre interfones"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="prompt-content">System prompt</Label>
            <Textarea
              id="prompt-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={20}
              className="font-mono text-xs"
              placeholder="Cole aqui o system prompt completo do Robô…"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveEdits()} disabled={!selected || saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Salvar nesta versão
            </Button>
            <Button variant="outline" onClick={() => void createVersion(false)} disabled={saving || !content.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Criar versão
            </Button>
            <Button variant="secondary" onClick={() => void createVersion(true)} disabled={saving || !content.trim()}>
              <Check className="mr-1 h-4 w-4" /> Criar e ativar
            </Button>
          </div>
          {selected && (
            <p className="text-xs text-muted-foreground">
              Editando v{selected.version}
              {selected.isActive ? " (ativa — mudanças valem imediatamente para o Robô)" : ""}.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
