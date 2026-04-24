import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  MapPin,
  Phone,
  Globe,
  Building2,
  Plus,
  Compass,
  Instagram,
  Facebook,
  AtSign,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { contactsDb } from "@/lib/db";

export const Route = createFileRoute("/_app/explorar")({
  component: ExplorarPage,
});

const WEBHOOK_KEY = "wpp-crm-explorar-webhook";
const WEBHOOK_API_KEY_KEY = "wpp-crm-explorar-webhook-apikey";

type Source = "google_maps" | "instagram" | "facebook";
type IgMode = "hashtag" | "location";
type FbMode = "page" | "group";

type Lead = {
  name: string;
  phone?: string;
  address?: string;
  website?: string;
  email?: string;
  username?: string;
  bio?: string;
  source?: Source;
};

function normalizeLead(raw: unknown, source: Source): Lead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name =
    (r.name as string) ||
    (r.nome as string) ||
    (r.title as string) ||
    (r.fullName as string) ||
    (r.ownerFullName as string) ||
    (r.username as string) ||
    (r.empresa as string);
  if (!name) return null;
  return {
    name: String(name),
    phone:
      (r.phone as string) ||
      (r.telefone as string) ||
      (r.phoneNumber as string) ||
      (r.businessPhoneNumber as string),
    address:
      (r.address as string) ||
      (r.endereco as string) ||
      (r.formattedAddress as string) ||
      (r.locationName as string),
    website:
      (r.website as string) ||
      (r.site as string) ||
      (r.url as string) ||
      (r.externalUrl as string),
    email: (r.email as string) || (r.businessEmail as string),
    username: (r.username as string) || (r.ownerUsername as string),
    bio: (r.biography as string) || (r.bio as string),
    source,
  };
}

