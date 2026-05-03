import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Send,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Users,
  Clock,
} from "lucide-react";
import {
  contactsDb,
  categoriesDb,
  bulkSendsDb,
  type BulkSend,
  type Contact,
  type Category,
} from "@/lib/db";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/disparos")({
  component: DisparosPage,
});

function statusBadge(s: BulkSend["status"]) {
  if (s === "completed")
    return (
      <Badge variant="outline" className="border-success text-success gap-1">
        <CheckCircle2 className="size-3" /> Completo
      </Badge>
    );
  if (s === "in_progress")
    return (
      <Badge variant="outline" className="border-accent text-accent gap-1">
        <Loader2 className="size-3 animate-spin" /> Enviando
      </Badge>
    );
  if (s === "error")
    return (
      <Badge variant="outline" className="border-destructive text-destructive gap-1">
        <AlertCircle className="size-3" /> Erro
      </Badge>
    );
  return <Badge variant="secondary">Pendente</Badge>;
}

function DisparosPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [history, setHistory] = useState<BulkSend[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [message, setMessage] = useState("Olá {nome}, tudo bem?");
  const [interval, setInterval] = useState(3);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  const load = async () => {
    try {
      const [cs, cats, h] = await Promise.all([
        contactsDb.list(),
        categoriesDb.list(),
        bulkSendsDb.list(),
      ]);
      setContacts(cs);
      setCategories(cats);
      setHistory(h);
    } catch (e: any) {
      toast.error(`Erro ao carregar: ${e.message ?? e}`);
    }
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, []);

  // Auto-refresh do histórico a cada 5s para refletir progresso do n8n
  useEffect(() => {
    const t = window.setInterval(async () => {
      try {
        setHistory(await bulkSendsDb.list());
      } catch { /* silencioso */ }
    }, 5000);
    return () => window.clearInterval(t);
  }, []);

  const toggle = (id: string) => {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c) => c.id)));
  };
  const selectByCategory = (catId: string) => {
    const ids = contacts.filter((c) => c.categoryId === catId).map((c) => c.id);
    setSelected((p) => {
      const n = new Set(p);
      ids.forEach((i) => n.add(i));
      return n;
    });
  };

  const previewMessage = useMemo(() => {
    const sample = contacts.find((c) => selected.has(c.id)) || contacts[0];
    return sample ? message.replaceAll("{nome}", sample.name.split(" ")[0]) : message;
  }, [message, selected, contacts]);

  const handleDispatch = async () => {
    if (!name.trim()) return toast.error("Dê um nome ao disparo");
    if (!message.trim()) return toast.error("Escreva uma mensagem");
    if (selected.size === 0) return toast.error("Selecione ao menos 1 contato");
    setSubmitting(true);
    try {
      // 1. Cria registro do disparo
      const bulk = await bulkSendsDb.create({
        name: name.trim(),
        message: message.trim(),
        intervalSeconds: interval,
        totalContacts: selected.size,
      });

      // 2. Dispara worker em background (com JWT do usuário)
      const c = await getSupabaseClient();
      const { data: sess } = (await c?.auth.getSession()) ?? { data: { session: null } };
      const token = sess?.session?.access_token;
      if (!token) throw new Error("sessão expirada — faça login novamente");

      const res = await fetch("/api/public/evolution/bulk-dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bulkId: bulk.id,
          contactIds: Array.from(selected),
          message: message.trim(),
          intervalSeconds: interval,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        // Marca como erro pra UI refletir
        await bulkSendsDb.update(bulk.id, { status: "error" });
        throw new Error(
          typeof data.error === "string" ? data.error : "falha ao iniciar disparo",
        );
      }

      toast.success(
        `🚀 Disparo iniciado para ${selected.size} contatos (${interval}s entre envios)`,
      );
      setHistory(await bulkSendsDb.list());
      setName("");
      setSelected(new Set());
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 max-w-[1400px]">
      {/* Form principal */}
      <div className="space-y-5">
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="font-semibold">Configurar disparo</h3>
            <p className="text-xs text-muted-foreground">
              Use <code className="px-1 py-0.5 rounded bg-muted text-xs">{"{nome}"}</code> para personalizar
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dn">Nome do disparo</Label>
            <Input
              id="dn"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Promoção de fim de ano"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dm">Mensagem</Label>
            <Textarea id="dm" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} />
            <p className="text-xs text-muted-foreground">
              Prévia: <span className="text-foreground italic">"{previewMessage}"</span>
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Intervalo entre envios</Label>
              <Badge variant="secondary" className="gap-1">
                <Clock className="size-3" /> {interval}s
              </Badge>
            </div>
            <Slider value={[interval]} onValueChange={([v]) => setInterval(v)} min={1} max={60} step={1} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">Selecionar contatos</h3>
              <p className="text-xs text-muted-foreground">
                {selected.size} de {contacts.length} selecionados
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={toggleAll} disabled={contacts.length === 0}>
              {selected.size === contacts.length && contacts.length > 0 ? "Limpar" : "Selecionar todos"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => selectByCategory(c.id)}
                className="px-3 py-1 rounded-full text-xs font-medium border hover:bg-muted transition"
                style={{ borderColor: c.color, color: c.color }}
              >
                + {c.name}
              </button>
            ))}
          </div>

          <Separator className="my-3" />

          <div className="mb-3">
            <Input
              placeholder="Buscar contato por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="py-10 text-center text-muted-foreground">
              <Loader2 className="size-6 mx-auto animate-spin opacity-60" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhum contato. Importe ou crie contatos antes de disparar.
            </div>
          ) : (
            <div className="max-h-[320px] overflow-auto space-y-1">
              {contacts
                .filter((c) => {
                  const q = search.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    c.name.toLowerCase().includes(q) ||
                    c.phone.toLowerCase().includes(q)
                  );
                })
                .map((c) => {
                const cat = categories.find((k) => k.id === c.categoryId);
                const checked = selected.has(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggle(c.id)} />
                    <div
                      className="size-8 rounded-full grid place-items-center text-white text-xs font-semibold"
                      style={{ backgroundColor: cat?.color ?? "#94a3b8" }}
                    >
                      {c.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate font-mono">{c.phone}</p>
                    </div>
                    {cat && (
                      <Badge variant="outline" style={{ borderColor: cat.color, color: cat.color }}>
                        {cat.name}
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </Card>

        <div className="flex justify-end">
          <Button size="lg" onClick={handleDispatch} className="gap-2" disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Disparar para {selected.size} contatos
          </Button>
        </div>
      </div>

      {/* Histórico */}
      <Card className="p-5 h-fit xl:sticky xl:top-6">
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="size-4 text-primary" /> Disparos recentes
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Últimos 20 · atualiza a cada 5s</p>
        <div className="space-y-3 max-h-[600px] overflow-auto">
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum disparo ainda</p>
          )}
          {history.slice(0, 20).map((b) => {
            const pct = b.totalContacts > 0 ? Math.round((b.sentCount / b.totalContacts) * 100) : 0;
            return (
              <div key={b.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(b.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  {statusBadge(b.status)}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{b.sentCount} / {b.totalContacts}</span>
                    <span className="font-medium">{pct}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
