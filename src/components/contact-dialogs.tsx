import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { contactsDb, sequencesDb, type Contact, type Sequence, type Category } from "@/lib/db";

function norm(s: string) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function ContactDialog({
  initial,
  categories,
  onSubmit,
  agendaContacts,
  onLinked,
}: {
  initial: Contact | null;
  categories: Pick<Category, "id" | "name" | "color">[];
  onSubmit: (data: Omit<Contact, "id" | "createdAt">) => void | Promise<void>;
  /** Agenda completa — habilita o campo "Puxar da agenda" ao editar. */
  agendaContacts?: Contact[];
  /** Chamado depois que o contato editado foi mesclado a um contato da agenda. */
  onLinked?: (target: Contact) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const initialTags =
    initial?.categoryIds && initial.categoryIds.length
      ? initial.categoryIds
      : initial?.categoryId
        ? [initial.categoryId]
        : [];
  const [selectedIds, setSelectedIds] = useState<string[]>(initialTags);
  const [saving, setSaving] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linking, setLinking] = useState<string | null>(null);

  // Sugestões da agenda: só contatos com telefone, excluindo o que está sendo editado.
  const linkMatches = useMemo(() => {
    const q = norm(linkQuery).trim();
    if (!initial || !agendaContacts || q.length < 2) return [];
    return agendaContacts
      .filter(
        (c) =>
          c.id !== initial.id &&
          !c.isGroup &&
          String(c.phone ?? "").replace(/\D/g, "").length > 0 &&
          norm(c.name).includes(q),
      )
      .slice(0, 8);
  }, [linkQuery, agendaContacts, initial]);

  // Mescla o contato editado (origem) no contato escolhido da agenda (destino).
  const linkTo = async (target: Contact) => {
    if (!initial || linking) return;
    const ok = confirm(
      `Relacionar "${initial.name || "este contato"}" a "${target.name || target.phone}"?\n\n` +
        `O contato da agenda permanece com o nome e o telefone dele; os dados e as categorias deste cadastro serão somados a ele.`,
    );
    if (!ok) return;
    setLinking(target.id);
    try {
      await contactsDb.merge(initial.id, target.id, { categoryIds: selectedIds });
      toast.success(`Relacionado a ${target.name || target.phone}`);
      await onLinked?.(target);
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? e}`);
    } finally {
      setLinking(null);
    }
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error("Nome e telefone são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        website: website.trim() || undefined,
        notes: notes.trim() || undefined,
        categoryIds: selectedIds,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar contato" : "Novo contato"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handle} className="space-y-3 pb-2">
        <div className="space-y-1.5">
          <Label htmlFor="n">Nome *</Label>
          <Input id="n" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p">Telefone *</Label>
          <Input
            id="p"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+55 11 91234-5678"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e">Email</Label>
          <Input id="e" type="email" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="w">Website</Label>
          <Input
            id="w"
            type="url"
            value={website ?? ""}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://exemplo.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Categorias (tags)</Label>
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma categoria cadastrada. Crie em Configurações.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const active = selectedIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className="rounded-md border px-2.5 py-1 text-xs font-semibold transition-all"
                    style={{
                      borderColor: c.color,
                      color: active ? "#fff" : c.color,
                      backgroundColor: active ? c.color : "transparent",
                    }}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Clique para adicionar/remover. A primeira tag será a categoria principal.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nt">Notas</Label>
          <Textarea
            id="nt"
            value={notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function EnrollDialog({
  contact,
  sequences,
  onClose,
}: {
  contact: Contact | null;
  sequences: Sequence[];
  onClose: () => void;
}) {
  const [sequenceId, setSequenceId] = useState<string>("");
  const [enrolling, setEnrolling] = useState(false);

  if (!contact) return null;

  const activeSeqs = sequences.filter((s) => s.isActive);

  const submit = async () => {
    if (!sequenceId) return;
    setEnrolling(true);
    try {
      const r = await sequencesDb.enrollFromTrigger(contact.id, sequenceId);
      if (r.enrolled) {
        toast.success(`${contact.name} foi inscrito na sequência`);
      } else {
        toast.info("Contato já está ativo nessa sequência");
      }
      setSequenceId("");
      onClose();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setSequenceId(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar a uma sequência</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Inscrever <span className="font-medium text-foreground">{contact.name}</span> em:
          </p>
          {activeSeqs.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded p-3 bg-muted/30">
              Nenhuma sequência ativa. Crie uma em Sequências.
            </p>
          ) : (
            <Select value={sequenceId} onValueChange={setSequenceId}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha uma sequência" />
              </SelectTrigger>
              <SelectContent>
                {activeSeqs.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-[11px] text-muted-foreground">
            Se o contato já estiver em outra sequência, ela será pausada.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={!sequenceId || enrolling}>
            {enrolling && <Loader2 className="size-4 mr-1 animate-spin" />} Inscrever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Diálogo mostrado quando o número digitado já pertence a outro contato.
 * Permite mesclar os dois cadastros, apenas somar as categorias ao contato
 * existente, ou voltar e corrigir o número.
 */
export function MergeContactDialog({
  source,
  existing,
  pending,
  categories,
  onCancel,
  onDone,
}: {
  source: Contact;
  existing: Contact;
  pending: Omit<Contact, "id" | "createdAt">;
  categories: Pick<Category, "id" | "name" | "color">[];
  onCancel: () => void;
  onDone: () => void | Promise<void>;
}) {
  const unionTags = Array.from(
    new Set([...(existing.categoryIds ?? []), ...(pending.categoryIds ?? [])]),
  );
  const [finalName, setFinalName] = useState(pending.name || existing.name || "");
  const [busy, setBusy] = useState<null | "merge" | "tags">(null);

  const run = async (mode: "merge" | "tags") => {
    setBusy(mode);
    try {
      if (mode === "merge") {
        await contactsDb.merge(source.id, existing.id, {
          name: finalName.trim() || existing.name,
          email: pending.email ?? undefined,
          website: pending.website ?? undefined,
          notes: pending.notes ?? undefined,
          categoryIds: unionTags,
        });
        toast.success("Contatos mesclados");
      } else {
        await contactsDb.update(existing.id, {
          name: finalName.trim() || existing.name,
          categoryIds: unionTags,
        });
        toast.success("Categorias adicionadas ao contato existente");
      }
      await onDone();
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const tagName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Esse número já tem um contato</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            O número <span className="font-medium text-foreground">{pending.phone}</span> já está
            no contato <span className="font-medium text-foreground">{existing.name || "sem nome"}</span>.
            Escolha o que fazer:
          </p>
          <div className="rounded-md border p-3 space-y-2">
            <div className="space-y-1.5">
              <Label htmlFor="mergename">Nome que vai ficar</Label>
              <Input
                id="mergename"
                value={finalName}
                onChange={(e) => setFinalName(e.target.value)}
              />
            </div>
            {unionTags.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Categorias juntadas: {unionTags.map(tagName).join(", ")}
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button className="w-full" onClick={() => run("merge")} disabled={busy !== null}>
            {busy === "merge" && <Loader2 className="size-4 mr-1 animate-spin" />}
            Mesclar os dois contatos
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => run("tags")}
            disabled={busy !== null}
          >
            {busy === "tags" && <Loader2 className="size-4 mr-1 animate-spin" />}
            Só adicionar as categorias ao contato existente
          </Button>
          <Button variant="outline" className="w-full" onClick={onCancel} disabled={busy !== null}>
            Voltar e usar outro número
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
