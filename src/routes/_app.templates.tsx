// Tela de Templates de mensagem reutilizáveis
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileText,
  Plus,
  Trash2,
  Loader2,
  Pencil,
  Copy,
  Check,
  Search,
  Image as ImageIcon,
  Paperclip,
  X,
} from "lucide-react";
import { templatesDb, type MessageTemplate, type TemplateMedia } from "@/lib/db";
import { toast } from "sonner";

const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // 5MB

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function detectMediaType(mime: string): TemplateMedia["type"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export const Route = createFileRoute("/_app/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setItems(await templatesDb.list());
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const s = search.trim().toLowerCase();
    return items.filter(
      (t) =>
        t.name.toLowerCase().includes(s) ||
        t.content.toLowerCase().includes(s) ||
        (t.category ?? "").toLowerCase().includes(s),
    );
  }, [items, search]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((t) => t.category && set.add(t.category));
    return Array.from(set).sort();
  }, [items]);

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="size-6 text-primary" /> Templates de mensagem
          </h1>
          <p className="text-sm text-muted-foreground">
            Mensagens reutilizáveis com variáveis <code>{"{{nome}}"}</code>,{" "}
            <code>{"{{empresa}}"}</code>.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4 mr-1" /> Novo template
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="size-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {categories.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {categories.map((cat) => (
              <Badge
                key={cat}
                variant="outline"
                className="cursor-pointer hover:bg-muted"
                onClick={() => setSearch(cat)}
              >
                {cat}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="size-6 mx-auto animate-spin opacity-60" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <FileText className="size-10 mx-auto opacity-30 mb-3" />
          <p>
            {items.length === 0
              ? "Nenhum template criado ainda."
              : "Nenhum template encontrado."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((t) => (
            <TemplateCard
              key={t.id}
              tpl={t}
              onEdit={() => setEditing(t)}
              onDeleted={reload}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <TemplateDialog
          template={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function TemplateCard({
  tpl,
  onEdit,
  onDeleted,
}: {
  tpl: MessageTemplate;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tpl.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const remove = async () => {
    if (!confirm(`Excluir template "${tpl.name}"?`)) return;
    try {
      await templatesDb.remove(tpl.id);
      toast.success("Template excluído");
      onDeleted();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  return (
    <Card className="p-4 hover:border-primary/40 transition flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{tpl.name}</p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {tpl.category && (
              <Badge variant="secondary" className="text-[10px]">
                {tpl.category}
              </Badge>
            )}
            {tpl.media && (
              <Badge variant="outline" className="text-[10px] gap-1">
                {tpl.media.type === "image" ? (
                  <ImageIcon className="size-2.5" />
                ) : (
                  <Paperclip className="size-2.5" />
                )}
                {tpl.media.type}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={copy} title="Copiar">
            {copied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} title="Editar">
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={remove} title="Excluir">
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      </div>
      {tpl.media?.type === "image" && tpl.media.base64 && (
        <img
          src={`data:${tpl.media.mime ?? "image/jpeg"};base64,${tpl.media.base64}`}
          alt={tpl.media.filename ?? "anexo"}
          className="rounded border max-h-32 object-contain bg-muted/30"
        />
      )}
      <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4 break-words">
        {tpl.content}
      </p>
    </Card>
  );
}

function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: MessageTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [content, setContent] = useState(template?.content ?? "");
  const [category, setCategory] = useState(template?.category ?? "");
  const [media, setMedia] = useState<TemplateMedia | null>(template?.media ?? null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_MEDIA_BYTES) {
      toast.error("Arquivo muito grande (máx. 5MB)");
      return;
    }
    try {
      const base64 = await fileToBase64(f);
      setMedia({
        base64,
        type: detectMediaType(f.type || ""),
        mime: f.type || null,
        filename: f.name,
        caption: media?.caption ?? null,
      });
    } catch (err: any) {
      toast.error(`Erro ao ler arquivo: ${err?.message ?? err}`);
    }
  };

  const submit = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error("Nome e conteúdo são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      if (template) {
        await templatesDb.update(template.id, {
          name: name.trim(),
          content: content.trim(),
          category: category.trim() || null,
          media,
        });
        toast.success("Template atualizado");
      } else {
        await templatesDb.create({
          name: name.trim(),
          content: content.trim(),
          category: category.trim() || null,
          media,
        });
        toast.success("Template criado");
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template ? "Editar template" : "Novo template"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Boas-vindas"
              maxLength={100}
            />
          </div>
          <div>
            <Label>Categoria (opcional)</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ex.: Vendas, Suporte..."
              maxLength={50}
            />
          </div>
          <div>
            <Label>Conteúdo</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="Olá {{nome}}, tudo bem? Aqui é da {{empresa}}..."
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Variáveis: <code>{"{{nome}}"}</code>, <code>{"{{empresa}}"}</code>
            </p>
          </div>

          <div className="border-t pt-3 space-y-2">
            <Label className="flex items-center gap-1">
              <ImageIcon className="size-3.5" /> Mídia (opcional)
            </Label>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Anexe imagem, vídeo, áudio ou documento (máx. 5MB). Será enviada
              junto com a mensagem no disparo da sequência.
            </p>
            {media ? (
              <div className="flex items-start gap-3 border rounded p-2 bg-muted/30">
                {media.type === "image" && media.base64 ? (
                  <img
                    src={`data:${media.mime ?? "image/jpeg"};base64,${media.base64}`}
                    alt={media.filename ?? "anexo"}
                    className="size-20 object-cover rounded border"
                  />
                ) : (
                  <div className="size-20 flex items-center justify-center rounded border bg-background">
                    <Paperclip className="size-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-xs font-medium truncate">
                    {media.filename ?? media.type}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {media.type} · {media.mime ?? "—"}
                  </p>
                  <Input
                    value={media.caption ?? ""}
                    onChange={(e) =>
                      setMedia({ ...media, caption: e.target.value || null })
                    }
                    placeholder="Legenda (opcional)"
                    maxLength={1024}
                    className="h-7 text-xs"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMedia(null)}
                  title="Remover mídia"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*,audio/*,application/pdf"
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip className="size-3.5 mr-1" /> Anexar arquivo
                </Button>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
            {template ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
