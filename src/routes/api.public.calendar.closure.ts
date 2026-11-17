import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AGENDA_CONFIG_KEY, AGENDA_DIGEST_PREFIX } from "@/lib/agenda-closure";
export const Route = createFileRoute("/api/public/calendar/closure")({ server: { handlers: {
  GET: async ({ request }) => {
    const { requireUserJwt, getSupabaseAdmin } = await import("@/integrations/supabase/server");
    const auth = await requireUserJwt(request);
    if ("error" in auth) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
    if (auth.userId !== process.env.EVOLUTION_OWNER_USER_ID?.trim()) return Response.json({ ok: false, error: "Somente o proprietário da agenda" }, { status: 403 });
    try {
      const sb = getSupabaseAdmin();
      const { closureEvents } = await import("@/server/agenda-closure.server");
      const { data, error } = await sb.from("crm_app_secrets").select("name,value").eq("user_id", auth.userId)
        .or(`name.eq.${AGENDA_CONFIG_KEY},name.like.${AGENDA_DIGEST_PREFIX}%`).order("name", { ascending: false }).limit(10);
      if (error) throw new Error(error.message);
      const config = data?.find((r: any) => r.name === AGENDA_CONFIG_KEY);
      const last = data?.find((r: any) => r.name.startsWith(AGENDA_DIGEST_PREFIX));
      return Response.json({ ok: true, enabled: config ? JSON.parse(config.value).enabled : false, events: await closureEvents(sb, auth.userId),
        lastDigest: last ? JSON.parse(last.value) : null }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return Response.json({ ok: false, error: String(error) }, { status: 500 }); }
  },
  POST: async ({ request }) => {
    const { requireUserJwt, getSupabaseAdmin } = await import("@/integrations/supabase/server");
    const auth = await requireUserJwt(request);
    if ("error" in auth) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
    if (auth.userId !== process.env.EVOLUTION_OWNER_USER_ID?.trim()) return Response.json({ ok: false, error: "Somente o proprietário da agenda" }, { status: 403 });
    const parsed = z.discriminatedUnion("action", [
      z.object({ action: z.literal("configure"), enabled: z.boolean() }),
      z.object({ action: z.literal("status"), eventId: z.string().min(1).max(200), status: z.enum(["completed", "reschedule", "no_show", "open"]) }),
    ]).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, error: "Dados inválidos" }, { status: 400 });
    try {
      const sb = getSupabaseAdmin();
      if (parsed.data.action === "configure") {
        const { error } = await sb.from("crm_app_secrets").upsert({ user_id: auth.userId, name: AGENDA_CONFIG_KEY,
          value: JSON.stringify({ enabled: parsed.data.enabled, hour: 18, timeZone: "America/Sao_Paulo" }), updated_at: new Date().toISOString() }, { onConflict: "user_id,name" });
        if (error) throw new Error(error.message);
        return Response.json({ ok: true });
      }
      const { setClosure } = await import("@/server/agenda-closure.server");
      return Response.json({ ok: true, ...await setClosure(sb, auth.userId, parsed.data.eventId, parsed.data.status) });
    } catch (error) { return Response.json({ ok: false, error: String(error) }, { status: 500 }); }
  },
} } });