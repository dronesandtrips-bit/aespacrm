// Diálogo: cruzamento de dados entre contatos para achar prováveis duplicados
// (mesmo telefone, mesmo e-mail, mesmo nome ou nomes muito parecidos) e
// oferecer a mesclagem par a par. Só faz leitura + merge; nada é apagado sem
// o usuário clicar.
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, GitMerge, ArrowRight } from "lucide-react";
import { contactsDb, type Contact } from "@/lib/db";
import { phoneMatchVariants } from "@/lib/phone-validation";
import { toast } from "sonner";

export type DupPair = {
  key: string;
  keep: Contact;
  drop: Contact;
  score: number;
  reason: string;
};

/** Qual dos dois contatos deve ficar (o mais completo/antigo). */
function rank(c: Contact) {
  let s = 0;
  if (c.phone) s += 100;
  if (c.email) s += 10;
  if (c.notes) s += 5;
  if (c.avatarUrl) s += 5;
  if ((c.categoryIds?.length ?? 0) > 0) s += 3;
  return s;
}

function orderPair(a: Contact, b: Contact): [Contact, Contact] {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra > rb ? [a, b] : [b, a];
  return (a.createdAt ?? "") <= (b.createdAt ?? "") ? [a, b] : [b, a];
}

const STOP = new Set(["cliente", "clientes", "ltda", "me", "epp", "sa", "eireli", "sr", "sra", "da", "de", "do", "dos", "das", "e"]);

/** Palavras significativas do nome, sem acento e sem termos genéricos. */
function nameTokens(name: string | null | undefined): string[] {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Proporção de palavras em comum em relação ao nome mais curto. */
function tokenScore(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let hits = 0;
  for (const t of sa) if (sb.has(t)) hits++;
  const min = Math.min(sa.size, sb.size);
  if (min < 2) return 0;
  return hits / min;
}

export function findDuplicatePairs(contacts: Contact[]): DupPair[] {

  const list = contacts.filter((c) => !c.isGroup);
  const found = new Map<string, DupPair>();

  const add = (a: Contact, b: Contact, score: number, reason: string) => {
    if (a.id === b.id) return;
    const key = [a.id, b.id].sort().join("|");
    const prev = found.get(key);
    if (prev && prev.score >= score) return;
    const [keep, drop] = orderPair(a, b);
    found.set(key, { key, keep, drop, score, reason });
  };

  // 1) Telefone igual (inclui variação do 9º dígito no Brasil)
  const byPhone = new Map<string, Contact[]>();
  for (const c of list) {
    for (const v of phoneMatchVariants(c.phone)) {
      if (!v) continue;
      const arr = byPhone.get(v) ?? [];
      arr.push(c);
      byPhone.set(v, arr);
    }
  }
  for (const arr of byPhone.values()) {
    const uniq = Array.from(new Map(arr.map((c) => [c.id, c])).values());
    for (let i = 0; i < uniq.length; i++)
      for (let j = i + 1; j < uniq.length; j++) add(uniq[i], uniq[j], 100, "Mesmo telefone");
  }

  // 2) Telefone semelhante: mesmos 8 dígitos finais (variações de DDI/9º dígito)
  const byTail = new Map<string, Contact[]>();
  for (const c of list) {
    const d = String(c.phone ?? "").replace(/\D/g, "");
    if (d.length < 10) continue;
    const tail = d.slice(-8);
    const arr = byTail.get(tail) ?? [];
    arr.push(c);
    byTail.set(tail, arr);
  }
  for (const arr of byTail.values()) {
    if (arr.length > 20) continue;
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) add(arr[i], arr[j], 90, "Telefone parecido");
  }

  // 3) Contato SEM telefone x contato COM telefone, quando o nome bate.
  // Caso típico: cliente importado do Bling (só nome) que já existe no
  // WhatsApp com número. Sem isso ele nunca aparece como duplicado.
  const noPhone = list.filter((c) => !String(c.phone ?? "").replace(/\D/g, ""));
  const withPhone = list.filter((c) => String(c.phone ?? "").replace(/\D/g, ""));
  for (const a of noPhone) {
    const ta = nameTokens(a.name);
    if (!ta.length) continue;
    for (const b of withPhone) {
      const tb = nameTokens(b.name);
      if (!tb.length) continue;
      const s = tokenScore(ta, tb);
      if (s >= 0.6) add(a, b, s >= 0.99 ? 88 : 70, s >= 0.99 ? "Mesmo nome, sem número" : "Nome parecido, sem número");
    }
  }

  return Array.from(found.values()).sort((a, b) => b.score - a.score);
}


