// Diálogo: importar contatos das Propostas Comerciais do Bling.
// Cria/atualiza contatos com a categoria "BLING" e devolve os ids para seleção.
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { contactsDb, categoriesDb, type Contact } from "@/lib/db";
import { phoneMatchVariants } from "@/lib/phone-validation";
import { toast } from "sonner";

export type BlingProposalItem = {
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

function normalizePhone(raw: string) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 13 ? d : "";
}

/** Garante a categoria BLING e devolve o id. */
async function ensureBlingCategory(): Promise<string | null> {
  try {
    const cats = await categoriesDb.list();
    const found = cats.find((c) => c.name.trim().toLowerCase() === BLING_CATEGORY.toLowerCase());
    if (found) return found.id;
    const created = await categoriesDb.create(BLING_CATEGORY, "#F59E0B");
    return created.id;
  } catch (e: any) {
    console.warn("[bling] categoria:", e?.message ?? e);
    return null;
  }
}

export function BlingImportDialog({
  open,
  onOpenChange,
  contacts,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contacts: Contact[];
  onImported: (ids: string[]) => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dias, setDias] = useState("90");
  const [items, setItems] = useState<BlingProposalItem[]>([]);
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/public/bling/proposals?dias=${dias}&limite=150`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "falha ao consultar o Bling");
      const list: BlingProposalItem[] = json.items ?? [];
      setItems(list);
      const ph: Record<string, string> = {};
      const ck: Record<string, boolean> = {};
      for (const it of list) {
        ph[it.id] = it.phone || it.phoneRaw || "";
        ck[it.id] = Boolean(it.phone);
      }
      setPhones(ph);
      setChecked(ck);
      if (!list.length) toast.info("Nenhuma proposta comercial encontrada no período");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao consultar o Bling");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && items.length === 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const runImport = async () => {
    const selecionados = items.filter((it) => checked[it.id]);
    const validos = selecionados
      .map((it) => ({ it, phone: normalizePhone(phones[it.id] ?? "") }))
      .filter((r) => r.phone);
    const semFone = selecionados.length - validos.length;
    if (!validos.length) return toast.error("Preencha ao menos um WhatsApp válido");

    setImporting(true);
    try {
      const catId = await ensureBlingCategory();
      const index = new Map<string, Contact>();
      for (const c of contacts) for (const v of phoneMatchVariants(c.phone)) index.set(v, c);

      const ids: string[] = [];
      let novos = 0;
      let atualizados = 0;
      const seen = new Set<string>();

      for (const { it, phone } of validos) {
        if (seen.has(phone)) continue;
        seen.add(phone);
        const existente = phoneMatchVariants(phone)
          .map((v) => index.get(v))
          .find(Boolean);
        try {
          if (existente) {
            ids.push(existente.id);
            if (catId) {
              const tags = new Set([...(existente.categoryIds ?? []), ...(existente.categoryId ? [existente.categoryId] : [])]);
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
              notes: `Bling — proposta ${it.numero ?? it.id}${it.data ? ` (${it.data})` : ""}`,
              categoryIds: catId ? [catId] : [],
            } as any);
            ids.push(created.id);
            novos++;
          }
        } catch (e: any) {
          console.warn("[bling] import contato:", e?.message ?? e);
        }
      }

      await onImported(ids);
      const parts = [`${ids.length} selecionados`, `${novos} novos`];
      if (atualizados) parts.push(`${atualizados} marcados como BLING`);
      if (semFone) parts.push(`${semFone} sem WhatsApp (ignorados)`);
      toast.success(`Bling importado — ${parts.join(" · ")}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Falha ao importar: ${e?.message ?? e}`);
    } finally {
      setImporting(false);
    }
  };

  const marcados = items.filter((it) => checked[it.id]).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !importing && onOpenChange(o)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="size-4" /> Importar orçamentos do Bling
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
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
          <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Atualizar
          </Button>
          <Badge variant="secondary" className="ml-auto">{marcados} selecionados</Badge>
        </div>

        <div className="max-h-[420px] overflow-auto space-y-1 rounded-lg border p-2">
          {loading ? (
            <div className="py-10 text-center">
              <Loader2 className="size-6 mx-auto animate-spin opacity-60" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma proposta carregada. Verifique a conexão do Bling em Configurações → Integrações.
            </p>
          ) : (
            items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                <Checkbox
                  checked={Boolean(checked[it.id])}
                  onCheckedChange={(v) => setChecked((p) => ({ ...p, [it.id]: v === true }))}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Proposta {it.numero ?? it.id}
                    {it.data ? ` · ${it.data}` : ""}
                    {it.total ? ` · R$ ${it.total.toFixed(2)}` : ""}
                    {it.situacao ? ` · ${it.situacao}` : ""}
                  </p>
                </div>
                <Input
                  className="w-52 font-mono text-xs"
                  placeholder="WhatsApp (55DDD…)"
                  title={
                    it.phoneFonte === "texto"
                      ? "Número extraído do texto da proposta (Introdução/Observações) — confira antes de importar"
                      : undefined
                  }
                  value={phones[it.id] ?? ""}
                  onChange={(e) => setPhones((p) => ({ ...p, [it.id]: e.target.value }))}
                />
                {it.phoneFonte === "texto" && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    via texto
                  </Badge>
                )}
              </div>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Contatos importados recebem automaticamente a categoria <strong>BLING</strong>. Quando o cadastro do cliente
          não tem telefone, o CRM procura um número nos campos <strong>Introdução</strong> e{" "}
          <strong>Observações</strong> da proposta (marcado como “via texto”) — confira esses antes de importar.
          Números em branco podem ser preenchidos manualmente.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancelar
          </Button>
          <Button onClick={runImport} disabled={importing || marcados === 0} className="gap-1.5">
            {importing ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
            Importar {marcados > 0 ? `(${marcados})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
