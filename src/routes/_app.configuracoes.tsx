import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, User, LogOut } from "lucide-react";
import { db, type Category } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/configuracoes")({
  component: SettingsPage,
});

const COLORS = [
  "#10B981",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#EF4444",
  "#14B8A6",
  "#64748B",
];

function SettingsPage() {
  return (
    <div className="max-w-4xl">
      <Tabs defaultValue="categorias">
        <TabsList>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="conta">Conta</TabsTrigger>
        </TabsList>
        <TabsContent value="categorias" className="mt-5">
          <CategoriesTab />
        </TabsContent>
        <TabsContent value="pipeline" className="mt-5">
          <PipelineTab />
        </TabsContent>
        <TabsContent value="conta" className="mt-5">
          <AccountTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CategoriesTab() {
  const [list, setList] = useState<Category[]>(() => db.listCategories());
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = () => setList([...db.listCategories()]);

  const save = (name: string, color: string) => {
    if (!name.trim()) return toast.error("Nome obrigatório");
    if (editing) {
      db.updateCategory(editing.id, { name: name.trim(), color });
      toast.success("Categoria atualizada");
    } else {
      db.createCategory(name.trim(), color);
      toast.success("Categoria criada");
    }
    refresh();
    setOpen(false);
    setEditing(null);
  };

  const remove = (id: string) => {
    if (!confirm("Remover esta categoria?")) return;
    db.deleteCategory(id);
    refresh();
    toast.success("Removida");
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">Categorias de contatos</h3>
          <p className="text-xs text-muted-foreground">{list.length} categorias</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" /> Nova categoria
            </Button>
          </DialogTrigger>
          <CategoryDialog key={editing?.id ?? "new"} initial={editing} onSubmit={save} />
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((c) => (
          <div key={c.id} className="border rounded-lg p-3 flex items-center gap-3">
            <div
              className="size-10 rounded-lg shrink-0"
              style={{ backgroundColor: c.color }}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{c.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{c.color}</p>
            </div>
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
            <Button variant="ghost" size="icon" onClick={() => remove(c.id)}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CategoryDialog({
  initial,
  onSubmit,
}: {
  initial: Category | null;
  onSubmit: (name: string, color: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar categoria" : "Nova categoria"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(name, color);
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="cn">Nome</Label>
          <Input id="cn" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Cor</Label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  "size-8 rounded-lg border-2 transition",
                  color === c ? "border-foreground scale-110" : "border-transparent",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="submit">Salvar</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function PipelineTab() {
  const stages = db.listStages();
  return (
    <Card className="p-5">
      <h3 className="font-semibold mb-1">Etapas do pipeline</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Configure as etapas de venda. Edição em breve.
      </p>
      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={s.id} className="border rounded-lg p-3 flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="flex-1 font-medium text-sm">{s.name}</span>
            <Button variant="ghost" size="icon" disabled>
              <Pencil className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AccountTab() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-4">
        <div className="size-16 rounded-full bg-primary/10 grid place-items-center text-primary text-2xl font-bold">
          {user?.name?.[0]?.toUpperCase()}
        </div>
        <div>
          <p className="font-semibold">{user?.name}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 pt-2">
        <div className="space-y-1.5">
          <Label>Nome</Label>
          <Input value={user?.name ?? ""} readOnly />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={user?.email ?? ""} readOnly />
        </div>
      </div>
      <div className="pt-2 flex gap-2">
        <Button variant="outline" disabled className="gap-2">
          <User className="size-4" /> Editar perfil
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            logout();
            navigate({ to: "/login" });
          }}
          className="gap-2"
        >
          <LogOut className="size-4" /> Sair da conta
        </Button>
      </div>
    </Card>
  );
}
