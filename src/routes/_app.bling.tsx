// Tela Bling — lista propostas comerciais (nome, telefone, valor) com atualização
// automática, importa contatos para o CRM (categoria BLING) e dispara lembretes
// de orçamento por WhatsApp usando o número cadastrado no Bling.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, ShoppingBag, Send, Download, Clock } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { contactsDb, categoriesDb, bulkSendsDb, type Contact } from "@/lib/db";
import { phoneMatchVariants } from "@/lib/phone-validation";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/bling")({
  component: BlingPage,
  head: () => ({
    meta: [
      { title: "Propostas do Bling | ZapCRM" },
      {
        name: "description",
        content:
          "Propostas comerciais do Bling com nome, telefone e valor, importação de contatos e lembretes de orçamento por WhatsApp.",
      },
      { property: "og:title", content: "Propostas do Bling | ZapCRM" },
      {
        property: "og:description",
        content: "Acompanhe orçamentos do Bling e envie lembretes por WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type BlingProposalItem = {
  id: string;
  numero: string | null;
  data: string | null;
  total: number | null;
  situacao: string | null;
  nome: string;
  phone: string;
  phoneRaw: string | null;
  phoneFonte?: "cadastro" | "texto" | null;
  email: string | null;
};

const BLING_CATEGORY = "BLING";
const AUTO_REFRESH_MS = 5 * 60_000;
const DEFAULT_MESSAGE =
  "Olá {nome}! 👋 Passando para lembrar do orçamento que preparamos para você" +
  " (proposta {proposta}, valor {valor}). Ainda tem interesse? Posso tirar" +
  " qualquer dúvida por aqui. 😉";

function normalizePhone(raw: string) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 13 ? d : "";
}

function money(v: number | null) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function ensureBlingCategory(): Promise<string | null> {
  try {
    const cats = await categoriesDb.list();
    const found = cats.find(
      (c) => c.name.trim().toLowerCase() === BLING_CATEGORY.toLowerCase(),
    );
    if (found) return found.id;
    const created = await categoriesDb.create(BLING_CATEGORY, "#F59E0B");
    return created.id;
  } catch (e: any) {
    console.warn("[bling] categoria:", e?.message ?? e);
    return null;
  }
}

function BlingPage() {
  const [items, setItems] = useState<BlingProposalItem[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [dias, setDias] = useState("90");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [interval, setIntervalSec] = useState(60);
  const phonesRef = useRef(phones);
  phonesRef.current = phones;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await authFetch(`/api/public/bling/proposals?dias=${dias}&limite=200`);
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error ?? "falha ao consultar o Bling");
        const list: BlingProposalItem[] = json.items ?? [];
        setItems(list);
        setError(null);
        setLastSync(new Date());
        setPhones((prev) => {
          const next = { ...prev };
          for (const it of list) if (!next[it.id]) next[it.id] = it.phone || it.phoneRaw || "";
          return next;
        });
        setChecked((prev) => {
          const next = { ...prev };
          for (const it of list) if (next[it.id] === undefined) next[it.id] = Boolean(it.phone);
          return next;
        });
      } catch (e: any) {
        const msg = e?.message ?? "Erro ao consultar o Bling";
        setError(msg);
        if (!silent) toast.error(msg);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [dias],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias]);

  useEffect(() => {
    contactsDb.list().then(setContacts).catch(() => {});
  }, []);

  // Atualização automática (pausa quando a aba está oculta)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const contactIndex = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) for (const v of phoneMatchVariants(c.phone)) m.set(v, c);
    return m;
  }, [contacts]);

  const findContact = (phone: string) =>
    phoneMatchVariants(phone)
      .map((v) => contactIndex.get(v))
      .find(Boolean) ?? null;

  const selecionados = items.filter((it) => checked[it.id]);

  /** Importa (cria/atualiza) contatos das propostas selecionadas. Retorna ids. */
  const importSelected = async (): Promise<string[]> => {
    const validos = selecionados
      .map((it) => ({ it, phone: normalizePhone(phonesRef.current[it.id] ?? "") }))
      .filter((r) => r.phone);
    if (!validos.length) {
      toast.error("Preencha ao menos um WhatsApp válido");
      return [];
    }
    const catId = await ensureBlingCategory();
    const ids: string[] = [];
    const seen = new Set<string>();
    let novos = 0;
    let atualizados = 0;

    for (const { it, phone } of validos) {
      if (seen.has(phone)) continue;
      seen.add(phone);
      const existente = findContact(phone);
      try {
        if (existente) {
          ids.push(existente.id);
          if (catId) {
            const tags = new Set([
              ...(existente.categoryIds ?? []),
              ...(existente.categoryId ? [existente.categoryId] : []),
            ]);
            if (!tags.has(catId)) {
              tags.add(catId);
              await contactsDb.setCategories(existente.id, Array.from(tags));
              atualizados++;
            }
          }
        } else {
          const created = await contactsDb.create({
            name: it.nome || phone,
            phone,
            email: it.email ?? null,
            notes: `Bling — proposta ${it.numero ?? it.id}${it.data ? ` (${it.data})` : ""}${
              it.total ? ` — ${money(it.total)}` : ""
            }`,
            categoryIds: catId ? [catId] : [],
          } as any);
          ids.push(created.id);
          novos++;
        }
      } catch (e: any) {
        console.warn("[bling] import contato:", e?.message ?? e);
      }
    }
    setContacts(await contactsDb.list().catch(() => contacts));
    const semFone = selecionados.length - validos.length;
    const parts = [`${ids.length} contatos`, `${novos} novos`];
    if (atualizados) parts.push(`${atualizados} marcados como BLING`);
    if (semFone) parts.push(`${semFone} sem WhatsApp`);
    toast.success(`Bling importado — ${parts.join(" · ")}`);
    return ids;
  };

  const runImport = async () => {
    setBusy(true);
    try {
      await importSelected();
    } catch (e: any) {
      toast.error(`Falha ao importar: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  /** Importa e dispara o lembrete de orçamento por WhatsApp. */
  const runReminders = async () => {
    if (!message.trim()) return toast.error("Escreva a mensagem do lembrete");
    setBusy(true);
    try {
      const ids = await importSelected();
      if (!ids.length) return;

      const bulk = await bulkSendsDb.create({
        name: `Lembrete de orçamento (Bling) — ${new Date().toLocaleDateString("pt-BR")}`,
        message: message.trim(),
        intervalSeconds: interval,
        totalContacts: ids.length,
        scheduledAt: null,
        contactIds: ids,
      });

      const c = await getSupabaseClient();
      const { data: sess } = (await c?.auth.getSession()) ?? { data: { session: null } };
      const token = sess?.session?.access_token;
      if (!token) throw new Error("sessão expirada — faça login novamente");

      const res = await fetch("/api/public/evolution/bulk-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          bulkId: bulk.id,
          contactIds: ids,
          message: message.trim(),
          intervalSeconds: interval,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        await bulkSendsDb.update(bulk.id, { status: "error" });
        throw new Error(typeof data.error === "string" ? data.error : "falha ao iniciar disparo");
      }
      toast.success(`🚀 Lembretes de orçamento enviados para ${ids.length} contatos`);
    } catch (e: any) {
      toast.error(`Erro no disparo: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const totalValor = selecionados.reduce((s, it) => s + (it.total ?? 0), 0);
  const allChecked = items.length > 0 && selecionados.length === items.length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ShoppingBag className="size-5 text-amber-500" /> Propostas comerciais do Bling
        </h1>
        <Badge variant="secondary">{items.length} propostas</Badge>
        {lastSync && (
          <span className="text-xs text-muted-foreground">
            Atualizado às {lastSync.toLocaleTimeString("pt-BR")} · auto a cada 5 min
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Select value={dias} onValueChange={setDias}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="180">Últimos 6 meses</SelectItem>
              <SelectItem value="365">Último ano</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => load()} disabled={loading}>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Atualizar
          </Button>
        </div>
      </header>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error} — verifique a conexão em Configurações → Integrações → Bling.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Lista de orçamentos
            <Badge variant="outline" className="ml-auto">
              {selecionados.length} selecionados · {money(totalValor || null)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Checkbox
              checked={allChecked}
              onCheckedChange={(v) =>
                setChecked(Object.fromEntries(items.map((it) => [it.id, v === true])))
              }
            />
            Selecionar todos
          </div>

          <div className="max-h-[52vh] space-y-1 overflow-auto rounded-lg border p-2">
            {loading && items.length === 0 ? (
              <div className="py-10 text-center">
                <Loader2 className="mx-auto size-6 animate-spin opacity-60" />
              </div>
            ) : items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma proposta comercial encontrada no período.
              </p>
            ) : (
              items.map((it) => {
                const phone = normalizePhone(phones[it.id] ?? "");
                const existente = phone ? findContact(phone) : null;
                return (
                  <div
                    key={it.id}
                    className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={Boolean(checked[it.id])}
                      onCheckedChange={(v) =>
                        setChecked((p) => ({ ...p, [it.id]: v === true }))
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{it.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Proposta {it.numero ?? it.id}
                        {it.data ? ` · ${it.data}` : ""}
                        {it.situacao ? ` · ${it.situacao}` : ""}
                      </p>
                    </div>
                    <span className="w-28 text-right text-sm font-semibold tabular-nums">
                      {money(it.total)}
                    </span>
                    <Input
                      className="w-48 font-mono text-xs"
                      placeholder="WhatsApp (55DDD…)"
                      title={
                        it.phoneFonte === "texto"
                          ? "Número extraído do texto da proposta (Introdução/Observações)"
                          : undefined
                      }
                      value={phones[it.id] ?? ""}
                      onChange={(e) => setPhones((p) => ({ ...p, [it.id]: e.target.value }))}
                    />
                    <Badge variant={existente ? "secondary" : phone ? "outline" : "destructive"}>
                      {existente
                        ? "no CRM"
                        : phone
                          ? it.phoneFonte === "texto"
                            ? "novo (via texto)"
                            : "novo"
                          : "sem número"}
                    </Badge>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Lembrete de orçamento por WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Mensagem</Label>
            <Textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Mensagem do lembrete"
            />
            <p className="text-xs text-muted-foreground">
              Variáveis disponíveis do disparo: <code>{"{nome}"}</code>. Os campos{" "}
              <code>{"{proposta}"}</code> e <code>{"{valor}"}</code> são substituídos por
              proposta/valor quando houver suporte no disparo — remova-os se preferir texto fixo.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Clock className="size-3.5" /> Intervalo entre mensagens: {interval}s
            </Label>
            <Slider
              value={[interval]}
              onValueChange={([v]) => setIntervalSec(v)}
              min={1}
              max={120}
              step={1}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-1.5" onClick={runImport} disabled={busy || !selecionados.length}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Importar {selecionados.length || ""} para o CRM
            </Button>
            <Button className="gap-1.5" onClick={runReminders} disabled={busy || !selecionados.length}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Enviar lembretes de orçamento
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
