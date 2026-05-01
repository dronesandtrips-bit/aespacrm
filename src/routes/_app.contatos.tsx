import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Pencil, Trash2, Users, Download, Upload, Loader2, GitBranch, AlertTriangle, Sparkles, Sparkle, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { contactsDb, categoriesDb, sequencesDb, userSettingsDb, type Contact, type Category, type Sequence } from "@/lib/db";
import { toast } from "sonner";
import Papa from "papaparse";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { previewInvalidContacts, deleteInvalidContacts } from "@/server/contacts-cleanup.functions";

const ALL = "__all__";
const NONE = "__none__";
const PAGE_SIZE = 50;

const SORT_KEYS = ["name", "phone", "email", "category", "urgency"] as const;
type SortKey = (typeof SORT_KEYS)[number];

const searchSchema = z.object({
  page: fallback(z.number().int().min(1), 1).default(1),
  q: fallback(z.string(), "").default(""),
  cat: fallback(z.string(), ALL).default(ALL),
  persona: fallback(z.string(), "").default(""),
  sort: fallback(z.enum(SORT_KEYS), "name").default("name"),
  dir: fallback(z.enum(["asc", "desc"]), "asc").default("asc"),
});

export const Route = createFileRoute("/_app/contatos")({
  validateSearch: zodValidator(searchSchema),
  component: ContactsPage,
});

