// Card de configuração do disparo automático de novas propostas comerciais do Bling.
// Aditivo: não altera nenhum fluxo existente da tela do Bling.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Play, Save, Zap } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { toast } from "sonner";

type AutoConfig = {
  enabled: boolean;
  dias: number;
  maxPerRun: number;
  situacoes: string[];
  text: string;
  mediaUrl: string;
  mediaType: "image" | "video" | "document" | "";
  since: string;
  delayMin: number;
};

type LogRow = {
  proposal_id: string;
  phone: string | null;
  status: string;
  detail: string | null;
  created_at: string;
};

export function BlingAutoCard() {
  const [cfg, setCfg] = useState<AutoConfig | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/public/bling/auto-config");
      const json = await res.json();
      if (json?.ok) {
        setCfg(json.config);
        setLog(json.log ?? []);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao carregar a configuração");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch?: Partial<AutoConfig>) => {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    setSaving(true);
    try {
      const res = await authFetch("/api/public/bling/auto-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "erro ao salvar");
      setCfg(json.config);
      setLog(json.log ?? []);
      toast.success("Configuração salva");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await authFetch("/api/public/bling/auto-tick?force=1", { method: "POST" });
      const json = await res.json();
      if (json?.ok === false) throw new Error(json?.error ?? "falha na execução");
      toast.success(
        `Verificadas ${json.checked ?? 0} propostas · ${json.sent ?? 0} enviadas · ${json.skipped ?? 0} ignoradas`,
      );
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao executar");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Zap className="size-4 text-amber-500" />
          Disparo automático de novas propostas
          {cfg?.enabled && <Badge className="bg-emerald-600">Ativo</Badge>}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={runNow}
            disabled={running || loading}
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Executar agora
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          O CRM verifica periodicamente as propostas comerciais novas no Bling, cadastra o cliente na
          categoria <strong>BLING</strong> e envia automaticamente a mensagem abaixo. Cada proposta é
          disparada uma única vez. Variáveis: <code>{"{nome}"}</code>, <code>{"{numero}"}</code>,{" "}
          <code>{"{valor}"}</code>, <code>{"{data}"}</code>.
        </p>

        {loading || !cfg ? (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto size-5 animate-spin opacity-60" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">Ativar disparo automático</Label>
                <p className="text-xs text-muted-foreground">
                  Requer o cron do n8n chamando /api/public/bling/auto-tick.
                </p>
              </div>
              <Switch
                checked={cfg.enabled}
                onCheckedChange={(v) => void save({ enabled: v })}
                disabled={saving}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Janela (dias)</Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={cfg.dias}
                  onChange={(e) => setCfg({ ...cfg, dias: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Máx. por execução</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={cfg.maxPerRun}
                  onChange={(e) => setCfg({ ...cfg, maxPerRun: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Considerar a partir de</Label>
                <Input
                  type="date"
                  value={cfg.since?.slice(0, 10) ?? ""}
                  onChange={(e) => setCfg({ ...cfg, since: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Atraso antes do envio (minutos)</Label>
              <Input
                type="number"
                min={0}
                max={10080}
                value={cfg.delayMin ?? 60}
                onChange={(e) => setCfg({ ...cfg, delayMin: Number(e.target.value) })}
              />
              <p className="text-[11px] text-muted-foreground">
                A proposta é detectada e fica agendada; a mensagem sai depois desse tempo (padrão 60
                min). O botão "Executar agora" ignora a espera.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Mensagem enviada</Label>
              <Textarea
                rows={5}
                value={cfg.text}
                onChange={(e) => setCfg({ ...cfg, text: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Mídia (opcional)</Label>
                <Select
                  value={cfg.mediaType || "none"}
                  onValueChange={(v) =>
                    setCfg({ ...cfg, mediaType: v === "none" ? "" : (v as AutoConfig["mediaType"]) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Somente texto</SelectItem>
                    <SelectItem value="image">Imagem</SelectItem>
                    <SelectItem value="video">Vídeo</SelectItem>
                    <SelectItem value="document">Documento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">URL da mídia</Label>
                <Input
                  placeholder="https://…"
                  value={cfg.mediaUrl}
                  onChange={(e) => setCfg({ ...cfg, mediaUrl: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Enviar só quando a situação contiver (separe por vírgula — vazio = todas)
              </Label>
              <Input
                placeholder="ex.: finalizada, aprovada"
                value={cfg.situacoes.join(", ")}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    situacoes: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>

            <Button className="gap-1.5" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Salvar configuração
            </Button>

            {log.length > 0 && (
              <div className="space-y-1 rounded-lg border p-2">
                <p className="px-1 text-xs font-medium text-muted-foreground">Últimos disparos</p>
                <div className="max-h-40 overflow-auto">
                  {log.map((r) => (
                    <div
                      key={`${r.proposal_id}-${r.created_at}`}
                      className="flex items-center gap-2 px-1 py-0.5 text-xs"
                    >
                      <span className="w-32 truncate">Proposta {r.proposal_id}</span>
                      <span className="w-32 truncate font-mono text-muted-foreground">
                        {r.phone ?? "—"}
                      </span>
                      <Badge
                        variant={
                          r.status === "sent"
                            ? "default"
                            : r.status === "error"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {r.status}
                      </Badge>
                      <span className="truncate text-muted-foreground">{r.detail ?? ""}</span>
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