function label(c: Contact) {
  const bits = [c.phone ? `+${c.phone}` : "sem número", c.email ?? ""].filter(Boolean);
  return bits.join(" · ");
}

export function DuplicateScanDialog({
  open,
  onOpenChange,
  contacts,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contacts: Contact[];
  onMerged: () => Promise<void> | void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const pairs = useMemo(() => (open ? findDuplicatePairs(contacts) : []), [open, contacts]);
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return pairs
      .filter((p) => !dismissed.has(p.key))
      .filter(
        (p) =>
          !term ||
          `${p.keep.name} ${p.drop.name} ${p.keep.phone} ${p.drop.phone}`.toLowerCase().includes(term),
      );
  }, [pairs, q, dismissed]);

  const certain = visible.filter((p) => p.score >= 95);
  const selectedPairs = visible.filter((p) => selected.has(p.key));

  const toggleSelect = (key: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });

  const mergeSelected = async () => {
    if (!selectedPairs.length) return;
    if (!confirm(`Mesclar os ${selectedPairs.length} pares selecionados?`)) return;
    setBulk(true);
    let ok = 0;
    const done = new Set<string>();
    for (const p of selectedPairs) {
      if (done.has(p.keep.id) || done.has(p.drop.id)) continue;
      try {
        await contactsDb.merge(p.drop.id, p.keep.id, {});
        done.add(p.drop.id);
        ok++;
      } catch (e) {
        console.warn("[dup] merge selecionado", e);
      }
    }
    setDismissed((s) => {
      const n = new Set(s);
      for (const p of selectedPairs) n.add(p.key);
      return n;
    });
    setSelected(new Set());
    setBulk(false);
    await onMerged();
    toast.success(`${ok} contatos mesclados`);
  };

  const mergePair = async (p: DupPair) => {
    setBusy(p.key);
    try {
      await contactsDb.merge(p.drop.id, p.keep.id, {});
      setDismissed((s) => new Set(s).add(p.key));
      await onMerged();
      toast.success(`Mesclado em "${p.keep.name || p.keep.phone}"`);
    } catch (e: any) {
      toast.error(`Não deu para mesclar: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const mergeCertain = async () => {
    if (!certain.length) return;
    if (!confirm(`Mesclar automaticamente ${certain.length} pares com telefone idêntico?`))
      return;
    setBulk(true);
    let ok = 0;
    const done = new Set<string>();
    for (const p of certain) {
      if (done.has(p.keep.id) || done.has(p.drop.id)) continue;
      try {
        await contactsDb.merge(p.drop.id, p.keep.id, {});
        done.add(p.drop.id);
        ok++;
      } catch (e) {
        console.warn("[dup] merge", e);
      }
    }
    setDismissed((s) => {
      const n = new Set(s);
      for (const p of certain) n.add(p.key);
      return n;
    });
    setBulk(false);
    await onMerged();
    toast.success(`${ok} contatos mesclados`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !bulk && onOpenChange(o)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="size-4" /> Contatos parecidos (possíveis duplicados)
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Buscar por nome ou telefone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <Badge variant="secondary">{visible.length} pares</Badge>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-1.5"
            onClick={mergeSelected}
            disabled={bulk || selectedPairs.length === 0}
          >
            {bulk ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />}
            Mesclar selecionados ({selectedPairs.length})
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={mergeCertain}
            disabled={bulk || certain.length === 0}
          >
            {bulk ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />}
            Mesclar os certos ({certain.length})
          </Button>
        </div>

        <div className="max-h-[460px] space-y-2 overflow-auto rounded-lg border p-2">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum contato parecido encontrado.
            </p>
          ) : (
            visible.map((p) => (
              <div key={p.key} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.drop.name || "(sem nome)"}</p>
                  <p className="truncate text-xs text-muted-foreground">{label(p.drop)}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 opacity-50" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.keep.name || "(sem nome)"}</p>
                  <p className="truncate text-xs text-muted-foreground">{label(p.keep)}</p>
                </div>
                <Badge variant={p.score >= 95 ? "default" : "outline"} className="shrink-0 text-[10px]">
                  {p.reason}
                </Badge>
                <Button
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={() => mergePair(p)}
                  disabled={busy !== null || bulk}
                >
                  {busy === p.key ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />}
                  Mesclar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => setDismissed((s) => new Set(s).add(p.key))}
                  disabled={busy !== null || bulk}
                >
                  Ignorar
                </Button>
              </div>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          O contato da direita é o que fica (o mais completo). Ao mesclar, o histórico de conversas, as
          etiquetas e os dados que faltavam passam para ele, e o cadastro repetido é apagado.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy !== null || bulk}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
