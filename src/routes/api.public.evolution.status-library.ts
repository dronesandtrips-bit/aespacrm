import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getSupabaseAdmin, requireUserJwt } from "@/integrations/supabase/server";

const BUCKET = "crm-status-media";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const allowedMime = /^(image\/(jpeg|png|webp)|video\/(mp4|webm)|audio\/(mpeg|mp4|ogg|wav|webm))$/i;

async function authorized(request: Request) {
  const auth = await requireUserJwt(request);
  if ("error" in auth) return null;
  const { data } = await getSupabaseAdmin()
    .from("crm_allowed_users")
    .select("user_id")
    .eq("user_id", auth.userId)
    .maybeSingle();
  return data ? auth.userId : null;
}

async function ensureBucket(sb: any) {
  const { data } = await sb.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await sb.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_BYTES,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

const textSchema = z.object({
  action: z.literal("create_text"),
  content: z.string().trim().min(1).max(700),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#075E54"),
  font: z.number().int().min(0).max(5).default(1),
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), enabled: z.boolean(), intervalMinutes: z.number().int().min(60).max(10080) }),
  z.object({ action: z.literal("toggle"), id: z.string().uuid(), active: z.boolean() }),
  z.object({ action: z.literal("caption"), id: z.string().uuid(), caption: z.string().max(1024) }),
  z.object({ action: z.literal("content"), id: z.string().uuid(), content: z.string().trim().min(1).max(700), backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), font: z.number().int().min(0).max(5) }),
  z.object({ action: z.literal("reorder"), ids: z.array(z.string().uuid()).min(1).max(500) }),
]);

