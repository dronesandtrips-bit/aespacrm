import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Send, Phone, MoreVertical, MessageCircle, Loader2, PauseCircle, Sparkles, AlertTriangle, FileText, Image as ImageIcon, Tag, Download } from "lucide-react";
import { contactsDb, messagesDb, sequencesDb, categoriesDb, type Contact, type ChatMessage, type Category } from "@/lib/db";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

  // Carrega contatos + última mensagem de cada um
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getSupabaseClient();
        const [cs, cats] = await Promise.all([
          contactsDb.list(),
          categoriesDb.list().catch(() => [] as Category[]),
        ]);
        if (cancelled) return;
        setContacts(cs);
        setCategories(cats);

        // Busca última msg de cada contato (uma query, ordenada)
        if (c && cs.length > 0) {
          // Tenta com colunas de mídia; se falhar, faz fallback
          let rows: any[] = [];
          const full = await c
            .from("crm_messages")
            .select("id,contact_id,body,from_me,at,type,media_url,media_mime,media_caption")
            .in("contact_id", cs.map((x) => x.id))
            .order("at", { ascending: false });
          if (full.error) {
            const fallback = await c
              .from("crm_messages")
              .select("id,contact_id,body,from_me,at")
              .in("contact_id", cs.map((x) => x.id))
              .order("at", { ascending: false });
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
              };
            }
          });
          if (!cancelled) {
            setLastByContact(map);
            // Auto-seleciona a conversa mais recente
            const sorted = cs
              .filter((x) => map[x.id])
              .sort((a, b) => map[b.id]!.at.localeCompare(map[a.id]!.at));
            if (sorted.length > 0) setActiveId(sorted[0].id);
            else if (cs.length > 0) setActiveId(cs[0].id);
          }
        }
      } catch (e: any) {
        toast.error(`Erro ao carregar inbox: ${e.message ?? e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Realtime: escuta novas mensagens do usuário
  useEffect(() => {
    let channel: any;
    (async () => {
      const c = await getSupabaseClient();
      if (!c) return;
      channel = c
        .channel("crm_messages_inbox")
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
          },
        )
        .subscribe();
    })();
    return () => {
      if (channel) {
        (async () => {
          const c = await getSupabaseClient();
          c?.removeChannel(channel);
        })();
      }
    };
  }, [activeId]);

  // Realtime: escuta mudanças em contact_sequences para atualizar o badge de pausa
  useEffect(() => {
    let channel: any;
    (async () => {
      const c = await getSupabaseClient();
      if (!c) return;
      const seqs = await sequencesDb.list().catch(() => []);
      const seqName: Record<string, string> = {};
      seqs.forEach((s) => (seqName[s.id] = s.name));

      channel = c
        .channel("crm_contact_sequences_inbox")
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
              // saiu do estado paused-by-reply → limpa
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
      if (channel) {
        (async () => {
          const c = await getSupabaseClient();
          c?.removeChannel(channel);
        })();
      }
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
                          <p className="font-medium text-sm truncate">{contact.name}</p>
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
                    <p className="font-medium text-sm">{active.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{active.phone}</p>
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
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon">
                    <Phone className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="size-4" />
                  </Button>
                </div>
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
          <div className="hidden md:flex flex-col border-l bg-card/50">
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total de contatos", value: contacts.length.toString() },
          { label: "Conversas ativas", value: activeCount.toString() },
          { label: "Mensagens nesta conversa", value: messages.length.toString() },
          {
            label: "Você enviou",
            value: messages.filter((m) => m.fromMe).length.toString(),
          },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-xl font-bold mt-1">{s.value}</p>
          </Card>
        ))}
      </div>
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
