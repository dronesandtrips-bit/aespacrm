import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Send, MessageCircle, Loader2, PauseCircle, Sparkles, AlertTriangle, FileText, Image as ImageIcon, Tag, Download, Pencil, Trash2, GitBranch, ShieldOff, ShieldCheck } from "lucide-react";
import { contactsDb, messagesDb, sequencesDb, categoriesDb, userSettingsDb, ignoredPhonesDb, type Contact, type ChatMessage, type Category, type Sequence } from "@/lib/db";
import { getSupabaseClient, getSupabaseClientSync } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { ContactDialog, EnrollDialog } from "@/components/contact-dialogs";


export const Route = createFileRoute("/_app/inbox")({
  component: InboxPage,
});

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type LastMap = Record<string, ChatMessage | undefined>;
type ReplyPause = {
  contactId: string;
  sequenceId: string;
  sequenceName: string;
  pausedAt: string;
};
type PauseMap = Record<string, ReplyPause | undefined>;

function InboxPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lastByContact, setLastByContact] = useState<LastMap>({});
  const [replyPauseByContact, setReplyPauseByContact] = useState<PauseMap>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef("");
  

  // Ações sobre o contato ativo (espelho dos botões da aba Contatos)
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const [togglingIgnore, setTogglingIgnore] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [enrollContact, setEnrollContact] = useState<Contact | null>(null);

  useEffect(() => {
    sequencesDb.list().then(setSequences).catch(() => {});
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const loadLastMessages = useCallback(async () => {
    const c = await getSupabaseClient();
    if (!c) return {} as LastMap;

    let rows: any[] = [];
    const full = await c
      .from("crm_messages")
      .select("id,contact_id,body,from_me,at,type,media_url,media_mime,media_caption,status")
      .order("at", { ascending: false })
      .limit(1000);

    if (full.error) {
      const fallback = await c
        .from("crm_messages")
        .select("id,contact_id,body,from_me,at")
        .order("at", { ascending: false })
        .limit(1000);
      rows = fallback.data ?? [];
    } else {
      rows = full.data ?? [];
    }

    const map: LastMap = {};
    rows.forEach((row: any) => {
      if (!map[row.contact_id]) {
        map[row.contact_id] = {
          id: row.id,
          contactId: row.contact_id,
          body: row.body,
          fromMe: row.from_me,
          at: row.at,
          type: row.type ?? "text",
          mediaUrl: row.media_url ?? null,
          mediaMime: row.media_mime ?? null,
          mediaCaption: row.media_caption ?? null,
          status: row.status ?? null,
        };
      }
    });
    return map;
  }, []);

  const refreshInbox = useCallback(async (options?: { initial?: boolean }) => {
    const [cs, cats] = await Promise.all([
      contactsDb.listAll(),
      categoriesDb.list().catch(() => [] as Category[]),
    ]);
    const lastMap = await loadLastMessages();

    setContacts(cs);
    setCategories(cats);
    setLastByContact(lastMap);

    if (options?.initial || !activeIdRef.current) {
      const sorted = cs
        .filter((x) => lastMap[x.id])
        .sort((a, b) => lastMap[b.id]!.at.localeCompare(lastMap[a.id]!.at));
      setActiveId(sorted[0]?.id ?? cs[0]?.id ?? "");
    }
  }, [loadLastMessages]);

  const refreshContacts = async () => {
    try {
      await refreshInbox();
    } catch (e: any) {
      toast.error(`Erro ao recarregar: ${e.message ?? e}`);
    }
  };

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
    let logId: string | null = null;
    const requestPayload = {
      action: "enrich_contact",
      contact_id: c.id,
      phone: c.phone,
      triggered_at: new Date().toISOString(),
    };
    try {
      try {
        const { logEnrichmentStart } = await import("@/server/ai-enrichment-logs.functions");
        const r = await logEnrichmentStart({
          data: {
            contact_id: c.id,
            contact_name: c.name,
            contact_phone: c.phone,
            request_payload: requestPayload,
          },
        });
        logId = r.log_id;
      } catch (e) {
        console.warn("Falha ao registrar log de enriquecimento", e);
      }
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestPayload, log_id: logId }),
      });
      if (!res.ok) {
        toast.error(`Webhook respondeu ${res.status}`);
        if (logId) {
          try {
            const { logEnrichmentFailure } = await import("@/server/ai-enrichment-logs.functions");
            await logEnrichmentFailure({ data: { log_id: logId, error_message: `Webhook ${res.status}` } });
          } catch {}
        }
        return;
      }
      toast.success(`Enriquecimento disparado para ${c.name}. Atualizando em 8s…`);
      setTimeout(() => { refreshContacts(); }, 8000);
    } catch (e: any) {
      toast.error(`Falha ao chamar webhook: ${e.message ?? e}`);
      if (logId) {
        try {
          const { logEnrichmentFailure } = await import("@/server/ai-enrichment-logs.functions");
          await logEnrichmentFailure({ data: { log_id: logId, error_message: String(e?.message ?? e) } });
        } catch {}
      }
    } finally {
      setEnriching((prev) => {
        const n = new Set(prev);
        n.delete(c.id);
        return n;
      });
    }
  };

  const handleToggleIgnore = async (c: Contact) => {
    if (togglingIgnore.has(c.id)) return;
    setTogglingIgnore((prev) => new Set(prev).add(c.id));
    try {
      if (c.isIgnored) {
        await ignoredPhonesDb.removeByPhone(c.phone);
        toast.success(`${c.name} removido da blacklist`);
      } else {
        await ignoredPhonesDb.addOne(c.phone, "manual:whatsweb");
        toast.success(`${c.name} adicionado à blacklist`);
      }
      await refreshContacts();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setTogglingIgnore((prev) => {
        const n = new Set(prev);
        n.delete(c.id);
        return n;
      });
    }
  };

  const handleSaveContact = async (data: Omit<Contact, "id" | "createdAt">) => {
    if (!active) return;
    try {
      await contactsDb.update(active.id, data);
      toast.success("Contato atualizado");
      await refreshContacts();
      setEditOpen(false);
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const handleDeleteContact = async (c: Contact) => {
    if (!confirm(`Remover o contato ${c.name}? Mensagens e sequências vinculadas também serão apagadas.`)) return;
    try {
      await contactsDb.remove(c.id);
      toast.success("Contato removido");
      const remaining = contacts.filter((x) => x.id !== c.id);
      setContacts(remaining);
      setActiveId(remaining[0]?.id ?? "");
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };


  // Carrega contatos + última mensagem de cada um
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        await refreshInbox({ initial: true });
      } catch (e: any) {
        toast.error(`Erro ao carregar inbox: ${e.message ?? e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshInbox]);

  // Fallback: se o Realtime do servidor não entregar evento, sincroniza a lista
  // periodicamente para manter o WhatsWeb atualizado sem precisar clicar em atualizar.
  useEffect(() => {
    if (loading) return;
    const id = window.setInterval(() => {
      refreshInbox().catch((e: any) => console.warn("Falha ao sincronizar inbox", e));
    }, 5000);
    return () => window.clearInterval(id);
  }, [loading, refreshInbox]);

  // Carrega sequências pausadas por resposta do lead (badge no Inbox)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getSupabaseClient();
        if (!c) return;
        const [{ data: pauses, error: pErr }, seqs] = await Promise.all([
          c
            .from("crm_contact_sequences")
            .select("contact_id,sequence_id,paused_at")
            .eq("status", "paused")
            .eq("pause_reason", "inbound_reply"),
          sequencesDb.list(),
        ]);
        if (pErr) throw pErr;
        const seqName: Record<string, string> = {};
        seqs.forEach((s) => (seqName[s.id] = s.name));
        const map: PauseMap = {};
        (pauses ?? []).forEach((p: any) => {
          const existing = map[p.contact_id];
          if (!existing || (p.paused_at ?? "") > (existing.pausedAt ?? "")) {
            map[p.contact_id] = {
              contactId: p.contact_id,
              sequenceId: p.sequence_id,
              sequenceName: seqName[p.sequence_id] ?? "Sequência",
              pausedAt: p.paused_at,
            };
          }
        });
        if (!cancelled) setReplyPauseByContact(map);
      } catch (e: any) {
        console.warn("Falha ao carregar pausas por resposta", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Carrega mensagens da conversa ativa
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await messagesDb.list(activeId);
        if (!cancelled) setMessages(list);
      } catch (e: any) {
        if (!cancelled) toast.error(`Erro: ${e.message ?? e}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Realtime: escuta novas mensagens (e dispara refresh de contatos quando o
  // contact_id ainda não está na lista — caso de conversa nova).
  useEffect(() => {
    let channel: any;
    let cancelled = false;
    let refreshTimer: number | null = null;
    const channelName = `crm_messages_inbox_${Math.random().toString(36).slice(2)}`;
    (async () => {
      const c = await getSupabaseClient();
      if (!c || cancelled) return;
      channel = c
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "aespacrm", table: "crm_messages" },
          (payload: any) => {
            const row = payload.new;
            const msg: ChatMessage = {
              id: row.id,
              contactId: row.contact_id,
              body: row.body,
              fromMe: row.from_me,
              at: row.at,
              type: (row.type ?? "text") as ChatMessage["type"],
              mediaUrl: row.media_url ?? null,
              mediaMime: row.media_mime ?? null,
              mediaCaption: row.media_caption ?? null,
              status: row.status ?? null,
            };
            setLastByContact((prev) => ({ ...prev, [msg.contactId]: msg }));
            if (msg.contactId === activeId) {
              setMessages((prev) =>
                prev.find((m) => m.id === msg.id) ? prev : [...prev, msg],
              );
            }
            // Se o contato ainda não está na lista, recarrega contatos.
            setContacts((prev) => {
              if (prev.some((x) => x.id === msg.contactId)) return prev;
              if (refreshTimer == null) {
                refreshTimer = window.setTimeout(() => {
                  refreshTimer = null;
                  refreshContacts();
                }, 500);
              }
              return prev;
            });
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "aespacrm", table: "crm_contacts" },
          () => {
            if (refreshTimer == null) {
              refreshTimer = window.setTimeout(() => {
                refreshTimer = null;
                refreshContacts();
              }, 500);
            }
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      const c = getSupabaseClientSync();
      if (c && channel) c.removeChannel(channel);
    };
  }, [activeId]);

  // Realtime: escuta mudanças em contact_sequences para atualizar o badge de pausa
  useEffect(() => {
    let channel: any;
    let cancelled = false;
    const channelName = `crm_contact_sequences_inbox_${Math.random().toString(36).slice(2)}`;
    (async () => {
      const c = await getSupabaseClient();
      if (!c || cancelled) return;
      const seqs = await sequencesDb.list().catch(() => []);
      const seqName: Record<string, string> = {};
      seqs.forEach((s) => (seqName[s.id] = s.name));

      channel = c
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "*", schema: "aespacrm", table: "crm_contact_sequences" },
          (payload: any) => {
            const row = payload.new ?? payload.old;
            if (!row?.contact_id) return;
            const isReplyPause =
              payload.new?.status === "paused" &&
              payload.new?.pause_reason === "inbound_reply";
            if (isReplyPause) {
              setReplyPauseByContact((prev) => ({
                ...prev,
                [row.contact_id]: {
                  contactId: row.contact_id,
                  sequenceId: row.sequence_id,
                  sequenceName: seqName[row.sequence_id] ?? "Sequência",
                  pausedAt: payload.new.paused_at ?? new Date().toISOString(),
                },
              }));
            } else {
              setReplyPauseByContact((prev) => {
                const cur = prev[row.contact_id];
                if (!cur || cur.sequenceId !== row.sequence_id) return prev;
                const next = { ...prev };
                delete next[row.contact_id];
                return next;
              });
            }
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      const c = getSupabaseClientSync();
      if (c && channel) c.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const conversations = useMemo(
    () =>
      contacts
        .map((c) => ({ contact: c, last: lastByContact[c.id] }))
        .sort((a, b) => {
          const aAt = a.last?.at ?? "";
          const bAt = b.last?.at ?? "";
          return bAt.localeCompare(aAt);
        }),
    [contacts, lastByContact],
  );

  const filtered = conversations.filter((x) =>
    x.contact.name.toLowerCase().includes(search.toLowerCase()),
  );

  const active = contacts.find((c) => c.id === activeId);

  const handleSend = async () => {
    if (!draft.trim() || !activeId) return;
    setSending(true);
    try {
      const c = await getSupabaseClient();
      const { data: sess } = (await c?.auth.getSession()) ?? { data: { session: null } };
      const token = sess?.session?.access_token;
      if (!token) throw new Error("sessão expirada — faça login novamente");

      const res = await fetch("/api/public/evolution/send-and-log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ contactId: activeId, text: draft.trim() }),
      });
      const rawBody = await res.text();
      let data: any = null;
      try { data = JSON.parse(rawBody); } catch {}
      if (!res.ok || !data?.ok) {
        const errMsg =
          (data && (typeof data.error === "string" ? data.error : data.error && JSON.stringify(data.error))) ||
          rawBody ||
          `HTTP ${res.status}`;
        const detail = data?.detail ? ` (${data.detail})` : "";
        throw new Error(`${errMsg}${detail}`);
      }
      const msg: ChatMessage = data.message;
      setMessages((prev) => (prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setLastByContact((prev) => ({ ...prev, [activeId]: msg }));
      setDraft("");
    } catch (e: any) {
      toast.error(`Erro ao enviar: ${e.message ?? e}`);
    } finally {
      setSending(false);
    }
  };

  const activeCount = conversations.filter((c) => c.last).length;

  return (
    <div className="space-y-4 max-w-[1400px]">
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr_260px] h-[calc(100vh-180px)] min-h-[600px]">
          {/* Lista */}
          <div className="border-r flex flex-col min-h-0 h-full overflow-hidden">
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar conversa..."
                  className="pl-9"
                />
              </div>
            </div>
            <div className="overflow-auto flex-1">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Loader2 className="size-5 mx-auto animate-spin opacity-60" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Nenhuma conversa
                </div>
              ) : (
                filtered.map(({ contact, last }) => {
                  const isActive = contact.id === activeId;
                  const pause = replyPauseByContact[contact.id];
                  return (
                    <button
                      key={contact.id}
                      onClick={() => setActiveId(contact.id)}
                      className={cn(
                        "w-full text-left flex gap-3 p-3 border-b hover:bg-muted/50 transition",
                        isActive && "bg-primary/5",
                      )}
                    >
                      <div className="relative shrink-0">
                        <div className="size-11 rounded-full bg-primary/10 grid place-items-center text-primary font-semibold">
                          {contact.name[0]}
                        </div>
                        {pause && (
                          <span
                            className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-amber-500 border-2 border-card grid place-items-center"
                            title={`Sequência pausada: ${pause.sequenceName}`}
                          >
                            <PauseCircle className="size-2.5 text-white" />
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline gap-2">
                          <p className="font-medium text-sm truncate flex items-center gap-1.5">
                            {contact.name}
                            {contact.isGroup && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 leading-tight">
                                Grupo
                              </Badge>
                            )}
                          </p>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {last && timeAgo(last.at)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {last?.fromMe && "Você: "}
                          {last?.body ?? <span className="italic opacity-60">Sem mensagens</span>}
                        </p>
                        {pause && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5 truncate">
                            ⏸ {pause.sequenceName} pausada · respondeu há {timeAgo(pause.pausedAt)}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Chat */}
          {active ? (
            <div className="flex flex-col bg-[oklch(0.97_0.01_150)] min-h-0 h-full overflow-hidden">
              <div className="h-16 border-b bg-card flex items-center justify-between px-5">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-primary/10 grid place-items-center text-primary font-semibold">
                    {active.name[0]}
                  </div>
                  <div>
                    <p className="font-medium text-sm flex items-center gap-2">
                      {active.name}
                      {active.isGroup && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Grupo</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {active.isGroup ? "Conversa em grupo" : active.phone}
                    </p>
                  </div>
                  {active && replyPauseByContact[active.id] && (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 cursor-help"
                          >
                            <PauseCircle className="size-3" />
                            Sequência pausada
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p className="text-xs">
                            <strong>{replyPauseByContact[active.id]!.sequenceName}</strong> pausada
                            <br />
                            Lead respondeu há {timeAgo(replyPauseByContact[active.id]!.pausedAt)}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>

                {/* Ações sobre o contato (espelho da aba Contatos) */}
                <TooltipProvider delayDuration={150}>
                  <div className="flex items-center gap-1">
                    {!active.isGroup && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={enriching.has(active.id)}
                              onClick={() => handleEnrich(active)}
                            >
                              {enriching.has(active.id) ? (
                                <Loader2 className="size-4 animate-spin text-primary" />
                              ) : (
                                <Sparkles className="size-4 text-primary" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Enriquecer com IA</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEnrollContact(active)}
                            >
                              <GitBranch className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Adicionar a uma sequência</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={togglingIgnore.has(active.id)}
                              onClick={() => handleToggleIgnore(active)}
                            >
                              {togglingIgnore.has(active.id) ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : active.isIgnored ? (
                                <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <ShieldOff className="size-4 text-amber-600 dark:text-amber-400" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {active.isIgnored ? "Restaurar (remover da blacklist)" : "Ignorar (blacklist)"}
                          </TooltipContent>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)}>
                          <Pencil className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Editar contato</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteContact(active)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Excluir contato</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </div>


              <div ref={scrollRef} className="flex-1 overflow-auto p-5 space-y-2">
                {messages.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-10">
                    Nenhuma mensagem ainda. Envie a primeira!
                  </div>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                        m.fromMe
                          ? "bg-primary text-primary-foreground ml-auto rounded-br-sm"
                          : "bg-card mr-auto rounded-bl-sm",
                      )}
                    >
                      <MessageContent m={m} />
                      <p
                        className={cn(
                          "text-[10px] mt-1 text-right",
                          m.fromMe ? "text-primary-foreground/70" : "text-muted-foreground",
                        )}
                      >
                        {new Date(m.at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="p-3 border-t bg-card flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !sending && handleSend()}
                  placeholder="Digite uma mensagem..."
                  disabled={sending}
                />
                <Button onClick={handleSend} disabled={!draft.trim() || sending}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="size-12 mx-auto opacity-30 mb-2" />
                <p className="text-sm">
                  {loading ? "Carregando..." : "Selecione uma conversa"}
                </p>
              </div>
            </div>
          )}

          {/* Painel IA — contexto do contato */}
          <div className="hidden md:flex flex-col border-l bg-card/50 min-h-0 h-full overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h4 className="text-sm font-semibold">Contexto da IA</h4>
            </div>
            <div className="p-4 space-y-4 overflow-auto flex-1">
              {!active ? (
                <p className="text-xs text-muted-foreground">
                  Selecione um contato para ver a análise de persona.
                </p>
              ) : (
                <>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                      <Tag className="size-3" /> Tags
                    </p>
                    <ContactTags contact={active} categories={categories} />
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                      Urgência
                    </p>
                    {active.urgencyLevel ? (
                      <UrgencyBadge level={active.urgencyLevel} />
                    ) : (
                      <span className="text-xs text-muted-foreground italic">
                        Aguardando análise da IA
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                      Resumo de persona
                    </p>
                    {active.aiPersonaSummary ? (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {active.aiPersonaSummary}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Aguardando análise da IA
                      </p>
                    )}
                  </div>
                  {active.lastAiSync && (
                    <p className="text-[10px] text-muted-foreground pt-2 border-t">
                      Última análise: {new Date(active.lastAiSync).toLocaleString("pt-BR")}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Dialog: editar contato ativo */}
      <Dialog
        open={editOpen}
        onOpenChange={(v) => setEditOpen(v)}
      >
        {active && (
          <ContactDialog
            key={active.id}
            initial={active}
            categories={categories}
            onSubmit={handleSaveContact}
          />
        )}
      </Dialog>

      {/* Dialog: inscrever em sequência */}
      <EnrollDialog
        contact={enrollContact}
        sequences={sequences}
        onClose={() => setEnrollContact(null)}
      />
    </div>
  );
}

function UrgencyBadge({ level }: { level: "Baixa" | "Média" | "Alta" }) {
  const cls =
    level === "Alta"
      ? "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
      : level === "Média"
        ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  return (
    <Badge variant="outline" className={cn("gap-1", cls)}>
      <AlertTriangle className="size-3" />
      {level}
    </Badge>
  );
}

function ContactTags({ contact, categories }: { contact: Contact; categories: Category[] }) {
  const ids = contact.categoryIds && contact.categoryIds.length
    ? contact.categoryIds
    : contact.categoryId
      ? [contact.categoryId]
      : [];
  if (ids.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Sem tags</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const cat = categories.find((c) => c.id === id);
        if (!cat) return null;
        return (
          <Badge
            key={id}
            variant="outline"
            className="text-[11px] gap-1"
            style={{ borderColor: `${cat.color}80`, backgroundColor: `${cat.color}15`, color: cat.color }}
          >
            {cat.name}
          </Badge>
        );
      })}
    </div>
  );
}

function MessageContent({ m }: { m: ChatMessage }) {
  const type = m.type ?? "text";
  const caption = m.mediaCaption ?? m.body;

  if (type === "image" && m.mediaUrl) {
    return (
      <div className="space-y-1.5">
        <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="block">
          <img
            src={m.mediaUrl}
            alt={caption || "imagem"}
            className="rounded-lg max-w-full max-h-72 object-contain bg-black/5"
            loading="lazy"
          />
        </a>
        {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
      </div>
    );
  }

  if (type === "video" && m.mediaUrl) {
    return (
      <div className="space-y-1.5">
        <video
          src={m.mediaUrl}
          controls
          className="rounded-lg max-w-full max-h-72 bg-black"
          preload="metadata"
        />
        {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
      </div>
    );
  }

  if (type === "audio" && m.mediaUrl) {
    return (
      <div className="space-y-1.5 min-w-[220px]">
        <audio src={m.mediaUrl} controls className="w-full max-w-xs" preload="metadata" />
        {caption && caption !== m.body ? (
          <p className="whitespace-pre-wrap break-words">{caption}</p>
        ) : null}
      </div>
    );
  }

  if (type === "document" && m.mediaUrl) {
    const fileName = caption || m.mediaUrl.split("/").pop() || "documento";
    return (
      <a
        href={m.mediaUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 p-2 rounded-lg bg-black/5 hover:bg-black/10 transition"
      >
        <FileText className="size-5 shrink-0" />
        <span className="flex-1 text-xs truncate">{fileName}</span>
        <Download className="size-4 opacity-60" />
      </a>
    );
  }

  if (type === "sticker" && m.mediaUrl) {
    return <img src={m.mediaUrl} alt="sticker" className="size-32 object-contain" />;
  }

  if ((type === "image" || type === "video" || type === "audio" || type === "document") && !m.mediaUrl) {
    return (
      <p className="italic opacity-70 flex items-center gap-1.5">
        <ImageIcon className="size-3.5" />
        Mídia indisponível
      </p>
    );
  }

  return <p className="whitespace-pre-wrap break-words">{m.body}</p>;
}
