// Diálogo: lista contatos importados do Bling que ficaram sem telefone e sem
// nenhum nome parecido entre os contatos que têm número — ou seja, sem forma
// de identificar a quem pertencem. Permite apagar em lote com revisão.
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
import { Loader2, Trash2 } from "lucide-react";
import { contactsDb, type Contact, type Category } from "@/lib/db";
import { toast } from "sonner";

const STOP = new Set(["cliente", "clientes", "ltda", "me", "epp", "sa", "eireli", "sr", "sra", "da", "de", "do", "dos", "das", "e"]);

function nameTokens(name: string | null | undefined): string[] {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function tokenScore(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let hits = 0;
  for (const t of sa) if (sb.has(t)) hits++;
  const min = Math.min(sa.size, sb.size);
  if (min < 2) return 0;
  return hits / min;
}

/** Contatos BLING sem telefone e sem nenhum nome parecido entre contatos com número. */
export function findBlingOrphans(contacts: Contact[], categories: Category[]): Contact[] {
  const bling = categories.find((c) => c.name.trim().toLowerCase() === "bling");
  if (!bling) return [];
  const inBling = (c: Contact) =>
    c.categoryId === bling.id || (c.categoryIds ?? []).includes(bling.id);
  const hasPhone = (c: Contact) => String(c.phone ?? "").replace(/\D/g, "").length > 0;

  const withPhoneTokens = contacts
    .filter((c) => !c.isGroup && hasPhone(c))
    .map((c) => nameTokens(c.name))
    .filter((t) => t.length > 0);

  return contacts.filter((c) => {
    if (c.isGroup || !inBling(c) || hasPhone(c)) return false;
    const tokens = nameTokens(c.name);
    if (!tokens.length) return true; // sem número e sem nome útil: órfão
    return !withPhoneTokens.some((t) => tokenScore(tokens, t) >= 0.6);
  });
}

export function BlingOrphanCleanupDialog({
  open,
  onOpenChange,
  contacts,
  categories,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contacts: Contact[];
  categories: Category[];
  onDone: () => Promise<void> | void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const orphans = useMemo(
    () => (open ? findBlingOrphans(contacts, categories) : []),
    [open, contacts, categories],
  );
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orphans.filter(
      (c) => !term || `${c.name} ${c.email ?? ""}`.toLowerCase().includes(term),
    );
  }, [orphans, q]);

  const allChecked = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const toggleAll = (on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const c of visible) {
        if (on) n.add(c.id);
        else n.delete(c.id);
      }
      return n;
    });
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const deleteSelected = async () => {
    const ids = visible.filter((c) => selected.has(c.id)).map((c) => c.id);
    if (!ids.length) return;
    if (!confirm(`Apagar definitivamente ${ids.length} contatos sem número? Essa ação não tem volta.`)) return;
    setBusy(true);
    let ok = 0;
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          await contactsDb.remove(id);
          ok++;
        } catch (e) {
          console.warn("[bling-orphan] delete", e);
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    setSelected(new Set());
    setBusy(false);
    await onDone();
    toast.success(`${ok} contatos apagados`);
    if (ok === ids.length) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-4" /> Contatos do Bling sem número e sem correspondência
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Buscar por nome ou e-mail…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <Badge variant="secondary">{visible.length} contatos</Badge>
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto gap-1.5"
            onClick={deleteSelected}
            disabled={busy || visible.filter((c) => selected.has(c.id)).length === 0}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Apagar selecionados ({visible.filter((c) => selected.has(c.id)).length})
          </Button>
        </div>

        <div className="max-h-[420px] space-y-1 overflow-auto rounded-lg border p-2">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum contato do Bling sem identificação. 
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  disabled={busy}
                  aria-label="Selecionar todos"
                />
                Selecionar todos
              </label>
              {visible.map((c) => (
                <label key={c.id} className="flex items-center gap-3 rounded-md px-3 py-1.5 hover:bg-muted/50">
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={(v) => toggle(c.id, v === true)}
                    disabled={busy}
                    aria-label={`Selecionar ${c.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{c.name || "(sem nome)"}</p>
                    {c.email && <p className="truncate text-xs text-muted-foreground">{c.email}</p>}
                  </div>
                </label>
              ))}
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Aqui aparecem só os contatos da categoria BLING que não têm telefone e cujo nome não se
          parece com nenhum contato da sua agenda — sem forma de identificar a quem pertencem.
          Apagar é definitivo.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
