import { useEffect } from "react";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { playMessagePing, isSoundEnabled, getSoundVolume } from "@/lib/notification-sound";

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
    let channel: any;
    let cancelled = false;
    const groupCache = new Map<string, boolean>(); // contactId -> isGroup

    (async () => {
      const c = await getSupabaseClient();
      if (!c || cancelled) return;
      channel = c
        .channel(`crm_messages_global_ping_${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "aespacrm", table: "crm_messages" },
          async (payload: any) => {
            const row = payload.new;
            if (row?.from_me) return;
            if (!isSoundEnabled()) return;

            const contactId: string = row.contact_id;
            let isGroup = groupCache.get(contactId);
            if (isGroup === undefined) {
              try {
                const { data } = await c
                  .schema("aespacrm")
                  .from("crm_contacts")
                  .select("is_group")
                  .eq("id", contactId)
                  .maybeSingle();
                isGroup = !!(data as any)?.is_group;
                groupCache.set(contactId, isGroup);
              } catch {
                isGroup = false;
              }
            }
            if (isGroup) return;
            playMessagePing(getSoundVolume());
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      try {
        channel?.unsubscribe?.();
      } catch {
        /* noop */
      }
    };
  }, []);
}
