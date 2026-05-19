// Helper server-only: lógica de envio em lote (texto + variáveis + mídia
// opcional + controle pausar/cancelar). Usado tanto pelo endpoint
// /api/public/evolution/bulk-dispatch (disparo imediato) quanto pelo
// /api/public/evolution/bulk-tick (cron de agendados).
//
// MODELO "BATCH PER TICK" (fix para Cloudflare Worker ~30s):
// - cada chamada processa no máximo MAX_PER_TICK contatos, respeitando
//   um budget de wall-clock (~20s) para sobrar margem dentro do request.
// - persiste `next_index` e `sent_count` na linha; deixa status='in_progress'
//   com `claimed_at = now()` quando ainda há contatos pendentes.
// - o cron /bulk-tick também repesca linhas in_progress órfãs
//   (claimed_at < now() - 90s) e chama esta função novamente,
//   continuando de onde parou. Listas grandes vão completar em vários
//   ticks (1 min cada), sem perda de progresso.

import { getSupabaseAdmin } from "@/integrations/supabase/server";
import { buildOptoutUrlFor } from "@/server/optout.server";

const INSTANCE = "zapcrm";
const MAX_PER_TICK = 5;        // até 5 envios por execução
const TICK_BUDGET_MS = 20_000; // budget de wall-clock por execução
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
  ctx: {
    name: string;
    firstName: string;
    company: string;
    category: string;
    optoutUrl: string;
  },
) {
  const hasOptout =
    template.includes("{link_descadastro}") || template.includes("{{link_descadastro}}");

  const rendered = template
    .replaceAll("{nome}", ctx.name)
    .replaceAll("{primeiro_nome}", ctx.firstName)
    .replaceAll("{empresa}", ctx.company)
    .replaceAll("{categoria}", ctx.category)
    .replaceAll("{link_descadastro}", ctx.optoutUrl)
    .replaceAll("{{link_descadastro}}", ctx.optoutUrl);

  if (!hasOptout && ctx.optoutUrl) {
    return `${rendered}\n\n_Não quer mais receber? Clique aqui:_ ${ctx.optoutUrl}`;
  }
  return rendered;
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
  const startedAt = Date.now();

  // Marca claim no início deste tick — heartbeat para o cron saber que
  // alguém está trabalhando nesta linha (e poder reclamar se travar).
  await sb
    .from("crm_bulk_sends")
    .update({ status: "in_progress", claimed_at: new Date().toISOString() })
    .eq("id", bulkId);

  // Lê estado atual para retomar do cursor onde paramos.
  const { data: head } = await sb
    .from("crm_bulk_sends")
    .select("next_index, sent_count, control")
    .eq("id", bulkId)
    .maybeSingle();

  let cursor = Math.max(0, Number(head?.next_index ?? 0));
  let processedTotal = Math.max(0, Number(head?.sent_count ?? 0));
  console.log(
    `[bulk] start bulkId=${bulkId} cursor=${cursor} processedTotal=${processedTotal} total=${contactIds.length}`,
  );

  if (head?.control === "cancelled") {
    await sb
      .from("crm_bulk_sends")
      .update({ status: "cancelled", claimed_at: null })
      .eq("id", bulkId);
    return { sent: 0, failed: 0, total: contactIds.length, cancelled: true, done: true };
  }

  const { data: contacts, error: contactsError } = await sb
    .from("crm_contacts")
    .select("id, name, phone_norm, notes, category_id, category:crm_categories!crm_contacts_category_id_fkey(name)")
    .eq("user_id", userId)
    .eq("is_group", false)
    .in("id", contactIds);

  if (contactsError) {
    console.error("[bulk] contacts query failed", contactsError);
    await sb
      .from("crm_bulk_sends")
      .update({ status: "error", claimed_at: null })
      .eq("id", bulkId)
      .eq("user_id", userId);
    throw contactsError;
  }

  // Mantém ordem de contactIds (o cursor é índice nessa lista).
  const byId = new Map<string, any>();
  for (const c of contacts ?? []) byId.set(c.id, c);
  const orderedAll = contactIds.map((id) => byId.get(id)).filter(Boolean);
  // Considera "válido" só quem tem phone_norm.
  const orderedValidIdx: number[] = [];
  for (let k = 0; k < orderedAll.length; k++) {
    if (orderedAll[k]?.phone_norm) orderedValidIdx.push(k);
  }
  const totalValid = orderedValidIdx.length;

  let sentThisTick = 0;
  let failedThisTick = 0;
  let cancelled = false;
  let paused = false;
  let processedThisTick = 0;

  while (cursor < contactIds.length) {
    if (processedThisTick >= MAX_PER_TICK) break;
    if (Date.now() - startedAt > TICK_BUDGET_MS) break;

    // Checa controle (pause/cancel) antes de cada envio.
    const { data: state } = await sb
      .from("crm_bulk_sends")
      .select("control")
      .eq("id", bulkId)
      .maybeSingle();
    if (state?.control === "cancelled") { cancelled = true; break; }
    if (state?.control === "paused") { paused = true; break; }

    const c: any = orderedAll[cursor];
    cursor++;
    if (!c || !c.phone_norm) {
      // pula contato inválido sem gastar interval
      continue;
    }

    const fullName = String(c.name ?? "");
    const firstName = fullName.split(" ")[0] ?? fullName;
    const company = String(c.notes ?? "").trim() || fullName;
    const category = (c.category?.name as string) ?? "";
    const optoutUrl = await buildOptoutUrlFor(userId, c.phone_norm);
    const text = applyVars(message, { name: fullName, firstName, company, category, optoutUrl });

    try {
      let res: Response;
      if (media) {
        const caption = media.caption
          ? applyVars(media.caption, { name: fullName, firstName, company, category, optoutUrl })
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
        sentThisTick++;
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
        failedThisTick++;
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
      failedThisTick++;
      console.error("[bulk] send error", err);
    }

    processedTotal++;
    processedThisTick++;

    // Heartbeat + cursor após cada envio (mesmo que o Worker morra, o
    // próximo tick retoma deste ponto).
    await sb
      .from("crm_bulk_sends")
      .update({
        sent_count: processedTotal,
        next_index: cursor,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", bulkId)
      .eq("user_id", userId);

    // Aplica intervalo apenas se ainda há mais para enviar dentro do budget.
    const hasMore = cursor < contactIds.length;
    const canContinue =
      processedThisTick < MAX_PER_TICK &&
      Date.now() - startedAt + intervalSeconds * 1000 < TICK_BUDGET_MS;
    if (hasMore && canContinue) {
      await sleep(intervalSeconds * 1000);
    }
  }

  const done = !cancelled && !paused && cursor >= contactIds.length;
  let finalStatus: string;
  if (cancelled) finalStatus = "cancelled";
  else if (paused) finalStatus = "paused";
  else if (done) {
    finalStatus = totalValid === 0 ? "error" : "completed";
  } else {
    finalStatus = "in_progress"; // ainda há mais — cron continua no próximo tick
  }

  await sb
    .from("crm_bulk_sends")
    .update({
      status: finalStatus,
      sent_count: processedTotal,
      next_index: cursor,
      claimed_at: done || cancelled || paused ? null : new Date().toISOString(),
    })
    .eq("id", bulkId)
    .eq("user_id", userId);

  console.log(
    `[bulk] end bulkId=${bulkId} finalStatus=${finalStatus} cursor=${cursor} processedTotal=${processedTotal} sentThisTick=${sentThisTick} failedThisTick=${failedThisTick} processedThisTick=${processedThisTick}`,
  );

  return {
    sent: sentThisTick,
    failed: failedThisTick,
    total: contactIds.length,
    cancelled,
    paused,
    done,
    cursor,
  };
}

export function getEvolutionEnv() {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  return { apiUrl, apiKey };
}
