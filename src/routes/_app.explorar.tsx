import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  MapPin,
  Phone,
  Globe,
  Building2,
  Plus,
  Compass,
} from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/explorar")({
  component: ExplorarPage,
});

const WEBHOOK_KEY = "wpp-crm-explorar-webhook";
const WEBHOOK_API_KEY_KEY = "wpp-crm-explorar-webhook-apikey";

type Lead = {
  name: string;
  phone?: string;
  address?: string;
  website?: string;
};

function normalizeLead(raw: unknown): Lead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name =
    (r.name as string) ||
    (r.nome as string) ||
    (r.title as string) ||
    (r.empresa as string);
  if (!name) return null;
  return {
    name: String(name),
    phone: (r.phone as string) || (r.telefone as string) || (r.phoneNumber as string),
    address:
      (r.address as string) ||
      (r.endereco as string) ||
      (r.formattedAddress as string),
    website: (r.website as string) || (r.site as string) || (r.url as string),
  };
}

function ExplorarPage() {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Lead[] | null>(null);
  const [imported, setImported] = useState<Set<number>>(new Set());

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!niche.trim() || !location.trim()) {
      toast.error("Informe nicho e localização");
      return;
    }
    const webhookUrl =
      typeof window !== "undefined" ? localStorage.getItem(WEBHOOK_KEY) : null;
    if (!webhookUrl) {
      toast.error(
        "Configure a URL do Webhook em Configurações › Integrações",
      );
      return;
    }

    setLoading(true);
    setResults(null);
    setImported(new Set());

    try {
      const apiKey =
        typeof window !== "undefined"
          ? localStorage.getItem(WEBHOOK_API_KEY_KEY) ?? ""
          : "";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) headers["X-API-Key"] = apiKey;
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ niche: niche.trim(), location: location.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Extrai a lista lidando com vários formatos possíveis:
      // - [lead, lead, ...]
      // - { results: [...] } / { leads: [...] } / { data: [...] }
      // - [{ results: [...] }]  (formato n8n "allIncomingItems")
      const extract = (d: unknown): unknown[] => {
        if (!d) return [];
        if (Array.isArray(d)) {
          // Pode ser array de leads OU array com 1 item contendo {results}
          if (d.length > 0 && typeof d[0] === "object" && d[0] !== null) {
            const first = d[0] as Record<string, unknown>;
            if (Array.isArray(first.results)) return first.results;
            if (Array.isArray(first.leads)) return first.leads;
            if (Array.isArray(first.data)) return first.data;
          }
          return d;
        }
        if (typeof d === "object") {
          const o = d as Record<string, unknown>;
          if (Array.isArray(o.results)) return o.results;
          if (Array.isArray(o.leads)) return o.leads;
          if (Array.isArray(o.data)) return o.data;
        }
        return [];
      };
      const list = extract(data);
      const normalized = list.map(normalizeLead).filter((l): l is Lead => !!l);
      setResults(normalized);
      toast.success(`${normalized.length} oportunidade(s) encontrada(s)`);
    } catch (err) {
      console.error(err);
      toast.error("Falha ao buscar leads. Verifique o webhook.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const addToCrm = (lead: Lead, index: number) => {
    db.createContact({
      name: lead.name,
      phone: lead.phone ?? "",
      notes: [lead.address, lead.website].filter(Boolean).join(" · "),
      categoryId: "c1",
    });
    setImported((prev) => new Set(prev).add(index));
    toast.success(`${lead.name} importado para o CRM`);
  };

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Explorar Leads</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Busque novas empresas e oportunidades diretamente do Google Maps
        </p>
      </div>

      <Card className="p-5">
        <form
          onSubmit={search}
          className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 md:items-end"
        >
          <div className="space-y-1.5">
            <Label htmlFor="niche">Nicho / Palavra-chave</Label>
            <Input
              id="niche"
              placeholder="Ex: Restaurantes, Oficinas"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc">Localização</Label>
            <Input
              id="loc"
              placeholder="Ex: Belo Horizonte, MG"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button type="submit" disabled={loading} className="gap-2 md:w-auto">
            <Search className="size-4" />
            {loading ? "Buscando..." : "Buscar Oportunidades"}
          </Button>
        </form>
      </Card>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-9 w-full mt-2" />
            </Card>
          ))}
        </div>
      )}

      {!loading && results === null && (
        <Card className="p-10 text-center">
          <div className="mx-auto size-14 rounded-2xl bg-primary/10 grid place-items-center text-primary mb-4">
            <Compass className="size-7" />
          </div>
          <h3 className="font-semibold">Pronto para explorar</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Informe um nicho e a localização para descobrir empresas
            disponíveis no Google Maps.
          </p>
        </Card>
      )}

      {!loading && results !== null && results.length === 0 && (
        <Card className="p-10 text-center">
          <div className="mx-auto size-14 rounded-2xl bg-muted grid place-items-center text-muted-foreground mb-4">
            <Search className="size-7" />
          </div>
          <h3 className="font-semibold">Nenhum resultado</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Tente outro nicho ou localização.
          </p>
        </Card>
      )}

      {!loading && results && results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((lead, i) => {
            const added = imported.has(i);
            return (
              <Card key={i} className="p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                    <Building2 className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-sm leading-tight truncate">
                      {lead.name}
                    </h3>
                  </div>
                </div>
                <div className="space-y-1.5 text-xs text-muted-foreground flex-1">
                  {lead.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="size-3.5 shrink-0" />
                      <span className="truncate">{lead.phone}</span>
                    </div>
                  )}
                  {lead.address && (
                    <div className="flex items-start gap-2">
                      <MapPin className="size-3.5 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{lead.address}</span>
                    </div>
                  )}
                  {lead.website && (
                    <div className="flex items-center gap-2">
                      <Globe className="size-3.5 shrink-0" />
                      <a
                        href={lead.website}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-primary hover:underline"
                      >
                        {lead.website.replace(/^https?:\/\//, "")}
                      </a>
                    </div>
                  )}
                </div>
                <Button
                  onClick={() => addToCrm(lead, i)}
                  disabled={added}
                  className="gap-2 w-full"
                  variant={added ? "secondary" : "default"}
                >
                  <Plus className="size-4" />
                  {added ? "Adicionado" : "Adicionar ao CRM"}
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