function ExplorarPage() {
  const [source, setSource] = useState<Source>("google_maps");

  // Google Maps
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");

  // Instagram
  const [igMode, setIgMode] = useState<IgMode>("hashtag");
  const [igQuery, setIgQuery] = useState("");

  // Facebook
  const [fbMode, setFbMode] = useState<FbMode>("page");
  const [fbQuery, setFbQuery] = useState("");

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Lead[] | null>(null);
  const [imported, setImported] = useState<Set<number>>(new Set());

  const buildPayload = (): Record<string, unknown> | null => {
    if (source === "google_maps") {
      if (!niche.trim() || !location.trim()) {
        toast.error("Informe nicho e localização");
        return null;
      }
      return {
        source: "google_maps",
        niche: niche.trim(),
        location: location.trim(),
      };
    }
    if (source === "instagram") {
      if (!igQuery.trim()) {
        toast.error(
          igMode === "hashtag"
            ? "Informe a hashtag (sem #)"
            : "Informe o nome do local",
        );
        return null;
      }
      return {
        source: "instagram",
        mode: igMode,
        query: igQuery.trim().replace(/^#/, ""),
      };
    }
    // facebook
    if (!fbQuery.trim()) {
      toast.error(
        fbMode === "page"
          ? "Informe a URL ou nome da página"
          : "Informe a URL do grupo",
      );
      return null;
    }
    return {
      source: "facebook",
      mode: fbMode,
      query: fbQuery.trim(),
    };
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    const webhookUrl =
      typeof window !== "undefined" ? localStorage.getItem(WEBHOOK_KEY) : null;
    if (!webhookUrl) {
      toast.error("Configure a URL do Webhook em Configurações › Integrações");
      return;
    }

    setLoading(true);
    setResults(null);
    setImported(new Set());

    try {
      const apiKey =
        typeof window !== "undefined"
          ? (localStorage.getItem(WEBHOOK_API_KEY_KEY) ?? "")
          : "";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) headers["X-API-Key"] = apiKey;
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const extract = (d: unknown): unknown[] => {
        if (!d) return [];
        if (Array.isArray(d)) {
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
      const normalized = list
        .map((r) => normalizeLead(r, source))
        .filter((l): l is Lead => !!l);
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

  const addToCrm = async (lead: Lead, index: number) => {
    try {
      await contactsDb.create({
        name: lead.name,
        phone: lead.phone ?? "",
        notes: [
          lead.address,
          lead.website,
          lead.email,
          lead.username ? `@${lead.username}` : null,
          lead.bio,
          lead.source ? `Fonte: ${lead.source}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        categoryId: null,
      });
      setImported((prev) => new Set(prev).add(index));
      toast.success(`${lead.name} importado para o CRM`);
    } catch (e: any) {
      toast.error(`Erro ao importar: ${e.message ?? e}`);
    }
  };

  const SourceIcon =
    source === "instagram"
      ? Instagram
      : source === "facebook"
        ? Facebook
        : Compass;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Explorar Leads</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Busque novas empresas e oportunidades no Google Maps, Instagram e
          Facebook
        </p>
      </div>

      <Card className="p-5 space-y-4">
        {/* Seletor de fonte */}
        <div className="space-y-1.5">
          <Label>Fonte de dados</Label>
          <Select
            value={source}
            onValueChange={(v) => {
              setSource(v as Source);
              setResults(null);
            }}
            disabled={loading}
          >
            <SelectTrigger className="md:w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="google_maps">
                <span className="flex items-center gap-2">
                  <Compass className="size-4" /> Google Maps
                </span>
              </SelectItem>
              <SelectItem value="instagram">
                <span className="flex items-center gap-2">
                  <Instagram className="size-4" /> Instagram
                </span>
              </SelectItem>
              <SelectItem value="facebook">
                <span className="flex items-center gap-2">
                  <Facebook className="size-4" /> Facebook
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <form onSubmit={search} className="space-y-3">
          {source === "google_maps" && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 md:items-end">
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
              <Button type="submit" disabled={loading} className="gap-2">
                <Search className="size-4" />
                {loading ? "Buscando..." : "Buscar"}
              </Button>
            </div>
          )}

          {source === "instagram" && (
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-3 md:items-end">
              <div className="space-y-1.5">
                <Label>Modo</Label>
                <Select
                  value={igMode}
                  onValueChange={(v) => setIgMode(v as IgMode)}
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hashtag">Por hashtag</SelectItem>
                    <SelectItem value="location">Por localização</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="igq">
                  {igMode === "hashtag"
                    ? "Hashtag (sem #)"
                    : "Nome do local / cidade"}
                </Label>
                <Input
                  id="igq"
                  placeholder={
                    igMode === "hashtag"
                      ? "Ex: estetica, restaurantebh"
                      : "Ex: Belo Horizonte"
                  }
                  value={igQuery}
                  onChange={(e) => setIgQuery(e.target.value)}
                  disabled={loading}
                />
              </div>
              <Button type="submit" disabled={loading} className="gap-2">
                <Search className="size-4" />
                {loading ? "Buscando..." : "Buscar"}
              </Button>
            </div>
          )}

          {source === "facebook" && (
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-3 md:items-end">
              <div className="space-y-1.5">
                <Label>Modo</Label>
                <Select
                  value={fbMode}
                  onValueChange={(v) => setFbMode(v as FbMode)}
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="page">Página</SelectItem>
                    <SelectItem value="group">Grupo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fbq">
                  {fbMode === "page"
                    ? "URL ou nome da página"
                    : "URL do grupo"}
                </Label>
                <Input
                  id="fbq"
                  placeholder={
                    fbMode === "page"
                      ? "https://facebook.com/suaempresa"
                      : "https://facebook.com/groups/..."
                  }
                  value={fbQuery}
                  onChange={(e) => setFbQuery(e.target.value)}
                  disabled={loading}
                />
              </div>
              <Button type="submit" disabled={loading} className="gap-2">
                <Search className="size-4" />
                {loading ? "Buscando..." : "Buscar"}
              </Button>
            </div>
          )}
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
            <SourceIcon className="size-7" />
          </div>
          <h3 className="font-semibold">Pronto para explorar</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Escolha a fonte, preencha os filtros e descubra novas oportunidades.
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
            Tente outros parâmetros de busca.
          </p>
        </Card>
      )}

      {!loading && results && results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((lead, i) => {
            const added = imported.has(i);
            const Icon =
              lead.source === "instagram"
                ? Instagram
                : lead.source === "facebook"
                  ? Facebook
                  : Building2;
            return (
              <Card key={i} className="p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-sm leading-tight truncate">
                      {lead.name}
                    </h3>
                    {lead.username && (
                      <p className="text-xs text-muted-foreground truncate">
                        @{lead.username}
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5 text-xs text-muted-foreground flex-1">
                  {lead.bio && (
                    <p className="line-clamp-2 italic">{lead.bio}</p>
                  )}
                  {lead.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="size-3.5 shrink-0" />
                      <span className="truncate">{lead.phone}</span>
                    </div>
                  )}
                  {lead.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="size-3.5 shrink-0" />
                      <span className="truncate">{lead.email}</span>
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
                  {!lead.phone && !lead.email && !lead.website && lead.username && (
                    <div className="flex items-center gap-2">
                      <AtSign className="size-3.5 shrink-0" />
                      <span className="truncate">@{lead.username}</span>
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
