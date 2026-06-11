import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "@/integrations/supabase/server";

const StartSchema = z.object({
  contact_id: z.string().uuid(),
  contact_name: z.string().max(200).optional().nullable(),
  contact_phone: z.string().max(32).optional().nullable(),
  request_payload: z.record(z.string(), z.any()).optional().nullable(),
});

export const logEnrichmentStart = createServerFn({ method: "POST" })
  .inputValidator((data) => StartSchema.parse(data))
  .handler(async ({ data }) => {
    const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
    if (!ownerUserId) {
      throw new Error("EVOLUTION_OWNER_USER_ID não configurado");
    }
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("crm_ai_enrichment_logs")
      .insert({
        user_id: ownerUserId,
        contact_id: data.contact_id,
        contact_name: data.contact_name ?? null,
        contact_phone: data.contact_phone ?? null,
        request_payload: data.request_payload ?? null,
        status: "dispatched",
        triggered_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      console.error("logEnrichmentStart error", error);
      throw new Error(error.message);
    }
    return { log_id: row.id as string };
  });

const FailSchema = z.object({
  log_id: z.string().uuid(),
  error_message: z.string().max(2000),
});

export const logEnrichmentFailure = createServerFn({ method: "POST" })
  .inputValidator((data) => FailSchema.parse(data))
  .handler(async ({ data }) => {
    const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
    if (!ownerUserId) {
      throw new Error("EVOLUTION_OWNER_USER_ID não configurado");
    }
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("crm_ai_enrichment_logs")
      .update({
        status: "error",
        error_message: data.error_message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", data.log_id)
      .eq("user_id", ownerUserId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ListSchema = z.object({
  limit: z.number().min(1).max(200).optional().default(100),
});

export const listEnrichmentLogs = createServerFn({ method: "GET" })
  .inputValidator((data) => ListSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
    if (!ownerUserId) {
      throw new Error("EVOLUTION_OWNER_USER_ID não configurado");
    }
    const sb = getSupabaseAdmin();

    // Auto-fail: marca como erro qualquer log "dispatched" há mais de 5 minutos.
    // Evita ficar "Disparado" pra sempre quando o n8n quebra antes de avisar.
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await sb
      .from("crm_ai_enrichment_logs")
      .update({
        status: "error",
        error_message: "Timeout: pipeline n8n não respondeu em 5min (auto-fail)",
        completed_at: new Date().toISOString(),
      })
      .eq("user_id", ownerUserId)
      .eq("status", "dispatched")
      .lt("triggered_at", cutoff);

    const { data: rows, error } = await sb
      .from("crm_ai_enrichment_logs")
      .select(
        "id, contact_id, contact_name, contact_phone, status, error_message, triggered_at, completed_at, created_at",
      )
      .eq("user_id", ownerUserId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { logs: rows ?? [] };
  });

const DeleteSchema = z
  .object({
    log_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    all: z.boolean().optional(),
  })
  .refine((d) => !!(d.log_id || d.contact_id || d.all), {
    message: "log_id, contact_id ou all=true é obrigatório",
  });

export const deleteEnrichmentLogs = createServerFn({ method: "POST" })
  .inputValidator((data) => DeleteSchema.parse(data))
  .handler(async ({ data }) => {
    const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
    if (!ownerUserId) {
      throw new Error("EVOLUTION_OWNER_USER_ID não configurado");
    }
    const sb = getSupabaseAdmin();
    let q = sb
      .from("crm_ai_enrichment_logs")
      .delete()
      .eq("user_id", ownerUserId);
    if (data.log_id) q = q.eq("id", data.log_id);
    else if (data.contact_id) q = q.eq("contact_id", data.contact_id);
    // se all=true sem outros filtros, deleta todos do owner
    const { error, count } = await q.select("id", { count: "exact" });
    if (error) throw new Error(error.message);
    return { ok: true, deleted: count ?? 0 };
  });
