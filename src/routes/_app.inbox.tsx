import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Send, Phone, MoreVertical, MessageCircle, Loader2 } from "lucide-react";
import { contactsDb, messagesDb, type Contact, type ChatMessage } from "@/lib/db";
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

function InboxPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lastByContact, setLastByContact] = useState<LastMap>({});
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
        const cs = await contactsDb.list();
        if (cancelled) return;
        setContacts(cs);

        // Busca última msg de cada contato (uma query, ordenada)
        if (c && cs.length > 0) {
          const { data } = await c
            .from("crm_messages")
            .select("id,contact_id,body,from_me,at")
            .in(
              "contact_id",
              cs.map((x) => x.id),
            )
            .order("at", { ascending: false });
          const map: LastMap = {};
          (data ?? []).forEach((row: any) => {
            if (!map[row.contact_id]) {
              map[row.contact_id] = {
                id: row.id,
                contactId: row.contact_id,
                body: row.body,
                fromMe: row.from_me,
                at: row.at,
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
      const msg = await messagesDb.send(activeId, draft.trim());
      setMessages((prev) => [...prev, msg]);
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
        <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] h-[calc(100vh-220px)] min-h-[500px]">
          {/* Lista */}
          <div className="border-r flex flex-col">
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
                  return (
                    <button
                      key={contact.id}
                      onClick={() => setActiveId(contact.id)}
                      className={cn(
                        "w-full text-left flex gap-3 p-3 border-b hover:bg-muted/50 transition",
                        isActive && "bg-primary/5",
                      )}
                    >
                      <div className="size-11 rounded-full bg-primary/10 grid place-items-center text-primary font-semibold shrink-0">
                        {contact.name[0]}
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
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Chat */}
          {active ? (
            <div className="flex flex-col bg-[oklch(0.97_0.01_150)]">
              <div className="h-16 border-b bg-card flex items-center justify-between px-5">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-primary/10 grid place-items-center text-primary font-semibold">
                    {active.name[0]}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{active.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{active.phone}</p>
                  </div>
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
                        "max-w-[75%] rounded-2xl px-4 py-2 text-sm shadow-sm",
                        m.fromMe
                          ? "bg-primary text-primary-foreground ml-auto rounded-br-sm"
                          : "bg-card mr-auto rounded-bl-sm",
                      )}
                    >
                      <p>{m.body}</p>
                      <p
                        className={cn(
                          "text-[10px] mt-1",
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
