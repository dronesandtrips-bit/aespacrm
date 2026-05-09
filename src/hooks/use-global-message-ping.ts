import { useEffect } from "react";
import { getSupabaseClient } from "@/integrations/supabase/client";
import {
  notifyIncomingMessage,
  primeNotificationSoundOnGesture,
} from "@/lib/notification-sound";

type MessageInsert = {
  id?: string | null;
  message_id?: string | null;
  contact_id?: string | null;
  body?: string | null;
  from_me?: boolean | null;
  at?: string | null;
};

type ContactNotificationInfo = {
  name?: string | null;
  is_group?: boolean | null;
};

/**
 * Listener global: toca um ping para toda mensagem nova recebida (não-fromMe),
 * independente da rota em que o usuário esteja. Filtra grupos via consulta
 * leve em crm_contacts (cacheada em memória).
 *
 * O throttle interno do playMessagePing (400ms) evita duplicação caso a página
 * /inbox também esteja montada com o seu próprio listener.
 */
export function useGlobalMessagePing() {
  useEffect(() => {
    let channel: { unsubscribe?: () => void } | undefined;
    let cancelled = false;
    const contactCache = new Map<string, ContactNotificationInfo>();
    const cleanupAudioUnlock = primeNotificationSoundOnGesture();

    (async () => {
      const c = await getSupabaseClient();
      if (!c || cancelled) return;
      channel = c
        .channel(`crm_messages_global_ping_${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "aespacrm", table: "crm_messages" },
          async (payload: { new: MessageInsert }) => {
            const row = payload.new;
            if (row?.from_me) return;

            const contactId = row.contact_id;
            if (!contactId) return;
            let contact = contactCache.get(contactId);
            if (!contact) {
              try {
                const { data } = await c
                  .schema("aespacrm")
                  .from("crm_contacts")
                  .select("name,is_group")
                  .eq("id", contactId)
                  .maybeSingle();
                contact = (data as ContactNotificationInfo | null) ?? {};
                contactCache.set(contactId, contact);
              } catch {
                contact = {};
              }
            }
            notifyIncomingMessage({
              id: row.id,
              messageId: row.message_id,
              contactId,
              contactName: contact.name,
              body: row.body,
              fromMe: row.from_me,
              isGroup: contact.is_group,
              at: row.at,
            });
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      cleanupAudioUnlock();
      try {
        channel?.unsubscribe?.();
      } catch {
        /* noop */
      }
    };
  }, []);
}
