import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CirclePause, Clock3, Image, Loader2, Music2, Play, Plus, RefreshCw, Send, Trash2, Type, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getSupabaseClient } from "@/integrations/supabase/client";

type StatusItem = { id: string; type: "text"|"image"|"video"|"audio"; content: string|null; preview_url: string|null; file_name: string|null; caption: string|null; background_color: string; font: number; position: number; is_active: boolean; last_used_at: string|null; last_error: string|null };
type Settings = { enabled: boolean; interval_minutes: number; last_published_at?: string|null; last_error?: string|null };
type Run = { id: string; mediaId: string; status: "running"|"uncertain"|"completed"|"cancelled"; sent: number; total: number; error: string|null };

export const Route = createFileRoute("/_app/status")({
  head: () => ({ meta: [
    { title: "Status automático | ZapCRM" },
    { name: "description", content: "Biblioteca e rodízio automático do Status do WhatsApp Business." },
    { property: "og:title", content: "Status automático | ZapCRM" },
    { property: "og:description", content: "Biblioteca e rodízio automático do Status do WhatsApp Business." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: StatusPage,
});

async function token() {
  const client = await getSupabaseClient();
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } };
  if (!data.session?.access_token) throw new Error("Sessão expirada — faça login novamente");
  return data.session.access_token;
}

async function api(path: string, init?: RequestInit) {
  const bearer = await token();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${bearer}`);
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error ?? `Erro ${response.status}`);
  return body;
}

function StatusPage() {
  const [items, setItems] = useState<StatusItem[]>([]);
  const [settings, setSettings] = useState<Settings>({ enabled: false, interval_minutes: 180 });
  const [run, setRun] = useState<Run|null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("#075E54");
  const [font, setFont] = useState(1);
  const [caption, setCaption] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api("/api/public/evolution/status-library");
      setItems(data.items);
      setSettings(data.settings);
      setRun(data.run);
    } catch (error: any) { toast.error(error.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function addText() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api("/api/public/evolution/status-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_text", content: text.trim(), backgroundColor, font }) });
      setText(""); toast.success("Texto adicionado à fila"); await reload();
    } catch (error: any) { toast.error(error.message); } finally { setBusy(false); }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let done = 0;
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.set("file", file); form.set("caption", caption);
        await api("/api/public/evolution/status-library", { method: "POST", body: form }); done += 1;
      }
      setCaption(""); toast.success(`${done} mídia(s) adicionada(s)`); await reload();
    } catch (error: any) { toast.error(`Foram adicionadas ${done}. ${error.message}`); await reload(); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function patch(body: object) { setBusy(true); try { await api("/api/public/evolution/status-library", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); await reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  async function move(index: number, delta: number) { const next = [...items]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setItems(next); await patch({ action: "reorder", ids: next.map(i => i.id) }); }
  async function remove(item: StatusItem) { if (!confirm(`Excluir ${item.file_name ?? "este texto"}?`)) return; setBusy(true); try { await api(`/api/public/evolution/status-library?id=${item.id}`, { method: "DELETE" }); toast.success("Item excluído"); await reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  async function resolveUncertain() {
    if (!run || run.status !== "uncertain") return;
    if (!confirm("Você verificou com os contatos se o último grupo recebeu o Status? Encerrar esta tentativa não envia os contatos restantes. Uma nova publicação começará do início e pode duplicar entregas anteriores.")) return;
    await patch({ action: "resolve_uncertain", runId: run.id });
  }
  async function publish(item?: StatusItem) {
    if (!run || run.status === "completed" || run.status === "cancelled") {
      if (!confirm("Iniciar envio para todos os contatos em grupos de 20? O primeiro grupo será enviado agora. Confirme somente se deseja publicar este Status.")) return;
    }
    setBusy(true);
    try {
      const data = await api("/api/public/evolution/status-tick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true, itemId: item?.id }) });
      const result = data.results?.[0];
      if (!result?.ok) throw new Error(result?.error ?? "Publicação não concluída");
      toast.success(result.completed ? "Envio concluído" : `Grupo confirmado: ${result.sent} de ${result.total} contatos`);
      await reload();
    } catch (e: any) { toast.error("Falha ao publicar", { description: e.message }); await reload(); }
    finally { setBusy(false); }
  }

  const nextItem = items.filter(i => i.is_active).sort((a,b) => (a.last_used_at ?? "").localeCompare(b.last_used_at ?? "") || a.position-b.position)[0];
  return <div className="max-w-[1200px] space-y-5">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold flex items-center gap-2"><RefreshCw className="size-6 text-primary"/>Status automático</h1><p className="text-sm text-muted-foreground">Sua fila publica um conteúdo por vez e recomeça após o último.</p></div>
      <Button onClick={() => publish()} disabled={busy || run?.status === "uncertain" || (!nextItem && run?.status !== "running")} className="gap-2"><Send className="size-4"/>{run?.status === "running" ? "Enviar próximo grupo" : "Publicar próximo agora"}</Button>
    </div>

    <Card className="p-4 sm:p-5">
      <div className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
        <div><Label>Automação</Label><div className="mt-2 flex items-center gap-3"><Switch checked={settings.enabled} disabled={busy} onCheckedChange={(enabled) => patch({ action: "settings", enabled, intervalMinutes: settings.interval_minutes })}/><span className="text-sm">{settings.enabled ? "Ativa" : "Pausada"}</span></div></div>
        <div><Label htmlFor="interval">Intervalo entre publicações</Label><select id="interval" className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm" value={settings.interval_minutes} disabled={busy} onChange={(e) => patch({ action: "settings", enabled: settings.enabled, intervalMinutes: Number(e.target.value) })}><option value={60}>1 hora</option><option value={120}>2 horas</option><option value={180}>3 horas</option><option value={240}>4 horas</option><option value={360}>6 horas</option><option value={720}>12 horas</option><option value={1440}>24 horas</option></select></div>
        <div className="text-xs text-muted-foreground md:text-right"><Clock3 className="size-4 inline mr-1"/>{settings.last_published_at ? `Último: ${new Date(settings.last_published_at).toLocaleString("pt-BR")}` : "Ainda não publicou"}</div>
      </div>
      {settings.last_error && <p className="mt-3 text-sm text-destructive">Última falha: {settings.last_error}</p>}
      {run?.status === "running" && <p className="mt-3 text-sm text-foreground">Publicação em andamento: {run.sent} de {run.total} contatos confirmados.</p>}
      {run?.status === "uncertain" && <p className="mt-3 text-sm text-destructive">Envio interrompido após {run.sent} de {run.total} contatos confirmados. Confira a entrega antes de continuar; não haverá reenvio automático.</p>}
      {run?.status === "uncertain" && <Button variant="outline" size="sm" disabled={busy} onClick={resolveUncertain} className="mt-2">Encerrar tentativa após conferir</Button>}
    </Card>

    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-4 space-y-3"><div><h2 className="font-semibold flex items-center gap-2"><Image className="size-4"/>Adicionar mídias</h2><p className="text-xs text-muted-foreground">Imagens, vídeos ou áudios de até 20 MB. Você pode escolher vários arquivos.</p></div><Input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm" disabled={busy} onChange={(e) => upload(e.target.files)}/><Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Legenda para os próximos arquivos (opcional)" maxLength={1024}/></Card>
      <Card className="p-4 space-y-3"><div><h2 className="font-semibold flex items-center gap-2"><Type className="size-4"/>Adicionar texto</h2><p className="text-xs text-muted-foreground">Crie uma publicação somente com texto.</p></div><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite o texto do Status" maxLength={700} rows={3}/><div className="flex items-center gap-3"><Label htmlFor="status-color">Fundo</Label><Input id="status-color" type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} className="h-9 w-14 p-1"/><Label htmlFor="status-font">Fonte</Label><select id="status-font" value={font} onChange={(e) => setFont(Number(e.target.value))} className="h-9 rounded-md border bg-background px-2 text-sm">{[0,1,2,3,4,5].map(value => <option key={value} value={value}>Estilo {value + 1}</option>)}</select></div><Button variant="outline" onClick={addText} disabled={busy || !text.trim()} className="gap-2"><Plus className="size-4"/>Adicionar à fila</Button></Card>
    </div>

    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="font-semibold">Fila de publicação ({items.length})</h2>{loading && <Loader2 className="size-4 animate-spin"/>}</div>
      {!loading && items.length === 0 ? <Card className="p-10 text-center text-muted-foreground">Adicione mídias ou textos para começar o rodízio.</Card> : <div className="grid gap-3">{items.map((item,index) => <Card key={item.id} className={`p-3 ${nextItem?.id === item.id ? "border-primary" : ""}`}><div className="flex gap-3 items-center">
        <div className="size-16 sm:size-20 shrink-0 rounded-md bg-muted overflow-hidden grid place-items-center">{item.type === "image" && item.preview_url ? <img src={item.preview_url} alt="Prévia" className="size-full object-cover"/> : item.type === "video" ? <Video className="size-7 text-muted-foreground"/> : item.type === "audio" ? <Music2 className="size-7 text-muted-foreground"/> : <Type className="size-7 text-muted-foreground"/>}</div>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-xs font-semibold uppercase">{item.type}</span>{nextItem?.id === item.id && <span className="text-xs text-primary">Próximo</span>}{!item.is_active && <span className="text-xs text-muted-foreground">Pausado</span>}</div><p className="text-sm truncate mt-1">{item.content ?? item.file_name ?? "Mídia"}</p>{item.type === "text" ? <Input defaultValue={item.content ?? ""} className="mt-2 h-8 text-xs" maxLength={700} aria-label="Editar texto" onBlur={(e) => { const value=e.target.value.trim(); if (value && value !== item.content) patch({ action:"content", id:item.id, content:value, backgroundColor:item.background_color, font:item.font }); }}/>:<Input defaultValue={item.caption ?? ""} className="mt-2 h-8 text-xs" maxLength={1024} placeholder="Legenda (opcional)" aria-label="Editar legenda" onBlur={(e) => { if (e.target.value !== (item.caption ?? "")) patch({ action:"caption", id:item.id, caption:e.target.value }); }}/>}<p className="text-xs text-muted-foreground truncate mt-1">{item.last_used_at ? `Publicado em ${new Date(item.last_used_at).toLocaleString("pt-BR")}` : "Ainda não publicado"}</p>{item.last_error && <p className="text-xs text-destructive truncate">{item.last_error}</p>}</div>
         <div className="flex flex-wrap justify-end gap-1 max-w-36"><Button variant="ghost" size="icon" title="Subir" disabled={busy||index===0} onClick={() => move(index,-1)}><ArrowUp className="size-4"/></Button><Button variant="ghost" size="icon" title="Descer" disabled={busy||index===items.length-1} onClick={() => move(index,1)}><ArrowDown className="size-4"/></Button><Button variant="ghost" size="icon" title={item.is_active?"Pausar":"Ativar"} disabled={busy} onClick={() => patch({ action:"toggle", id:item.id, active:!item.is_active })}>{item.is_active?<CirclePause className="size-4"/>:<Play className="size-4"/>}</Button><Button variant="ghost" size="icon" title="Publicar agora" disabled={busy||!item.is_active||run?.status==="running"||run?.status==="uncertain"} onClick={() => publish(item)}><Send className="size-4"/></Button><Button variant="ghost" size="icon" title="Excluir" disabled={busy || run?.status==="running" && run.mediaId===item.id} onClick={() => remove(item)}><Trash2 className="size-4 text-destructive"/></Button></div>
      </div></Card>)}</div>}
    </section>
  </div>;
}
