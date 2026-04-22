import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, Pencil, Trash2, Users } from "lucide-react";
import { db, type Contact } from "@/lib/mock-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/contatos")({
  component: ContactsPage,
});

const ALL = "__all__";
const NONE = "__none__";

function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>(() => db.listContacts());
  const [categories] = useState(() => db.listCategories());
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>(ALL);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [open, setOpen] = useState(false);

  const filtered = contacts.filter((c) => {
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search);
    const matchCat = filterCat === ALL || c.categoryId === filterCat;
    return matchSearch && matchCat;
  });

  const refresh = () => setContacts([...db.listContacts()]);

  const handleSave = (data: Omit<Contact, "id" | "createdAt">) => {
    if (editing) {
      db.updateContact(editing.id, data);
      toast.success("Contato atualizado");
    } else {
      db.createContact(data);
      toast.success("Contato criado");
    }
    refresh();
    setOpen(false);
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Remover este contato?")) return;
    db.deleteContact(id);
    refresh();
    toast.success("Contato removido");
  };

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {contacts.length} contatos no total · {filtered.length} filtrados
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" /> Novo contato
            </Button>
          </DialogTrigger>
          <ContactDialog
            key={editing?.id ?? "new"}
            initial={editing}
            categories={categories}
            onSubmit={handleSave}
          />
        </Dialog>
      </div>

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="sm:w-56">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas categorias</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Users className="size-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nenhum contato encontrado</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const cat = categories.find((k) => k.id === c.categoryId);
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div
                          className="size-8 rounded-full grid place-items-center text-white text-xs font-semibold"
                          style={{ backgroundColor: cat?.color ?? "#94a3b8" }}
                        >
                          {c.name[0]}
                        </div>
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {c.email || "—"}
                    </TableCell>
                    <TableCell>
                      {cat ? (
                        <Badge
                          variant="outline"
                          style={{ borderColor: cat.color, color: cat.color }}
                        >
                          {cat.name}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditing(c);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(c.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function ContactDialog({
  initial,
  categories,
  onSubmit,
}: {
  initial: Contact | null;
  categories: { id: string; name: string; color: string }[];
  onSubmit: (data: Omit<Contact, "id" | "createdAt">) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? NONE);

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error("Nome e telefone são obrigatórios");
      return;
    }
    onSubmit({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
      categoryId: categoryId === NONE ? undefined : categoryId,
    });
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
          <Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Categoria</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sem categoria</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nt">Notas</Label>
          <Textarea
            id="nt"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button type="submit">Salvar</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
