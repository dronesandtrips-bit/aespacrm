import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState, useEffect, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Send, MessageCircle, Loader2, PauseCircle, Sparkles, AlertTriangle, FileText, Image as ImageIcon, Tag, TagIcon, FolderPlus, Download, Pencil, Trash2, GitBranch, ShieldOff, ShieldCheck, Check, CheckCheck, Bot, Bell, BellOff, Filter, Users as UsersIcon, RefreshCw, Smile, Paperclip, Mic, X, Forward, ChevronDown, Reply, Copy, MapPin, User } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { contactsDb, messagesDb, sequencesDb, categoriesDb, userSettingsDb, ignoredPhonesDb, type Contact, type ChatMessage, type Category, type Sequence } from "@/lib/db";
import { activateNotifications, isSoundEnabled, notifyIncomingMessage, setBrowserNotificationsEnabled, setSoundEnabled } from "@/lib/notification-sound";
import { getSupabaseClient, getSupabaseClientSync } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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

function isDeliveredStatus(status: string) {
  return ["2", "3", "4", "5", "server_ack", "delivery_ack", "delivered", "read", "read_ack", "played", "played_ack"].includes(status);
}

function isReadStatus(status: string) {
  return ["4", "5", "read", "read_ack", "played", "played_ack"].includes(status);
}

async function getFreshAccessToken(forceRefresh = false) {
  const c = await getSupabaseClient();
  if (!c) throw new Error("Supabase indisponível");

  let { data: { session } } = await c.auth.getSession();
  const expiresAt = session?.expires_at ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);

  if (forceRefresh || !session || expiresAt - nowSec < 120) {
    const refreshed = await c.auth.refreshSession();
    if (refreshed.data.session) session = refreshed.data.session;
  }

  const token = session?.access_token;
  if (!token) throw new Error("sessão expirada — faça login novamente");
  return token;
}

async function fetchWithAuthRetry(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await getFreshAccessToken()}`);

  const first = await fetch(input, { ...init, headers });
  if (first.status !== 401) return first;

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${await getFreshAccessToken(true)}`);
  return fetch(input, { ...init, headers: retryHeaders });
}

function InboxPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lastByContact, setLastByContact] = useState<LastMap>({});
  const [replyPauseByContact, setReplyPauseByContact] = useState<PauseMap>({});
  // Estado de "não lidas" por conversa — calculado contra crm_contacts.last_read_at
  const [unreadByContact, setUnreadByContact] = useState<Record<string, number>>({});
  const [lastReadByContact, setLastReadByContact] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [soundOn, setSoundOn] = useState<boolean>(true);
  useEffect(() => { setSoundOn(isSoundEnabled()); }, []);

  const [search, setSearch] = useState("");
  // Chips de filtro estilo WhatsApp Web
  const [chipFilter, setChipFilter] = useState<"all" | "unread" | "groups">("all");
  const [chipCategoryId, setChipCategoryId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{ file: File; previewUrl: string | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef("");
  const contactsRef = useRef<Contact[]>([]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);
  

  // Ações sobre o contato ativo (espelho dos botões da aba Contatos)
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const [togglingIgnore, setTogglingIgnore] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [enrollContact, setEnrollContact] = useState<Contact | null>(null);
  // Viewer de imagem (lightbox) + dialog de encaminhar
  const [viewer, setViewer] = useState<{ messageId: string; src: string; alt: string } | null>(null);
  const [forwardMessageId, setForwardMessageId] = useState<string | null>(null);
  // Reply (responder) — mensagem em rascunho citada
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // Estado REAL do bot do Robo (ZapBot) para o contato ativo. null = desconhecido/loading.
  const [botPausedActive, setBotPausedActive] = useState<boolean | null>(null);
  const [botPausedLoading, setBotPausedLoading] = useState(false);
  const activePhoneRef = useRef<string>("");
  const botPausedAbortRef = useRef<AbortController | null>(null);
  const refetchBotPaused = useCallback(async () => {
    const phone = activePhoneRef.current;
    if (!phone) return;
    botPausedAbortRef.current?.abort();
    const controller = new AbortController();
    botPausedAbortRef.current = controller;
    setBotPausedLoading(true);
    try {
      const res = await fetch(`https://robo.aespa.com.br/api/public/contacts/bot-paused?phone=${phone}`, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (activePhoneRef.current !== phone) return;
      setBotPausedActive(typeof data?.paused === "boolean" ? data.paused : null);
    } catch (error: any) {
      if (error?.name !== "AbortError") setBotPausedActive(null);
    } finally {
      if (botPausedAbortRef.current === controller) {
        botPausedAbortRef.current = null;
        setBotPausedLoading(false);
      }
    }
  }, []);

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
      .select("id,contact_id,body,from_me,at,type,media_url,media_mime,media_caption,status,message_id")
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
          messageId: row.message_id ?? null,
        };
      }
    });
    return map;
  }, []);

  // Carrega contagem de não lidas + last_read_at. Tolerante a falhas:
  // se a coluna ainda não existir (schema cache), devolve maps vazios.
  const loadUnreadState = useCallback(async () => {
    const c = await getSupabaseClient();
    if (!c) return { unread: {} as Record<string, number>, lastRead: {} as Record<string, string | null> };
    const [{ data: cts, error: ctsErr }, { data: msgs }] = await Promise.all([
      c.from("crm_contacts").select("id,last_read_at"),
      c
        .from("crm_messages")
        .select("contact_id,at,from_me")
        .eq("from_me", false)
        .order("at", { ascending: false })
        .limit(2000),
    ]);
    const lastRead: Record<string, string | null> = {};
    if (!ctsErr) (cts ?? []).forEach((r: any) => { lastRead[r.id] = r.last_read_at ?? null; });
    const unread: Record<string, number> = {};
    (msgs ?? []).forEach((m: any) => {
      const lr = lastRead[m.contact_id];
      if (!lr || m.at > lr) unread[m.contact_id] = (unread[m.contact_id] ?? 0) + 1;
    });
    return { unread, lastRead };
  }, []);

  const refreshInbox = useCallback(async (options?: { initial?: boolean }) => {
    const [cs, cats] = await Promise.all([
      contactsDb.listAll(),
      categoriesDb.list().catch(() => [] as Category[]),
    ]);
    const [lastMap, unreadState] = await Promise.all([
      loadLastMessages(),
      loadUnreadState().catch(() => ({ unread: {}, lastRead: {} })),
    ]);

    setContacts(cs);
    setCategories(cats);
    setLastByContact(lastMap);
    setUnreadByContact(unreadState.unread);
    setLastReadByContact(unreadState.lastRead);

    if (options?.initial || !activeIdRef.current) {
      const sorted = cs
        .filter((x) => lastMap[x.id])
        .sort((a, b) => lastMap[b.id]!.at.localeCompare(lastMap[a.id]!.at));
      setActiveId(sorted[0]?.id ?? cs[0]?.id ?? "");
    }
  }, [loadLastMessages, loadUnreadState]);

  const refreshContacts = async () => {
    try {
      await refreshInbox();
    } catch (e: any) {
      toast.error(`Erro ao recarregar: ${e.message ?? e}`);
    }
  };

  const [syncing, setSyncing] = useState(false);
  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    const t = toast.loading("Sincronizando mensagens recentes…");
    try {
      const c = await getSupabaseClient();
      const { data: sess } = (await c?.auth.getSession()) ?? { data: { session: null } };
      const token = sess?.session?.access_token;
      if (!token) throw new Error("sessão expirada — faça login novamente");
      const res = await fetch("/api/public/evolution/sync-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ days: 3 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.ok === false) {
        throw new Error(j?.error || j?.detail || `HTTP ${res.status}`);
      }
      await refreshInbox();
      toast.success(
        `Sincronizado: ${j.messagesImported ?? 0} mensagens em ${j.contactsWithMessages ?? 0} conversas`,
        { id: t },
      );
    } catch (e: any) {
      toast.error(`Falha na sincronização: ${e.message ?? e}`, { id: t });
    } finally {
      setSyncing(false);
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
      const turningOff = !c.isIgnored; // se vai bloquear, manda "/off"; se vai liberar, manda "/on"
      const command = turningOff ? "/off" : "/on";

      // 1) Dispara o comando no chat do contato (mesma instância do Robo).
      //    O Robo escuta fromMe e pausa/retoma. Se falhar, abortamos para não
      //    deixar a blacklist dessincronizada do estado real do Robo.
      const phoneDigits = c.phone.replace(/\D/g, "");
      const sendRes = await fetchWithAuthRetry("/api/public/evolution/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ number: phoneDigits, text: command }),
      });
      const sendJson = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok || sendJson?.ok === false) {
        throw new Error(
          `Falha ao enviar "${command}" via WhatsApp: ${sendJson?.error ?? sendRes.statusText}`
        );
      }

      // 2) Sincroniza a blacklist local (espelho do estado do Robo).
      if (c.isIgnored) {
        await ignoredPhonesDb.removeByPhone(c.phone);
        toast.success(`${c.name}: comando "/on" enviado e removido da blacklist`);
      } else {
        await ignoredPhonesDb.addOne(c.phone, "manual:whatsweb");
        toast.success(`${c.name}: comando "/off" enviado e adicionado à blacklist`);
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

  const handleToggleCategory = async (c: Contact, categoryId: string) => {
    try {
      const current = c.categoryIds ?? [];
      const next = current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId];
      await contactsDb.update(c.id, { categoryIds: next });
      const cat = categories.find((x) => x.id === categoryId);
      toast.success(
        next.includes(categoryId)
          ? `Adicionado a "${cat?.name ?? "categoria"}"`
          : `Removido de "${cat?.name ?? "categoria"}"`
      );
      await refreshContacts();
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
      setReplyTo(null);
      return;
    }
    setReplyTo(null);
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

  // Marca conversa como lida ao abrir: zera badge local e atualiza last_read_at.
  // Tolerante a erro (se a coluna ainda não existir, segue silencioso).
  useEffect(() => {
    if (!activeId) return;
    const now = new Date().toISOString();
    setUnreadByContact((prev) => (prev[activeId] ? { ...prev, [activeId]: 0 } : prev));
    setLastReadByContact((prev) => ({ ...prev, [activeId]: now }));
    (async () => {
      try {
        const c = await getSupabaseClient();
        if (!c) return;
        await c.from("crm_contacts").update({ last_read_at: now }).eq("id", activeId);
      } catch (e) {
        console.warn("Falha ao marcar conversa como lida", e);
      }
    })();
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
              messageId: row.message_id ?? null,
            };
            setLastByContact((prev) => ({ ...prev, [msg.contactId]: msg }));
            // Atualiza contagem de não lidas: só conta mensagens recebidas
            // que não pertencem à conversa atualmente aberta.
            if (!msg.fromMe && msg.contactId !== activeId) {
              setUnreadByContact((prev) => ({
                ...prev,
                [msg.contactId]: (prev[msg.contactId] ?? 0) + 1,
              }));
            }
            if (msg.contactId === activeId) {
              setMessages((prev) =>
                prev.find((m) => m.id === msg.id) ? prev : [...prev, msg],
              );
            }
            // 🔔 Notificação para mensagens recebidas (ignora grupos e fromMe)
            const sender = contactsRef.current.find((x) => x.id === msg.contactId);
            notifyIncomingMessage({
              id: msg.id,
              messageId: msg.messageId,
              contactId: msg.contactId,
              contactName: sender?.name,
              body: msg.body,
              fromMe: msg.fromMe,
              isGroup: sender?.isGroup,
              at: msg.at,
            });
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
          { event: "UPDATE", schema: "aespacrm", table: "crm_messages" },
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
              messageId: row.message_id ?? null,
            };
            setLastByContact((prev) => ({ ...prev, [msg.contactId]: msg }));
            if (msg.contactId === activeId) {
              setMessages((prev) => prev.map((item) => (item.id === msg.id ? msg : item)));
            }
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

  const filtered = conversations.filter((x) => {
    if (!x.contact.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (chipFilter === "unread" && !((unreadByContact[x.contact.id] ?? 0) > 0)) return false;
    if (chipFilter === "groups" && !x.contact.isGroup) return false;
    if (chipCategoryId) {
      const ids = x.contact.categoryIds && x.contact.categoryIds.length
        ? x.contact.categoryIds
        : x.contact.categoryId ? [x.contact.categoryId] : [];
      if (!ids.includes(chipCategoryId)) return false;
    }
    return true;
  });
  const unreadTotal = Object.values(unreadByContact).reduce((a, b) => a + (b > 0 ? 1 : 0), 0);

  const active = contacts.find((c) => c.id === activeId);

  useEffect(() => {
    const phone = active?.phone?.replace(/\D/g, "") ?? "";
    activePhoneRef.current = phone;
    setBotPausedActive(null);
    if (!phone) {
      botPausedAbortRef.current?.abort();
      setBotPausedLoading(false);
      return;
    }
    refetchBotPaused();
  }, [active?.phone, refetchBotPaused]);

  const handleAttachClick = () => {
    if (!activeId || attaching || sending) return;
    fileInputRef.current?.click();
  };

  const uploadFile = async (file: File) => {
    if (!activeId) return;
    const MAX = 16 * 1024 * 1024;
    if (file.size > MAX) {
      toast.error("Arquivo maior que 16MB não é suportado pelo WhatsApp.");
      return;
    }
    const mime = file.type || "application/octet-stream";
    const isImage = mime.startsWith("image/");
    const mediatype: "image" | "document" = isImage ? "image" : "document";

    setAttaching(true);
    try {
      // converte para base64 puro
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error("falha ao ler arquivo"));
        reader.onload = () => {
          const result = reader.result as string;
          const idx = result.indexOf(",");
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.readAsDataURL(file);
      });

      const caption = draft.trim() || undefined;
      const quotedMessageId = replyTo?.messageId ?? undefined;

      const res = await fetchWithAuthRetry("/api/public/evolution/send-media-and-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: activeId,
          mediatype,
          media: base64,
          fileName: file.name,
          mimetype: mime,
          caption,
          ...(quotedMessageId ? { quotedMessageId } : {}),
        }),
      });
      const raw = await res.text();
      let data: any = null;
      try { data = JSON.parse(raw); } catch {}
      if (!res.ok || !data?.ok) {
        const errMsg =
          (data && (typeof data.error === "string" ? data.error : data.error && JSON.stringify(data.error))) ||
          raw || `HTTP ${res.status}`;
        throw new Error(errMsg);
      }
      const msg: ChatMessage | undefined = data.message ?? (data.pending ? {
        id: `pending-${Date.now()}`,
        contactId: activeId,
        body: mediatype === "document" ? file.name : (caption ?? (isImage ? "[imagem]" : "[documento]")),
        fromMe: true,
        at: new Date().toISOString(),
        type: mediatype,
        mediaUrl: null,
        mediaMime: mime,
        mediaCaption: caption ?? null,
        status: "pending",
      } as ChatMessage : undefined);
      if (msg) {
        setMessages((prev) => (prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]));
        setLastByContact((prev) => ({ ...prev, [activeId]: msg }));
      }
      if (caption) setDraft("");
      setReplyTo(null);
      toast.success(isImage ? "Imagem enviada" : "Documento enviado");
    } catch (err: any) {
      toast.error(`Erro ao enviar anexo: ${err.message ?? err}`);
    } finally {
      setAttaching(false);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await uploadFile(file);
  };

  const stageAttachment = (file: File) => {
    if (pendingAttachment?.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
    const isImage = (file.type || "").startsWith("image/");
    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    setPendingAttachment({ file, previewUrl });
  };

  const clearPendingAttachment = () => {
    if (pendingAttachment?.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
    setPendingAttachment(null);
  };

  const sendPendingAttachment = async () => {
    if (!pendingAttachment) return;
    const file = pendingAttachment.file;
    clearPendingAttachment();
    await uploadFile(file);
  };

  const handlePasteIntoComposer = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!activeId || attaching || sending) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file") {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          stageAttachment(file);
          return;
        }
      }
    }
  };

  const handleSend = async () => {
    if (!draft.trim() || !activeId) return;
    setSending(true);
    try {
      const quotedMessageId = replyTo?.messageId ?? undefined;
      const res = await fetchWithAuthRetry("/api/public/evolution/send-and-log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contactId: activeId,
          text: draft.trim(),
          ...(quotedMessageId ? { quotedMessageId } : {}),
        }),
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
      setReplyTo(null);
    } catch (e: any) {
      toast.error(`Erro ao enviar: ${e.message ?? e}`);
    } finally {
      setSending(false);
    }
  };

  const activeCount = conversations.filter((c) => c.last).length;

  return (
    <div className="h-screen whatsweb-theme">
      <Card className="overflow-hidden h-full rounded-none border-0 bg-transparent shadow-none text-[color:var(--ww-text)]">
        <div
          className="grid grid-cols-1 h-full min-h-0 relative"
          style={{ gridTemplateColumns: "30% 1fr 3rem" }}
        >
          {/* Lista */}
          <div
            className="flex flex-col min-h-0 h-full overflow-hidden"
            style={{
              backgroundColor: "var(--ww-sidebar)",
              borderRight: "1px solid var(--ww-border)",
            }}
          >
            {/* Toolbar superior */}
            <div
              className="flex items-center justify-between px-3 h-14 shrink-0"
              style={{ borderBottom: "1px solid var(--ww-border)" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="size-9 rounded-full grid place-items-center shrink-0"
                  style={{
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    boxShadow: "var(--ww-shadow-md)",
                  }}
                >
                  <Bot className="size-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-tight truncate text-[color:var(--ww-text)]">
                    Bot ativo
                  </p>
                  <p className="text-[10px] leading-tight text-[color:var(--ww-text-muted)]">
                    {activeCount} conversas
                  </p>
                </div>
              </div>
              <TooltipProvider delayDuration={150}>
                <div className="flex items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5"
                        onClick={async () => {
                          const next = !soundOn;
                          setSoundOn(next);
                          if (next) {
                            const result = await activateNotifications();
                            if (result.browserPermission === "denied") {
                              toast.error("Notificações do navegador bloqueadas", {
                                description: "Libere as notificações deste site nas permissões do navegador.",
                              });
                            } else {
                              toast.success("Notificações ativadas");
                            }
                          } else {
                            setSoundEnabled(false);
                            setBrowserNotificationsEnabled(false);
                            toast("Notificações sonoras silenciadas");
                          }
                        }}
                      >
                        {soundOn ? <Bell className="size-4" /> : <BellOff className="size-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{soundOn ? "Silenciar notificações" : "Ativar notificações"}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5">
                        <Filter className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Filtrar contatos</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5">
                        <UsersIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Novo grupo</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5"
                        onClick={() => handleSync()}
                        disabled={syncing}
                      >
                        <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{syncing ? "Sincronizando…" : "Sincronizar mensagens recentes"}</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>

            {/* Busca */}
            <div className="p-3" style={{ borderBottom: "1px solid var(--ww-border)" }}>
              <div className="relative">
                <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--ww-text-muted)]" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar conversa ou número..."
                  className="pl-10 h-10 rounded-full border-0 text-sm placeholder:text-[color:var(--ww-text-dim)] focus-visible:ring-1"
                  style={{
                    backgroundColor: "var(--ww-surface)",
                    color: "var(--ww-text)",
                  }}
                />
              </div>
              <SearchOnWhatsApp
                search={search}
                hasResults={filtered.length > 0}
                onCreated={async (newId) => {
                  await refreshContacts();
                  setActiveId(newId);
                  setSearch("");
                }}
              />
            </div>

            {/* Chips de filtro estilo WhatsApp Web */}
            <div
              className="px-3 py-2 flex items-center gap-2 overflow-x-auto"
              style={{ borderBottom: "1px solid var(--ww-border)" }}
            >
              {([
                { key: "all", label: "Tudo" },
                { key: "unread", label: "Não lidas", count: unreadTotal },
                { key: "groups", label: "Grupos" },
              ] as const).map((chip) => {
                const active = chipFilter === chip.key;
                return (
                  <button
                    key={chip.key}
                    onClick={() => setChipFilter(chip.key)}
                    className={cn(
                      "shrink-0 h-7 px-3 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5",
                      active
                        ? "text-[color:var(--ww-accent)]"
                        : "text-[color:var(--ww-text-muted)] hover:bg-white/5",
                    )}
                    style={
                      active
                        ? { backgroundColor: "rgba(37,211,102,0.15)" }
                        : { backgroundColor: "var(--ww-surface)" }
                    }
                  >
                    {chip.label}
                    {"count" in chip && (chip as any).count > 0 && (
                      <span
                        className="min-w-[16px] h-4 px-1 rounded-full text-[10px] grid place-items-center text-white"
                        style={{ backgroundColor: "var(--ww-accent)" }}
                      >
                        {(chip as any).count}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Chip Etiquetas (dropdown de categorias) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "shrink-0 h-7 px-3 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5",
                      chipCategoryId
                        ? "text-[color:var(--ww-accent)]"
                        : "text-[color:var(--ww-text-muted)] hover:bg-white/5",
                    )}
                    style={
                      chipCategoryId
                        ? { backgroundColor: "rgba(37,211,102,0.15)" }
                        : { backgroundColor: "var(--ww-surface)" }
                    }
                  >
                    {chipCategoryId
                      ? (categories.find((c) => c.id === chipCategoryId)?.name ?? "Etiqueta")
                      : "Etiquetas"}
                    <ChevronDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
                  <DropdownMenuItem onClick={() => setChipCategoryId(null)}>
                    Todas
                  </DropdownMenuItem>
                  {categories.length > 0 && <DropdownMenuSeparator />}
                  {categories.map((cat) => (
                    <DropdownMenuItem
                      key={cat.id}
                      onClick={() => setChipCategoryId(cat.id)}
                      className="flex items-center gap-2"
                    >
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="truncate">{cat.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>


            <div className="overflow-auto flex-1">
              {loading ? (
                <div className="p-8 text-center text-[color:var(--ww-text-muted)]">
                  <Loader2 className="size-5 mx-auto animate-spin opacity-60" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-[color:var(--ww-text-muted)] text-sm">
                  Nenhuma conversa
                </div>
              ) : (
                filtered.map(({ contact, last }) => {
                  const isActive = contact.id === activeId;
                  const pause = replyPauseByContact[contact.id];
                  const unreadCount = unreadByContact[contact.id] ?? 0;
                  const unread = unreadCount > 0;
                  return (
                    <button
                      key={contact.id}
                      onClick={() => setActiveId(contact.id)}
                      className={cn(
                        "w-full text-left flex gap-3 px-3 py-3 transition-colors",
                        "hover:bg-white/5",
                        isActive && "bg-white/[0.07]",
                      )}
                      style={{ borderBottom: "1px solid var(--ww-border)" }}
                    >
                      <div className="relative shrink-0">
                        <div
                          className="size-12 rounded-full grid place-items-center text-sm font-semibold text-white overflow-hidden"
                          style={{
                            background: "linear-gradient(135deg,#334155,#1e293b)",
                            border: "1px solid var(--ww-border-strong)",
                          }}
                        >
                          {contact.avatarUrl ? (
                            <img
                              src={contact.avatarUrl}
                              alt={contact.name}
                              className="size-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            contact.name[0]
                          )}
                        </div>
                        {pause && (
                          <span
                            className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-amber-500 grid place-items-center"
                            style={{ border: "2px solid var(--ww-sidebar)" }}
                            title={`Sequência pausada: ${pause.sequenceName}`}
                          >
                            <PauseCircle className="size-2.5 text-white" />
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline gap-2">
                          <p className="font-semibold text-sm truncate flex items-center gap-1.5 text-[color:var(--ww-text)]">
                            {contact.name}
                            {contact.isGroup && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 leading-tight bg-white/10 text-[color:var(--ww-text-muted)] border-0">
                                Grupo
                              </Badge>
                            )}
                          </p>
                          <span className="text-[10px] text-[color:var(--ww-text-dim)] shrink-0">
                            {last && timeAgo(last.at)}
                          </span>
                        </div>
                        {(() => {
                          const ids = (contact.categoryIds && contact.categoryIds.length)
                            ? contact.categoryIds
                            : contact.categoryId ? [contact.categoryId] : [];
                          if (ids.length === 0) return null;
                          return (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {ids.map((id) => {
                                const cat = categories.find((c) => c.id === id);
                                if (!cat) return null;
                                return (
                                  <Badge
                                    key={id}
                                    variant="outline"
                                    className="text-[9px] px-1 py-0 leading-tight"
                                    style={{ borderColor: cat.color, color: cat.color, backgroundColor: "transparent" }}
                                  >
                                    {cat.name}
                                  </Badge>
                                );
                              })}
                            </div>
                          );
                        })()}
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-xs text-[color:var(--ww-text-muted)] truncate flex-1">
                            {last?.fromMe && "Você: "}
                            {last?.body ?? <span className="italic opacity-60">Sem mensagens</span>}
                          </p>
                          {unread && !isActive && (
                            <span
                              className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold grid place-items-center text-white"
                              style={{ backgroundColor: "var(--ww-accent)" }}
                              aria-label={`${unreadCount} mensagens não lidas`}
                            >
                              {unreadCount > 99 ? "99+" : unreadCount}
                            </span>
                          )}
                        </div>
                        {pause && (
                          <p className="text-[10px] text-amber-400 mt-0.5 truncate">
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
            <div
              className="flex flex-col min-h-0 h-full overflow-hidden whatsweb-doodle"
            >
              {/* Header do chat */}
              <div
                className="h-16 flex items-center justify-between px-5 shrink-0"
                style={{
                  backgroundColor: "var(--ww-sidebar)",
                  borderBottom: "1px solid var(--ww-border)",
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="size-10 rounded-full grid place-items-center text-sm font-semibold text-white shrink-0 overflow-hidden"
                    style={{
                      background: "linear-gradient(135deg,#334155,#1e293b)",
                      border: "1px solid var(--ww-border-strong)",
                    }}
                  >
                    {active.avatarUrl ? (
                      <img
                        src={active.avatarUrl}
                        alt={active.name}
                        className="size-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      active.name[0]
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm flex items-center gap-2 text-[color:var(--ww-text)] truncate">
                      {active.name}
                      {active.isGroup && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-white/10 text-[color:var(--ww-text-muted)] border-0">Grupo</Badge>
                      )}
                    </p>
                    <p className="text-xs font-mono text-[color:var(--ww-text-muted)] truncate">
                      {active.isGroup ? "Conversa em grupo" : active.phone}
                    </p>
                  </div>
                  {/* Badge de status (Novo / Em Atendimento) */}
                  {!active.isGroup && (
                    <Badge
                      variant="outline"
                      className="ml-2 gap-1 text-[10px] border-0"
                      style={{
                        backgroundColor: messages.length > 0 ? "rgba(16,185,129,0.15)" : "rgba(59,130,246,0.15)",
                        color: messages.length > 0 ? "#34d399" : "#60a5fa",
                      }}
                    >
                      {messages.length > 0 ? "Em atendimento" : "Novo"}
                    </Badge>
                  )}
                  {active && replyPauseByContact[active.id] && (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 bg-amber-500/10 text-amber-300 gap-1 cursor-help"
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
                  <div className="flex items-center gap-0.5">
                    {!active.isGroup && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5"
                              disabled={enriching.has(active.id)}
                              onClick={() => handleEnrich(active)}
                            >
                              {enriching.has(active.id) ? (
                                <Loader2 className="size-4 animate-spin text-emerald-400" />
                              ) : (
                                <Sparkles className="size-4 text-emerald-400" />
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
                              className="size-8 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5"
                              onClick={() => setEnrollContact(active)}
                            >
                              <GitBranch className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Adicionar a uma sequência</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-8 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5">
                                  <FolderPlus className="size-4 text-emerald-400" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-64">
                                <DropdownMenuLabel>Adicionar a uma categoria</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {categories.length === 0 ? (
                                  <DropdownMenuItem disabled>Nenhuma categoria criada</DropdownMenuItem>
                                ) : (
                                  categories.map((cat) => {
                                    const checked = (active.categoryIds ?? []).includes(cat.id);
                                    return (
                                      <DropdownMenuItem
                                        key={cat.id}
                                        onSelect={(e) => {
                                          e.preventDefault();
                                          handleToggleCategory(active, cat.id);
                                        }}
                                      >
                                        <TagIcon className="size-4 opacity-60" />
                                        <span className="flex-1 truncate">{cat.name}</span>
                                        {checked && <Check className="size-4 text-primary" />}
                                      </DropdownMenuItem>
                                    );
                                  })
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TooltipTrigger>
                          <TooltipContent>Adicionar a uma categoria</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5"
                              disabled={togglingIgnore.has(active.id)}
                              onClick={async () => {
                                await handleToggleIgnore(active);
                                setTimeout(() => { refetchBotPaused(); }, 2000);
                              }}
                            >
                              {togglingIgnore.has(active.id) || botPausedLoading ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : botPausedActive ? (
                                <ShieldCheck className="size-4 text-emerald-400" />
                              ) : (
                                <ShieldOff className="size-4 text-amber-400" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {botPausedLoading ? "Consultando ZapBot" : botPausedActive ? "Bot pausado no ZapBot" : "Bot ativo no ZapBot"}
                          </TooltipContent>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5" onClick={() => setEditOpen(true)}>
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
                          className="size-8 text-[color:var(--ww-text-muted)] hover:bg-white/5"
                          onClick={() => handleDeleteContact(active)}
                        >
                          <Trash2 className="size-4 text-red-400" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Excluir contato</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </div>


              <div ref={scrollRef} className="flex-1 overflow-auto p-5 space-y-2">
                {messages.length === 0 ? (
                  <div className="text-center text-sm text-[color:var(--ww-text-muted)] py-10">
                    Nenhuma mensagem ainda. Envie a primeira!
                  </div>
                ) : (
                  messages.map((m, index) => {
                    const status = (m.status ?? "").toLowerCase();
                    const hasLaterInboundReply = m.fromMe && messages.slice(index + 1).some((next) => !next.fromMe);
                    const delivered = isDeliveredStatus(status) || hasLaterInboundReply;
                    const read = isReadStatus(status) || hasLaterInboundReply;
                    const canForward =
                      !!m.messageId &&
                      (m.type === "text" || !m.type || m.type === "image" || m.type === "sticker" || m.type === "audio");
                    return (
                      <div
                        key={m.id}
                        className={cn("group/msg flex items-start gap-1", m.fromMe ? "justify-end" : "justify-start")}
                      >
                        {m.fromMe && (
                          <MessageActionsMenu
                            m={m}
                            canForward={canForward}
                            onReply={() => setReplyTo(m)}
                            onForward={() => m.messageId && setForwardMessageId(m.messageId)}
                          />
                        )}
                        <div
                          className={cn(
                            "max-w-[75%] rounded-2xl px-3 py-2 text-sm relative",
                            m.fromMe ? "rounded-br-sm" : "rounded-bl-sm",
                          )}
                          style={{
                            backgroundColor: m.fromMe ? "var(--ww-bubble-out)" : "var(--ww-bubble-in)",
                            color: m.fromMe ? "var(--ww-bubble-out-text)" : "var(--ww-bubble-in-text)",
                            boxShadow: "var(--ww-shadow-sm)",
                          }}
                        >
                          <MessageContent m={m} onOpenImage={(messageId, src, alt) => setViewer({ messageId, src, alt })} />
                          <div
                            className={cn(
                              "flex items-center gap-1 mt-1 text-[10px]",
                              m.fromMe ? "justify-end opacity-80" : "justify-end opacity-60",
                            )}
                          >
                            <span>
                              {new Date(m.at).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {m.fromMe && (
                              read ? (
                                <CheckCheck className="size-3.5" style={{ color: "#53bdeb" }} />
                              ) : delivered ? (
                                <CheckCheck className="size-3.5" style={{ color: "#9aa6b2" }} />
                              ) : (
                                <Check className="size-3.5" style={{ color: "#9aa6b2" }} />
                              )
                            )}
                          </div>
                        </div>
                        {!m.fromMe && (
                          <MessageActionsMenu
                            m={m}
                            canForward={canForward}
                            onReply={() => setReplyTo(m)}
                            onForward={() => m.messageId && setForwardMessageId(m.messageId)}
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Barra de digitação pill */}
              <div
                className="p-3 shrink-0"
                style={{
                  backgroundColor: "var(--ww-sidebar)",
                  borderTop: "1px solid var(--ww-border)",
                }}
              >
                {replyTo && (
                  <div
                    className="flex items-stretch gap-2 mb-2 rounded-md overflow-hidden"
                    style={{ backgroundColor: "var(--ww-surface)" }}
                  >
                    <div className="w-1 shrink-0" style={{ backgroundColor: "#10b981" }} />
                    <div className="flex-1 min-w-0 py-1.5 pr-2">
                      <p className="text-[11px] font-semibold text-emerald-400">
                        {replyTo.fromMe ? "Você" : (active?.name ?? "Contato")}
                      </p>
                      <p className="text-xs text-[color:var(--ww-text-muted)] truncate">
                        {replyPreviewText(replyTo)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="px-2 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)]"
                      aria-label="Cancelar resposta"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}
                {pendingAttachment && (
                  <div
                    className="flex items-center gap-3 mb-2 rounded-md p-2"
                    style={{ backgroundColor: "var(--ww-surface)" }}
                  >
                    {pendingAttachment.previewUrl ? (
                      <img
                        src={pendingAttachment.previewUrl}
                        alt="prévia"
                        className="size-16 rounded object-cover shrink-0"
                      />
                    ) : (
                      <div className="size-16 rounded bg-black/20 grid place-items-center shrink-0">
                        <FileText className="size-6 text-[color:var(--ww-text-muted)]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[color:var(--ww-text)] truncate">
                        {pendingAttachment.file.name || "imagem-colada.png"}
                      </p>
                      <p className="text-[11px] text-[color:var(--ww-text-muted)]">
                        {(pendingAttachment.file.size / 1024).toFixed(0)} KB — pressione Enter para enviar
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={clearPendingAttachment}
                      className="px-2 text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)]"
                      aria-label="Cancelar anexo"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}
                <div
                  className="flex items-center gap-2 rounded-full px-2 py-1"
                  style={{ backgroundColor: "var(--ww-surface)" }}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-full text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5 shrink-0"
                    aria-label="Emoji"
                  >
                    <Smile className="size-5" />
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                    className="hidden"
                    onChange={handleFileSelected}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleAttachClick}
                    disabled={attaching || sending || !activeId}
                    className="size-9 rounded-full text-[color:var(--ww-text-muted)] hover:text-[color:var(--ww-text)] hover:bg-white/5 shrink-0"
                    aria-label="Anexar"
                  >
                    {attaching ? <Loader2 className="size-5 animate-spin" /> : <Paperclip className="size-5" />}
                  </Button>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (sending || attaching) return;
                        if (pendingAttachment) void sendPendingAttachment();
                        else handleSend();
                      }
                    }}
                    onPaste={handlePasteIntoComposer}
                    placeholder="Digite uma mensagem... (Shift+Enter para nova linha, Ctrl+V para colar imagem)"
                    disabled={sending}
                    rows={1}
                    className="flex-1 border-0 bg-transparent shadow-none min-h-10 max-h-40 px-1 py-2 text-sm placeholder:text-[color:var(--ww-text-dim)] focus-visible:ring-0 text-[color:var(--ww-text)] resize-none"
                  />
                  {(draft.trim() || pendingAttachment) ? (
                    <Button
                      onClick={() => {
                        if (sending || attaching) return;
                        if (pendingAttachment) void sendPendingAttachment();
                        else handleSend();
                      }}
                      disabled={sending || attaching}
                      className="size-10 rounded-full p-0 shrink-0 text-white border-0"
                      style={{
                        background: "linear-gradient(135deg,#10b981,#059669)",
                        boxShadow: "var(--ww-shadow-md)",
                      }}
                      aria-label="Enviar"
                    >
                      {(sending || attaching) ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-10 rounded-full p-0 shrink-0 text-white border-0"
                      style={{
                        background: "linear-gradient(135deg,#10b981,#059669)",
                        boxShadow: "var(--ww-shadow-md)",
                      }}
                      aria-label="Gravar áudio"
                    >
                      <Mic className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center whatsweb-doodle">
              <div className="text-center text-[color:var(--ww-text-muted)]">
                <MessageCircle className="size-12 mx-auto opacity-30 mb-2" />
                <p className="text-sm">
                  {loading ? "Carregando..." : "Selecione uma conversa"}
                </p>
              </div>
            </div>
          )}

          {/* Painel IA — rail colapsado de 3rem; expande em overlay no hover */}
          <div className="hidden md:block relative w-12 h-full">
            <div
              className="group/aipanel absolute top-0 right-0 h-full flex flex-col overflow-hidden transition-[width] duration-200 ease-out w-12 hover:w-80 z-20"
              title="Contexto da IA"
              style={{
                backgroundColor: "var(--ww-sidebar)",
                borderLeft: "1px solid var(--ww-border)",
                color: "var(--ww-text)",
              }}
            >
            <div className="px-3 py-3 flex items-center gap-2 h-12 shrink-0 w-80" style={{ borderBottom: "1px solid var(--ww-border)" }}>
              <Sparkles className="size-4 text-emerald-400 shrink-0" />
              <h4 className="text-sm font-semibold whitespace-nowrap">
                Contexto da IA
              </h4>
            </div>
            <div className="p-4 space-y-4 overflow-auto flex-1 w-80">
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

      {/* Lightbox de imagem (estilo WhatsApp Web) */}
      <ImageLightbox
        viewer={viewer}
        onClose={() => setViewer(null)}
        onForward={(messageId) => {
          setForwardMessageId(messageId);
          setViewer(null);
        }}
      />

      {/* Dialog de encaminhar mensagem (texto, imagem, sticker, áudio) */}
      <ForwardMessageDialog
        messageId={forwardMessageId}
        contacts={contacts}
        onClose={() => setForwardMessageId(null)}
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

function SecureImage({
  messageId,
  alt,
  className,
  onOpen,
}: {
  messageId: string;
  alt: string;
  className?: string;
  onOpen?: (messageId: string, src: string, alt: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (src || loading) return;
    setLoading(true);
    setError(null);
    try {
      const c = await getSupabaseClient();
      if (!c) throw new Error("sem sessão");
      const sess = await c.auth.getSession();
      const token = sess?.data?.session?.access_token;
      if (!token) throw new Error("sem token");
      const res = await fetch("/api/public/evolution/media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setSrc(URL.createObjectURL(blob));
    } catch (e: any) {
      setError(e?.message ?? "erro");
    } finally {
      setLoading(false);
    }
  }, [messageId, src, loading]);

  useEffect(() => {
    load();
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  if (src) {
    return (
      <button
        type="button"
        onClick={() => onOpen?.(messageId, src, alt)}
        className="block cursor-zoom-in"
      >
        <img src={src} alt={alt} className={className} loading="lazy" />
      </button>
    );
  }
  if (error) {
    return (
      <button
        type="button"
        onClick={() => { setSrc(null); load(); }}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/10 hover:bg-black/20 text-xs"
      >
        <ImageIcon className="size-4" />
        Falha ao carregar imagem — tentar novamente
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-6 rounded-lg bg-black/10 text-xs opacity-70 min-w-[180px]">
      <ImageIcon className="size-4 animate-pulse" />
      Carregando imagem…
    </div>
  );
}

function SecureAudio({ messageId }: { messageId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (src || loading) return;
    setLoading(true);
    setError(null);
    try {
      const c = await getSupabaseClient();
      if (!c) throw new Error("sem sessão");
      const sess = await c.auth.getSession();
      const token = sess?.data?.session?.access_token;
      if (!token) throw new Error("sem token");
      const res = await fetch("/api/public/evolution/media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setSrc(URL.createObjectURL(blob));
    } catch (e: any) {
      setError(e?.message ?? "erro");
    } finally {
      setLoading(false);
    }
  }, [messageId, src, loading]);

  useEffect(() => {
    load();
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  if (src) {
    return <audio controls src={src} className="max-w-[260px]" preload="metadata" />;
  }
  if (error) {
    return (
      <button
        type="button"
        onClick={() => { setSrc(null); load(); }}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/10 hover:bg-black/20 text-xs"
      >
        <FileText className="size-4" />
        Falha ao carregar áudio — tentar novamente
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/10 text-xs opacity-70 min-w-[180px]">
      <FileText className="size-4 animate-pulse" />
      Carregando áudio…
    </div>
  );
}

function getFileExt(fileName: string, mime: string | null): string {
  const fromName = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  if (fromName && fromName.length <= 5) return fromName.toUpperCase();
  if (mime) {
    const m = mime.toLowerCase();
    if (m.includes("pdf")) return "PDF";
    if (m.includes("word") || m.includes("msword")) return "DOC";
    if (m.includes("sheet") || m.includes("excel")) return "XLS";
    if (m.includes("presentation") || m.includes("powerpoint")) return "PPT";
    if (m.includes("zip")) return "ZIP";
    if (m.includes("text/")) return "TXT";
  }
  return "FILE";
}

function FileBadge({ ext }: { ext: string }) {
  const colorMap: Record<string, string> = {
    PDF: "bg-[#ED4136]",
    DOC: "bg-[#2A5699]",
    DOCX: "bg-[#2A5699]",
    XLS: "bg-[#1F7244]",
    XLSX: "bg-[#1F7244]",
    PPT: "bg-[#D24726]",
    PPTX: "bg-[#D24726]",
    ZIP: "bg-[#6B7280]",
    TXT: "bg-[#6B7280]",
    FILE: "bg-[#6B7280]",
  };
  const bg = colorMap[ext] ?? "bg-[#6B7280]";
  return (
    <div
      className={`relative shrink-0 w-10 h-12 rounded-md ${bg} flex items-end justify-center pb-1 shadow-sm`}
      aria-hidden
    >
      <div className="absolute top-0 right-0 w-3 h-3 bg-white/30 rounded-bl-md" />
      <span className="text-[10px] font-bold text-white tracking-tight leading-none">{ext}</span>
    </div>
  );
}

function DocCard({
  fileName,
  ext,
  trailing,
}: {
  fileName: string;
  ext: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 p-2 pr-3 rounded-lg bg-black/5 hover:bg-black/10 transition min-w-[240px]">
      <FileBadge ext={ext} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate leading-tight">{fileName}</div>
        <div className="text-[11px] opacity-60 mt-0.5">{ext}</div>
      </div>
      {trailing}
    </div>
  );
}

function SecureDocument({
  messageId,
  fileName,
  mime,
}: {
  messageId: string;
  fileName: string;
  mime: string | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (src || loading) return;
    setLoading(true);
    setError(null);
    try {
      const c = await getSupabaseClient();
      if (!c) throw new Error("sem sessão");
      const sess = await c.auth.getSession();
      const token = sess?.data?.session?.access_token;
      if (!token) throw new Error("sem token");
      const res = await fetch("/api/public/evolution/media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const typed = mime ? new Blob([blob], { type: mime }) : blob;
      setSrc(URL.createObjectURL(typed));
    } catch (e: any) {
      setError(e?.message ?? "erro");
    } finally {
      setLoading(false);
    }
  }, [messageId, src, loading, mime]);

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const ext = getFileExt(fileName, mime);

  if (src) {
    return (
      <a href={src} target="_blank" rel="noreferrer" download={fileName} className="block">
        <DocCard fileName={fileName} ext={ext} trailing={<Download className="size-4 opacity-60" />} />
      </a>
    );
  }
  if (error) {
    return (
      <button type="button" onClick={() => { setSrc(null); load(); }} className="block w-full text-left">
        <DocCard fileName="Falha ao carregar — tentar novamente" ext={ext} />
      </button>
    );
  }
  return (
    <button type="button" onClick={load} disabled={loading} className="block w-full text-left">
      <DocCard
        fileName={fileName}
        ext={ext}
        trailing={loading ? <Loader2 className="size-4 animate-spin opacity-60" /> : <Download className="size-4 opacity-60" />}
      />
    </button>
  );
}

function MessageContent({
  m,
  onOpenImage,
}: {
  m: ChatMessage;
  onOpenImage?: (messageId: string, src: string, alt: string) => void;
}) {
  const type = m.type ?? "text";
  const caption = m.mediaCaption ?? (m.body && m.body !== "[imagem]" && m.body !== "[vídeo]" ? m.body : "");

  if (type === "image") {
    return (
      <div className="space-y-1.5">
        {m.messageId ? (
          <SecureImage
            messageId={m.messageId}
            alt={caption || "imagem"}
            className="rounded-lg max-w-full max-h-72 object-contain bg-black/5"
            onOpen={onOpenImage}
          />
        ) : (
          <p className="italic opacity-70 flex items-center gap-1.5">
            <ImageIcon className="size-3.5" />
            Imagem indisponível
          </p>
        )}
        {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
      </div>
    );
  }

  if (type === "video") {
    // Política: vídeos NÃO são baixados/descriptografados.
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/10 text-xs opacity-80 min-w-[200px]">
          <FileText className="size-4" />
          Vídeo recebido (não baixado)
        </div>
        {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
      </div>
    );
  }

  if (type === "audio") {
    if (!m.messageId) {
      return (
        <p className="italic opacity-70 flex items-center gap-1.5">
          <FileText className="size-3.5" />
          Áudio indisponível
        </p>
      );
    }
    return <SecureAudio messageId={m.messageId} />;
  }

  if (type === "document") {
    const fileName =
      caption ||
      (m.mediaUrl ? m.mediaUrl.split("/").pop() : null) ||
      (m.body && m.body !== "[documento]" ? m.body : null) ||
      "documento";
    // mediaUrl do WhatsApp é criptografada (.enc) — não dá pra abrir direto.
    // Sempre passamos pelo SecureDocument, que descriptografa via Evolution API.
    if (m.messageId) {
      return <SecureDocument messageId={m.messageId} fileName={fileName} mime={m.mediaMime ?? null} />;
    }
    const extFb = getFileExt(fileName, m.mediaMime ?? null);
    if (m.mediaUrl) {
      return (
        <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="block">
          <DocCard fileName={fileName} ext={extFb} trailing={<Download className="size-4 opacity-60" />} />
        </a>
      );
    }
    return <DocCard fileName={fileName} ext={extFb} trailing={<Loader2 className="size-4 animate-spin opacity-60" />} />;
  }

  if (type === "sticker" && m.messageId) {
    return (
      <SecureImage
        messageId={m.messageId}
        alt="sticker"
        className="size-32 object-contain"
        onOpen={onOpenImage}
      />
    );
  }

  if (type === "sticker") {
    return (
      <p className="italic opacity-70 flex items-center gap-1.5">
        <ImageIcon className="size-3.5" />
        Mídia indisponível
      </p>
    );
  }

  if (type === "location") {
    const url = m.mediaUrl;
    const label = m.mediaCaption || (m.body && m.body !== "[localização]" ? m.body : "Localização compartilhada");
    const coords = m.mediaMime?.startsWith("geo:") ? m.mediaMime.slice(4) : null;
    if (url) {
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-2 p-2 rounded-lg bg-black/10 hover:bg-black/20 transition min-w-[220px]"
        >
          <MapPin className="size-5 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{label}</p>
            {coords ? <p className="text-[10px] opacity-70 truncate">{coords}</p> : null}
            <p className="text-[10px] opacity-70">Abrir no Google Maps</p>
          </div>
        </a>
      );
    }
    return (
      <p className="italic opacity-70 flex items-center gap-1.5">
        <MapPin className="size-3.5" />
        {label}
      </p>
    );
  }

  if (type === "contact") {
    const label = m.body || "Contato compartilhado";
    const vcard = m.mediaCaption ?? "";
    const telFromVcard = vcard.match(/TEL[^:]*:([+\d\s()-]+)/i)?.[1];
    const telFromBody = label.match(/([+\d][\d\s()-]{7,})/)?.[1];
    const rawPhone = (telFromVcard ?? telFromBody ?? "").replace(/\D/g, "");
    const waUrl = rawPhone ? `https://wa.me/${rawPhone}` : null;
    const inner = (
      <>
        <User className="size-5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium break-words">{label}</p>
          <p className="text-[10px] opacity-70">
            {waUrl ? "Abrir no WhatsApp" : "Contato (vCard)"}
          </p>
        </div>
      </>
    );
    if (waUrl) {
      return (
        <a
          href={waUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-2 p-2 rounded-lg bg-black/10 hover:bg-black/20 transition min-w-[220px]"
        >
          {inner}
        </a>
      );
    }
    return (
      <div className="flex items-start gap-2 p-2 rounded-lg bg-black/10 min-w-[220px]">
        {inner}
      </div>
    );
  }

  if (type === "unknown") {
    return (
      <p className="italic opacity-70 text-xs">
        {m.body || "[mensagem não suportada]"}
      </p>
    );
  }

  return <TextWithLinkPreview body={m.body ?? ""} />;
}

// Cache global de previews para não refazer fetch ao re-render.
const linkPreviewCache = new Map<
  string,
  {
    url: string;
    title: string | null;
    description: string | null;
    image: string | null;
    siteName: string | null;
  } | null
>();
const linkPreviewInflight = new Map<string, Promise<void>>();

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?()\[\]'"])/gi;

function extractFirstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  return m?.[0] ?? null;
}

function linkifyText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(URL_RE.source, "gi");
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a
        key={`u${i++}`}
        href={match[0]}
        target="_blank"
        rel="noreferrer"
        className="underline break-all"
      >
        {match[0]}
      </a>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function TextWithLinkPreview({ body }: { body: string }) {
  const url = useMemo(() => extractFirstUrl(body), [body]);
  const [preview, setPreview] = useState(() =>
    url ? linkPreviewCache.get(url) ?? undefined : null,
  );

  useEffect(() => {
    if (!url) return;
    if (linkPreviewCache.has(url)) {
      setPreview(linkPreviewCache.get(url) ?? null);
      return;
    }
    let cancelled = false;
    const existing = linkPreviewInflight.get(url);
    const run =
      existing ??
      (async () => {
        try {
          const res = await fetch(
            `/api/public/link-preview?url=${encodeURIComponent(url)}`,
          );
          if (!res.ok) {
            linkPreviewCache.set(url, null);
            return;
          }
          const data = await res.json();
          if (data?.error || (!data?.title && !data?.image && !data?.description)) {
            linkPreviewCache.set(url, null);
          } else {
            linkPreviewCache.set(url, {
              url: data.url ?? url,
              title: data.title ?? null,
              description: data.description ?? null,
              image: data.image ?? null,
              siteName: data.siteName ?? null,
            });
          }
        } catch {
          linkPreviewCache.set(url, null);
        }
      })();
    if (!existing) linkPreviewInflight.set(url, run);
    run.finally(() => {
      if (!cancelled) setPreview(linkPreviewCache.get(url) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="space-y-1.5">
      {preview && (preview.title || preview.image || preview.description) ? (
        <a
          href={preview.url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg overflow-hidden border border-black/10 bg-black/5 hover:bg-black/10 transition-colors max-w-[320px]"
        >
          {preview.image ? (
            <img
              src={preview.image}
              alt=""
              className="w-full h-40 object-cover bg-black/10"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          <div className="px-2.5 py-1.5">
            {preview.siteName ? (
              <div className="text-[10px] uppercase tracking-wide opacity-60 truncate">
                {preview.siteName}
              </div>
            ) : null}
            {preview.title ? (
              <div className="text-xs font-semibold line-clamp-2">
                {preview.title}
              </div>
            ) : null}
            {preview.description ? (
              <div className="text-xs opacity-75 line-clamp-2 mt-0.5">
                {preview.description}
              </div>
            ) : null}
          </div>
        </a>
      ) : null}
      <p className="whitespace-pre-wrap break-words">{linkifyText(body)}</p>
    </div>
  );
}


function SearchOnWhatsApp({
  search,
  hasResults,
  onCreated,
}: {
  search: string;
  hasResults: boolean;
  onCreated: (newContactId: string) => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const digits = search.replace(/\D/g, "");
  // Mostra só se: usuário digitou algo, parece um número (10-15 dígitos)
  // e não há resultados locais.
  const looksLikeNumber = digits.length >= 10 && digits.length <= 15;
  if (!search.trim() || hasResults || !looksLikeNumber) return null;

  async function handleClick() {
    setLoading(true);
    try {
      const c = await getSupabaseClient();
      const { data: sess } = (await c?.auth.getSession()) ?? { data: { session: null } };
      const token = sess?.session?.access_token;
      if (!token) throw new Error("sessão expirada — faça login novamente");

      const res = await fetch("/api/public/evolution/check-number", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ number: digits }),
      });
      const data = await res.json();
      if (res.status === 429) {
        toast.warning("Aguarde alguns segundos antes de buscar outro número");
        return;
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
      }
      if (data.exists === false) {
        toast.error("Esse número não está no WhatsApp");
        return;
      }
      if (data.contact?.id) {
        toast.success(
          data.alreadyExisted
            ? "Contato já existia no CRM"
            : "Contato adicionado!",
        );
        await onCreated(data.contact.id);
      }
    } catch (e: any) {
      toast.error("Falha ao buscar número", { description: String(e?.message ?? e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={loading}
      className="w-full mt-2 gap-2 text-xs"
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
      {loading ? "Verificando..." : `Buscar +${digits} no WhatsApp`}
    </Button>
  );
}


// ===================== Lightbox de imagem =====================
function ImageLightbox({
  viewer,
  onClose,
  onForward,
}: {
  viewer: { messageId: string; src: string; alt: string } | null;
  onClose: () => void;
  onForward: (messageId: string) => void;
}) {
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, onClose]);

  if (!viewer) return null;
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute top-3 right-3 flex items-center gap-2 z-10" onClick={(e) => e.stopPropagation()}>
        <a
          href={viewer.src}
          download={`imagem-${viewer.messageId}.jpg`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-xs"
        >
          <Download className="size-4" /> Baixar
        </a>
        <button
          type="button"
          onClick={() => onForward(viewer.messageId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-xs"
        >
          <Forward className="size-4" /> Encaminhar
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center size-9 rounded-md bg-white/10 hover:bg-white/20 text-white"
        >
          <X className="size-5" />
        </button>
      </div>
      <img
        src={viewer.src}
        alt={viewer.alt}
        className="max-w-[95vw] max-h-[95vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ===================== Dialog de Encaminhar Mensagem (genérico) =====================
function ForwardMessageDialog({
  messageId,
  contacts,
  onClose,
}: {
  messageId: string | null;
  contacts: Contact[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!messageId) {
      setSelected(new Set());
      setSearch("");
    }
  }, [messageId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q),
    );
  }, [contacts, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (!messageId || selected.size === 0) return;
    setSending(true);
    try {
      const c = await getSupabaseClient();
      if (!c) throw new Error("sem sessão");
      const sess = await c.auth.getSession();
      const token = sess?.data?.session?.access_token;
      if (!token) throw new Error("sem token");
      const res = await fetch("/api/public/evolution/forward-message", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          contactIds: Array.from(selected),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Encaminhada para ${data.sent}/${data.total} contato(s)`);
      onClose();
    } catch (e: any) {
      toast.error(`Falha ao encaminhar: ${e?.message ?? e}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!messageId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagem</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Buscar contato ou grupo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">Nenhum contato encontrado</p>
            ) : (
              filtered.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 p-2 hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggle(c.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {c.name}
                      {c.isGroup && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">(Grupo)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.isGroup ? "Conversa em grupo" : c.phone}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending || selected.size === 0}>
            {sending ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <Forward className="size-4 mr-2" />
            )}
            Encaminhar ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===================== Helpers + Menu de ações da mensagem =====================
function replyPreviewText(m: ChatMessage): string {
  const t = m.type ?? "text";
  if (t === "image") return m.mediaCaption ? `📷 ${m.mediaCaption}` : "📷 Imagem";
  if (t === "sticker") return "Sticker";
  if (t === "audio") return "🎤 Mensagem de voz";
  if (t === "video") return m.mediaCaption ? `🎬 ${m.mediaCaption}` : "🎬 Vídeo";
  if (t === "document") return `📄 ${m.mediaCaption ?? m.body ?? "Documento"}`;
  if (t === "location") return `📍 ${m.mediaCaption ?? "Localização"}`;
  if (t === "contact") return `👤 ${m.body ?? "Contato"}`;
  if (t === "unknown") return m.body ?? "[mensagem não suportada]";
  return m.body ?? "";
}

function MessageActionsMenu({
  m,
  canForward,
  onReply,
  onForward,
}: {
  m: ChatMessage;
  canForward: boolean;
  onReply: () => void;
  onForward: () => void;
}) {
  const handleCopy = async () => {
    const text = m.type === "text" || !m.type ? (m.body ?? "") : (m.mediaCaption ?? m.body ?? "");
    if (!text) {
      toast.error("Nada para copiar");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado");
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="opacity-0 group-hover/msg:opacity-100 transition-opacity self-center size-7 rounded-full grid place-items-center hover:bg-white/10 text-[color:var(--ww-text-muted)]"
          aria-label="Ações da mensagem"
        >
          <ChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onReply(); }}>
          <Reply className="size-4 opacity-70" />
          <span>Responder</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleCopy(); }}>
          <Copy className="size-4 opacity-70" />
          <span>Copiar</span>
        </DropdownMenuItem>
        {canForward && (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onForward(); }}>
            <Forward className="size-4 opacity-70" />
            <span>Encaminhar</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