function ContactsPage() {
  const { page, q, cat, persona, sort, dir } = Route.useSearch();
  const navigate = useNavigate({ from: "/contatos" });

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [enrollContact, setEnrollContact] = useState<Contact | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const handleCleanInvalid = async () => {
    try {
      setCleaning(true);
      const preview = await previewInvalidContacts();
      if (preview.invalid === 0) {
        toast.success("Nenhum contato inválido encontrado 🎉");
        return;
      }
      const ok = window.confirm(
        `Encontrados ${preview.invalid} contatos inválidos (de ${preview.total} no total).\n\n` +
          `Eles serão APAGADOS permanentemente, junto com mensagens e sequências vinculadas.\n\n` +
          `Confirmar limpeza?`,
      );
      if (!ok) return;
      const res = await deleteInvalidContacts();
      toast.success(`${res.deleted} contatos removidos. ${res.remaining} restantes.`);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao limpar contatos");
    } finally {
      setCleaning(false);
    }
  };

  const refresh = async () => {
    try {
      const [cs, cats, sqs] = await Promise.all([
        contactsDb.list(),
        categoriesDb.list(),
        sequencesDb.list(),
      ]);
      setContacts(cs);
      setCategories(cats);
      setSequences(sqs);
    } catch (e: any) {
      toast.error(`Erro ao carregar: ${e.message ?? e}`);
    }
  };

  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const handleEnrich = async (c: Contact) => {
    if (enriching.has(c.id)) return;
    let webhookUrl: string | null = null;
    try {
      const s = await userSettingsDb.get();
      webhookUrl = s.rescanWebhookUrl;
    } catch (e: any) {
      toast.error(`Erro ao ler configurações: ${e.message ?? e}`);
      return;
    }
    if (!webhookUrl) {
      toast.error("Configure a URL de varredura em Configurações → IA");
      return;
    }
    setEnriching((prev) => new Set(prev).add(c.id));
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enrich_contact",
          contact_id: c.id,
          phone: c.phone,
          triggered_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        toast.error(`Webhook respondeu ${res.status}`);
        return;
      }
      toast.success(`Enriquecimento disparado para ${c.name}. Atualizando em 8s…`);
      setTimeout(() => {
        refresh();
      }, 8000);
    } catch (e: any) {
      toast.error(`Falha ao chamar webhook: ${e.message ?? e}`);
    } finally {
      setEnriching((prev) => {
        const n = new Set(prev);
        n.delete(c.id);
        return n;
      });
    }
  };

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      contacts.filter((c) => {
        const matchSearch =
          !q ||
          c.name.toLowerCase().includes(q.toLowerCase()) ||
          c.phone.includes(q);
        const tags = c.categoryIds && c.categoryIds.length
          ? c.categoryIds
          : c.categoryId
            ? [c.categoryId]
            : [];
        const matchCat = cat === ALL || tags.includes(cat);
        const matchPersona =
          !persona ||
          (c.aiPersonaSummary ?? "").toLowerCase().includes(persona.toLowerCase());
        return matchSearch && matchCat && matchPersona;
      }),
    [contacts, q, cat, persona],
  );

  const URGENCY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const mult = dir === "asc" ? 1 : -1;
    const catName = (id?: string | null) =>
      (id && categories.find((k) => k.id === id)?.name) || "";
    arr.sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      switch (sort) {
        case "name":
          va = a.name?.toLowerCase() ?? "";
          vb = b.name?.toLowerCase() ?? "";
          break;
        case "phone":
          va = a.phone ?? "";
          vb = b.phone ?? "";
          break;
        case "email":
          va = (a.email ?? "").toLowerCase();
          vb = (b.email ?? "").toLowerCase();
          break;
        case "category":
          // Ordena pela 1ª tag (espelho em categoryId)
          va = catName(a.categoryId).toLowerCase();
          vb = catName(b.categoryId).toLowerCase();
          break;
        case "urgency":
          va = URGENCY_RANK[a.urgencyLevel ?? ""] ?? 0;
          vb = URGENCY_RANK[b.urgencyLevel ?? ""] ?? 0;
          break;
      }
      // Vazios sempre por último, independente da direção
      const aEmpty = va === "" || va === 0;
      const bEmpty = vb === "" || vb === 0;
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;
      if (va < vb) return -1 * mult;
      if (va > vb) return 1 * mult;
      return 0;
    });
    return arr;
  }, [filtered, sort, dir, categories]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  const goto = (
    next: Partial<{ page: number; q: string; cat: string; persona: string; sort: SortKey; dir: "asc" | "desc" }>,
  ) => navigate({ search: (prev: any) => ({ ...prev, ...next }) });

  const toggleSort = (key: SortKey) => {
    if (sort === key) {
      goto({ dir: dir === "asc" ? "desc" : "asc", page: 1 });
    } else {
      goto({ sort: key, dir: "asc", page: 1 });
    }
  };

  const handleSave = async (data: Omit<Contact, "id" | "createdAt">) => {
    try {
      if (editing) {
        await contactsDb.update(editing.id, data);
        toast.success("Contato atualizado");
      } else {
        await contactsDb.create(data);
        toast.success("Contato criado");
      }
      await refresh();
      setOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remover este contato?")) return;
    try {
      await contactsDb.remove(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refresh();
      toast.success("Contato removido");
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allPageSelected =
    pageItems.length > 0 && pageItems.every((c) => selected.has(c.id));
  const somePageSelected =
    pageItems.some((c) => selected.has(c.id)) && !allPageSelected;

  const togglePageAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageItems.forEach((c) => next.delete(c.id));
      } else {
        pageItems.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected(new Set(filtered.map((c) => c.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Remover ${ids.length} contato${ids.length > 1 ? "s" : ""}? Essa ação não pode ser desfeita.`)) return;
    setBulkDeleting(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await contactsDb.remove(id);
        ok++;
      } catch {
        fail++;
      }
    }
    setSelected(new Set());
    await refresh();
    setBulkDeleting(false);
    if (fail === 0) toast.success(`${ok} contato${ok > 1 ? "s" : ""} removido${ok > 1 ? "s" : ""}`);
    else toast.warning(`${ok} removidos, ${fail} falharam`);
  };

  const handleExport = () => {
    const rows = filtered.map((c) => {
      const tagIds = c.categoryIds && c.categoryIds.length
        ? c.categoryIds
        : c.categoryId
          ? [c.categoryId]
          : [];
      const tagNames = tagIds
        .map((id) => categories.find((k) => k.id === id)?.name)
        .filter(Boolean)
        .join(", ");
      return {
        Nome: c.name,
        Telefone: c.phone,
        Email: c.email ?? "",
        Categorias: tagNames,
        Notas: c.notes ?? "",
        "Criado em": new Date(c.createdAt).toLocaleString("pt-BR"),
      };
    });
    const csv = Papa.unparse(rows);
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contatos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} contatos exportados`);
  };

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {loading ? "Carregando..." : `${contacts.length} contatos no total · ${filtered.length} filtrados`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleCleanInvalid}
            disabled={cleaning}
            title="Remove contatos vindos de grupos, broadcasts e telefones inválidos"
          >
            {cleaning ? <Loader2 className="size-4 animate-spin" /> : <Sparkle className="size-4" />}
            Limpar contatos inválidos
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
            <Download className="size-4" /> Exportar CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" /> Importar CSV
          </Button>
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
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">
              {selected.size} contato{selected.size > 1 ? "s" : ""} selecionado{selected.size > 1 ? "s" : ""}
            </span>
            {selected.size < filtered.length && (
              <button
                type="button"
                onClick={selectAllFiltered}
                className="text-primary hover:underline text-xs"
              >
                Selecionar todos os {filtered.length} filtrados
              </button>
            )}
            <button
              type="button"
              onClick={clearSelection}
              className="text-muted-foreground hover:underline text-xs"
            >
              Limpar seleção
            </button>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="gap-2"
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
          >
            {bulkDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Excluir selecionados
          </Button>
        </div>
      )}

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={q}
              onChange={(e) => goto({ q: e.target.value, page: 1 })}
              className="pl-9"
            />
          </div>
          <div className="relative sm:w-64">
            <Sparkles className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filtrar por persona (IA)..."
              value={persona}
              onChange={(e) => goto({ persona: e.target.value, page: 1 })}
              className="pl-9"
            />
          </div>
          <Select value={cat} onValueChange={(v) => goto({ cat: v, page: 1 })}>
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
        {loading ? (
          <div className="py-16 text-center text-muted-foreground">
            <Loader2 className="size-6 mx-auto mb-2 animate-spin opacity-60" />
            <p className="text-sm">Carregando contatos...</p>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Users className="size-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nenhum contato encontrado</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={togglePageAll}
                    aria-label="Selecionar todos da página"
                  />
                </TableHead>
                <SortableHead label="Nome" k="name" sort={sort} dir={dir} onSort={toggleSort} />
                <SortableHead label="Telefone" k="phone" sort={sort} dir={dir} onSort={toggleSort} />
                <SortableHead label="Email" k="email" sort={sort} dir={dir} onSort={toggleSort} className="hidden md:table-cell" />
                <SortableHead label="Categoria" k="category" sort={sort} dir={dir} onSort={toggleSort} />
                <SortableHead label="Urgência" k="urgency" sort={sort} dir={dir} onSort={toggleSort} />
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((c) => {
                const tagIds = c.categoryIds && c.categoryIds.length
                  ? c.categoryIds
                  : c.categoryId
                    ? [c.categoryId]
                    : [];
                const tagObjs = tagIds
                  .map((id) => categories.find((k) => k.id === id))
                  .filter(Boolean) as Category[];
                const primary = tagObjs[0];
                return (
                  <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                    <TableCell className="w-[40px]">
                      <Checkbox
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggleSelect(c.id)}
                        aria-label={`Selecionar ${c.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div
                          className="size-8 rounded-full grid place-items-center text-white text-xs font-semibold"
                          style={{ backgroundColor: primary?.color ?? "#94a3b8" }}
                        >
                          {c.name[0]}
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium block truncate">{c.name}</span>
                          {c.aiPersonaSummary && (
                            <span
                              className="text-[11px] text-muted-foreground block truncate max-w-[260px]"
                              title={c.aiPersonaSummary}
                            >
                              {c.aiPersonaSummary}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {c.email || "—"}
                    </TableCell>
                    <TableCell>
                      {tagObjs.length ? (
                        <div className="flex flex-wrap gap-1 max-w-[280px]">
                          {tagObjs.map((t) => (
                            <Badge
                              key={t.id}
                              variant="outline"
                              style={{ borderColor: t.color, color: t.color }}
                            >
                              {t.name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.urgencyLevel ? (
                        <UrgencyBadgeContacts level={c.urgencyLevel} />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Enriquecer com IA agora"
                        disabled={enriching.has(c.id)}
                        onClick={() => handleEnrich(c)}
                      >
                        {enriching.has(c.id) ? (
                          <Loader2 className="size-4 animate-spin text-primary" />
                        ) : (
                          <Sparkles className="size-4 text-primary" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Adicionar a uma sequência"
                        onClick={() => setEnrollContact(c)}
                      >
                        <GitBranch className="size-4" />
                      </Button>
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

      {filtered.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Mostrando {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} de{" "}
            {filtered.length} contatos
          </p>
          <PaginationNav
            page={safePage}
            totalPages={totalPages}
            onChange={(p) => goto({ page: p })}
          />
        </div>
      )}

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        categories={categories}
        onImported={refresh}
      />

      <EnrollDialog
        contact={enrollContact}
        sequences={sequences}
        onClose={() => setEnrollContact(null)}
      />
    </div>
  );
}

function SortableHead({
  label,
  k,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort === k;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1.5 hover:text-foreground transition-colors ${
          active ? "text-foreground font-medium" : "text-muted-foreground"
        }`}
        title={`Ordenar por ${label}`}
      >
        {label}
        <Icon className="size-3.5 opacity-70" />
      </button>
    </TableHead>
  );
}

function PaginationNav({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            onClick={(e) => {
              e.preventDefault();
              if (page > 1) onChange(page - 1);
            }}
            className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
          />
        </PaginationItem>
        {pages.map((p, i) =>
          p === "…" ? (
            <PaginationItem key={`e${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink
                isActive={p === page}
                onClick={(e) => {
                  e.preventDefault();
                  onChange(p);
                }}
                className="cursor-pointer"
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            onClick={(e) => {
              e.preventDefault();
              if (page < totalPages) onChange(page + 1);
            }}
            className={
              page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
            }
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

type ParsedRow = {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  categoryName?: string;
};

function ImportDialog({
  open,
  onOpenChange,
  categories,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: Category[];
  onImported: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setRows([]);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = (file: File) => {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed: ParsedRow[] = result.data
          .map((r) => {
            const get = (...keys: string[]) => {
              for (const k of keys) {
                const found = Object.keys(r).find(
                  (rk) => rk.trim().toLowerCase() === k.toLowerCase(),
                );
                if (found && r[found]) return String(r[found]).trim();
              }
              return "";
            };
            return {
              name: get("Nome", "name"),
              phone: get("Telefone", "phone", "celular", "whatsapp"),
              email: get("Email", "e-mail") || undefined,
              notes: get("Notas", "notes", "observação") || undefined,
              categoryName: get("Categoria", "category") || undefined,
            };
          })
          .filter((r) => r.name && r.phone);
        setRows(parsed);
        if (parsed.length === 0) {
          toast.error("Nenhuma linha válida encontrada (precisa ter Nome e Telefone)");
        }
      },
      error: (err) => toast.error(`Erro ao ler CSV: ${err.message}`),
    });
  };

  const confirm = async () => {
    setImporting(true);
    try {
      const toImport = rows.map((r) => ({
        name: r.name,
        phone: r.phone,
        email: r.email,
        notes: r.notes,
        categoryId: r.categoryName
          ? categories.find((c) => c.name.toLowerCase() === r.categoryName!.toLowerCase())?.id
          : undefined,
      }));
      const result = await contactsDb.bulkImport(toImport);
      toast.success(
        `✅ ${result.imported} importados${result.skipped > 0 ? ` · ⚠️ ${result.skipped} ignorados` : ""}`,
      );
      await onImported();
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Erro ao importar: ${e.message ?? e}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar contatos via CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground border rounded-lg p-3 bg-muted/30">
            <p className="font-semibold text-foreground mb-1">Formato esperado:</p>
            <p>
              Colunas: <code>Nome</code>, <code>Telefone</code>, <code>Email</code>,{" "}
              <code>Categoria</code>, <code>Notas</code>
            </p>
            <p className="mt-1">
              Telefones duplicados (já existentes) serão ignorados automaticamente.
            </p>
          </div>

          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
            />
            {fileName && (
              <p className="text-xs text-muted-foreground mt-2">
                {fileName} · {rows.length} linhas válidas
              </p>
            )}
          </div>

          {rows.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <p className="text-xs font-semibold p-2 bg-muted">
                Pré-visualização (primeiras 5 linhas)
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Categoria</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 5).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.phone}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {r.categoryName ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={rows.length === 0 || importing}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : null}
            Importar {rows.length > 0 ? `(${rows.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({
  initial,
  categories,
  onSubmit,
}: {
  initial: Contact | null;
  categories: { id: string; name: string; color: string }[];
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

function EnrollDialog({
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

function UrgencyBadgeContacts({ level }: { level: "Baixa" | "Média" | "Alta" }) {
  const cls =
    level === "Alta"
      ? "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
      : level === "Média"
        ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  return (
    <Badge variant="outline" className={`gap-1 ${cls}`}>
      <AlertTriangle className="size-3" />
      {level}
    </Badge>
  );
}
