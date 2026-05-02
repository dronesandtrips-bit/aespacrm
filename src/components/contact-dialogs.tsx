import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sequencesDb, type Contact, type Sequence, type Category } from "@/lib/db";

export function ContactDialog({
  initial,
  categories,
  onSubmit,
}: {
  initial: Contact | null;
  categories: Pick<Category, "id" | "name" | "color">[];
  onSubmit: (data: Omit<Contact, "id" | "createdAt">) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const initialTags =
    initial?.categoryIds && initial.categoryIds.length
      ? initial.categoryIds
      : initial?.categoryId
        ? [initial.categoryId]
        : [];
  const [selectedIds, setSelectedIds] = useState<string[]>(initialTags);
  const [saving, setSaving] = useState(false);

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
        notes: notes.trim() || undefined,
        categoryIds: selectedIds,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar contato" : "Novo contato"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handle} className="space-y-3">
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