export const Route = createFileRoute("/api/public/evolution/status-library")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await authorized(request);
        if (!userId) return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
        const sb = getSupabaseAdmin();
        const [{ data: items, error }, { data: settings }, { data: history }, { data: runs, error: runsError }] = await Promise.all([
          sb.from("crm_status_media").select("id,type,content,storage_path,mime_type,file_name,caption,background_color,font,position,is_active,last_used_at,last_error,created_at").eq("user_id", userId).order("position"),
          sb.from("crm_status_settings").select("enabled,interval_minutes,last_published_at,last_error,processing_started_at").eq("user_id", userId).maybeSingle(),
          sb.from("crm_status_publications").select("id,media_id,status,error,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
          sb.from("crm_status_runs").select("id,media_id,status,next_index,recipients,error,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1),
        ]);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        if (runsError) return Response.json({ ok: false, error: runsError.message }, { status: 500 });
        if (!settings) {
          await sb.from("crm_status_settings").upsert({ user_id: userId, enabled: false, interval_minutes: 180 }, { onConflict: "user_id" });
        }
        await ensureBucket(sb);
        const withUrls = await Promise.all((items ?? []).map(async (item: any) => {
          if (!item.storage_path) return { ...item, preview_url: null };
          const { data } = await sb.storage.from(BUCKET).createSignedUrl(item.storage_path, 900);
          return { ...item, preview_url: data?.signedUrl ?? null };
        }));
        const recentRun = runs?.[0];
        return Response.json({ ok: true, items: withUrls, settings: settings ?? { enabled: false, interval_minutes: 180 }, history: history ?? [],
          run: recentRun ? { id: recentRun.id, mediaId: recentRun.media_id, status: recentRun.status,
            sent: recentRun.next_index, total: Array.isArray(recentRun.recipients) ? recentRun.recipients.length : 0,
            error: recentRun.error, createdAt: recentRun.created_at } : null });
      },
      POST: async ({ request }) => {
        const userId = await authorized(request);
        if (!userId) return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
        const sb = getSupabaseAdmin();
        const contentType = request.headers.get("content-type") ?? "";
        const { data: last } = await sb.from("crm_status_media").select("position").eq("user_id", userId).order("position", { ascending: false }).limit(1).maybeSingle();
        const position = Number(last?.position ?? -1) + 1;
        if (contentType.includes("multipart/form-data")) {
          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File) || file.size < 1 || file.size > MAX_FILE_BYTES || !allowedMime.test(file.type)) {
            return Response.json({ ok: false, error: "Arquivo inválido ou maior que 20 MB" }, { status: 400 });
          }
          const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "audio";
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
          const path = `${userId}/${crypto.randomUUID()}-${safeName}`;
          await ensureBucket(sb);
          const bytes = await file.arrayBuffer();
          const { error: uploadError } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
          if (uploadError) return Response.json({ ok: false, error: uploadError.message }, { status: 500 });
          const { data, error } = await sb.from("crm_status_media").insert({ user_id: userId, type, storage_path: path, mime_type: file.type, file_name: file.name, caption: String(form.get("caption") ?? "").slice(0, 1024) || null, position }).select("id").single();
          if (error) {
            await sb.storage.from(BUCKET).remove([path]);
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
          return Response.json({ ok: true, id: data.id });
        }
        const parsed = textSchema.safeParse(await request.json());
        if (!parsed.success) return Response.json({ ok: false, error: "Texto inválido" }, { status: 400 });
        const { data, error } = await sb.from("crm_status_media").insert({ user_id: userId, type: "text", content: parsed.data.content, background_color: parsed.data.backgroundColor, font: parsed.data.font, position }).select("id").single();
        return error ? Response.json({ ok: false, error: error.message }, { status: 500 }) : Response.json({ ok: true, id: data.id });
      },
      PATCH: async ({ request }) => {
        const userId = await authorized(request);
        if (!userId) return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
        const parsed = patchSchema.safeParse(await request.json());
        if (!parsed.success) return Response.json({ ok: false, error: "Alteração inválida" }, { status: 400 });
        const sb = getSupabaseAdmin();
        if (parsed.data.action === "settings") {
          if (parsed.data.enabled) {
            const { data: unresolved, error: runError } = await sb.from("crm_status_runs").select("id")
              .eq("user_id", userId).eq("status", "uncertain").limit(1).maybeSingle();
            if (runError) return Response.json({ ok: false, error: runError.message }, { status: 500 });
            if (unresolved) return Response.json({ ok: false, error: "Há uma publicação sem confirmação. Verifique a entrega antes de ativar o rodízio." }, { status: 409 });
          }
          const { error } = await sb.from("crm_status_settings").upsert({ user_id: userId, enabled: parsed.data.enabled, interval_minutes: parsed.data.intervalMinutes, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
          return error ? Response.json({ ok: false, error: error.message }, { status: 500 }) : Response.json({ ok: true });
        }
        if (parsed.data.action === "reorder") {
          const results = await Promise.all(parsed.data.ids.map((id, position) => sb.from("crm_status_media").update({ position, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId)));
          const failed = results.find((r: any) => r.error);
          return failed ? Response.json({ ok: false, error: failed.error.message }, { status: 500 }) : Response.json({ ok: true });
        }
        const patch = parsed.data.action === "toggle"
          ? { is_active: parsed.data.active }
          : parsed.data.action === "caption"
            ? { caption: parsed.data.caption.trim() || null }
            : { content: parsed.data.content, background_color: parsed.data.backgroundColor, font: parsed.data.font };
        const { error } = await sb.from("crm_status_media").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", parsed.data.id).eq("user_id", userId);
        return error ? Response.json({ ok: false, error: error.message }, { status: 500 }) : Response.json({ ok: true });
      },
      DELETE: async ({ request }) => {
        const userId = await authorized(request);
        if (!userId) return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
        const id = new URL(request.url).searchParams.get("id");
        if (!id || !z.string().uuid().safeParse(id).success) return Response.json({ ok: false, error: "Item inválido" }, { status: 400 });
        const sb = getSupabaseAdmin();
        const { data: item } = await sb.from("crm_status_media").select("storage_path").eq("id", id).eq("user_id", userId).maybeSingle();
        const { error } = await sb.from("crm_status_media").delete().eq("id", id).eq("user_id", userId);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        if (item?.storage_path) await sb.storage.from(BUCKET).remove([item.storage_path]);
        return Response.json({ ok: true });
      },
    },
  },
});
