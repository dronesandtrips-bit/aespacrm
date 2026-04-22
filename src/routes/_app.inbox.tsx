import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Send, Phone, MoreVertical, MessageCircle } from "lucide-react";
import { db, type Contact, type ChatMessage } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

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

function InboxPage() {
  const contacts = useMemo<Contact[]>(() => db.listContacts(), []);
  const conversations = useMemo(
    () =>
      contacts
        .map((c) => ({ contact: c, last: db.lastMessage(c.id) }))
        .filter((x) => x.last)
        .sort((a, b) => (b.last!.at).localeCompare(a.last!.at)),
    [contacts],
  );

  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string>(conversations[0]?.contact.id ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    activeId ? db.listMessages(activeId) : [],
  );
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(activeId ? db.listMessages(activeId) : []);
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const filtered = conversations.filter((x) =>
    x.contact.name.toLowerCase().includes(search.toLowerCase()),
  );

  const active = contacts.find((c) => c.id === activeId);

  const handleSend = () => {
    if (!draft.trim() || !activeId) return;
    db.sendMessage(activeId, draft.trim());
    setMessages(db.listMessages(activeId));
    setDraft("");
  };

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
              {filtered.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Nenhuma conversa
                </div>
              )}
              {filtered.map(({ contact, last }) => {
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
                        {last?.body}
                      </p>
                    </div>
                  </button>
                );
              })}
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
                    <p className="text-xs text-muted-foreground font-mono">
                      {active.phone}
                    </p>
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
                {messages.map((m) => (
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
                ))}
              </div>

              <div className="p-3 border-t bg-card flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Digite uma mensagem..."
                />
                <Button onClick={handleSend} disabled={!draft.trim()}>
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="size-12 mx-auto opacity-30 mb-2" />
                <p className="text-sm">Selecione uma conversa</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Tempo médio resposta", value: "4m 12s" },
          { label: "Mensagens hoje", value: "1.320" },
          { label: "Conversas ativas", value: conversations.length.toString() },
          { label: "Não lidas", value: "3" },
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
