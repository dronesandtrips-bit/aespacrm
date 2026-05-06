// Helper server-only: lógica de envio em lote (texto + variáveis + mídia
// opcional + controle pausar/cancelar). Usado tanto pelo endpoint
// /api/public/evolution/bulk-dispatch (disparo imediato) quanto pelo
// /api/public/evolution/bulk-tick (cron de agendados).

import { getSupabaseAdmin } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type BulkMedia = {
  type: "image" | "document" | "video" | "audio";
  base64: string;
  mime?: string | null;
  filename?: string | null;
  caption?: string | null;
};

function applyVars(
  template: string,
  ctx: { name: string; firstName: string; company: string; category: string },
) {
  return template
    .replaceAll("{nome}", ctx.name)
    .replaceAll("{primeiro_nome}", ctx.firstName)
    .replaceAll("{empresa}", ctx.company)
    .replaceAll("{categoria}", ctx.category);
}

export async function runBulkDispatch(opts: {
  userId: string;
  bulkId: string;
  contactIds: string[];
  message: string;
  intervalSeconds: number;
  media?: BulkMedia | null;
  apiUrl: string;
  apiKey: string;
}) {
  const sb = getSupabaseAdmin();
  const { userId, bulkId, contactIds, message, intervalSeconds, media, apiUrl, apiKey } = opts;

  await sb.from("crm_bulk_sends").update({ status: "in_progress" }).eq("id", bulkId);

  const { data: contacts } = await sb
    .from("crm_contacts")
    .select("id, name, phone_norm, notes, category_id, crm_categories(name)")
    .eq("user_id", userId)
    .eq("is_group", false)
    .in("id", contactIds);

  const valid = (contacts ?? []).filter((c: any) => c.phone_norm);
  let sent = 0;
  let failed = 0;
  let cancelled = false;

  for (let i = 0; i < valid.length; i++) {
    const { data: state } = await sb
      .from("crm_bulk_sends")
      .select("control")
      .eq("id", bulkId)
      .maybeSingle();
    if (state?.control === "cancelled") { cancelled = true; break; }
    if (state?.control === "paused") {
      await sb.from("crm_bulk_sends").update({ status: "paused" }).eq("id", bulkId);
      while (true) {
        await sleep(5_000);
        const { data: s2 } = await sb
          .from("crm_bulk_sends")
          .select("control")
          .eq("id", bulkId)
          .maybeSingle();
        if (s2?.control === "cancelled") { cancelled = true; break; }
        if (s2?.control === "run") {
          await sb.from("crm_bulk_sends").update({ status: "in_progress" }).eq("id", bulkId);
          break;
        }
      }
      if (cancelled) break;
    }

    const c: any = valid[i];
    const fullName = String(c.name ?? "");
    const firstName = fullName.split(" ")[0] ?? fullName;
    const company = String(c.notes ?? "").trim() || fullName;
    const category = (c.crm_categories?.name as string) ?? "";
    const text = applyVars(message, { name: fullName, firstName, company, category });

    try {
      let res: Response;
      if (media) {
        const caption = media.caption
          ? applyVars(media.caption, { name: fullName, firstName, company, category })
          : (text || undefined);
        res = await fetch(`${apiUrl}/message/sendMedia/${INSTANCE}`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            number: c.phone_norm,
            mediatype: media.type,
            media: media.base64,
            mimetype: media.mime ?? undefined,
            fileName: media.filename ?? undefined,
            caption,
          }),
        });
      } else {
        res = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ number: c.phone_norm, text }),
        });
      }
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        sent++;
        await sb.from("crm_messages").upsert(
          {
            user_id: userId,
            contact_id: c.id,
            body: media ? (media.caption ? text : `[${media.type}]`) : text,
            from_me: true,
            type: media ? media.type : "text",
            message_id: data?.key?.id ?? null,
            remote_jid: data?.key?.remoteJid ?? `${c.phone_norm}@s.whatsapp.net`,
            media_mime: media?.mime ?? null,
            media_caption: media ? text : null,
            status: "sent",
            raw: { bulk_id: bulkId, ...data },
          },
          { onConflict: "user_id,message_id", ignoreDuplicates: false },
        );
      } else {
        failed++;
        await sb.from("crm_messages").insert({
          user_id: userId,
          contact_id: c.id,
          body: text,
          from_me: true,
          type: media ? media.type : "text",
          status: "failed",
          raw: { bulk_id: bulkId, error: data },
        });
      }
    } catch (err: any) {
      failed++;
      console.error("[bulk] send error", err);
    }

    await sb
      .from("crm_bulk_sends")
      .update({ sent_count: sent + failed })
      .eq("id", bulkId)
      .eq("user_id", userId);

    if (i < valid.length - 1) await sleep(intervalSeconds * 1000);
  }

  const finalStatus = cancelled
    ? "cancelled"
    : valid.length === 0
    ? "error"
    : failed === valid.length
    ? "error"
    : "completed";

  await sb
    .from("crm_bulk_sends")
    .update({ status: finalStatus, sent_count: sent + failed })
    .eq("id", bulkId)
    .eq("user_id", userId);

  return { sent, failed, total: valid.length, cancelled };
}

export function getEvolutionEnv() {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  return { apiUrl, apiKey };
}
