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
    if (!confirm(`Mesclar automaticamente ${certain.length} pares com telefone ou e-mail idêntico?`))
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
