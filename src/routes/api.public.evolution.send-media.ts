// POST /api/public/evolution/send-media
// Envia mídia (imagem, vídeo, documento, áudio) via Evolution API (instância `zapcrm`).
// Body: { number, mediatype: "image"|"video"|"document"|"audio", media: <url|base64>, caption?, fileName?, mimetype? }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const INSTANCE = "zapcrm";

const MediaSchema = z.object({
  number: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .regex(/^\+?\d+$/),
  mediatype: z.enum(["image", "video", "document", "audio"]),
  // Pode ser URL https:// OU base64 puro
  media: z.string().trim().min(1).max(20_000_000),
  caption: z.string().trim().max(1024).optional(),
  fileName: z.string().trim().min(1).max(255).optional(),
  mimetype: z.string().trim().min(3).max(100).optional(),
  delay: z.number().int().min(0).max(20000).optional(),
});

export const Route = createFileRoute("/api/public/evolution/send-media")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        if (!apiUrl || !apiKey) {
          return Response.json(
            { ok: false, error: "EVOLUTION_API_URL/KEY não configurado" },
            { status: 500 },
          );
        }

        let parsed;
        try {
          parsed = MediaSchema.parse(await request.json());
        } catch (e: any) {
          return Response.json(
            { ok: false, error: "payload inválido", detail: e?.message ?? String(e) },
            { status: 400 },
          );
        }

        const number = parsed.number.replace(/^\+/, "");

        // Áudio usa endpoint dedicado /message/sendWhatsAppAudio
        if (parsed.mediatype === "audio") {
          const res = await fetch(`${apiUrl}/message/sendWhatsAppAudio/${INSTANCE}`, {
            method: "POST",
            headers: { apikey: apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              number,
              audio: parsed.media,
              delay: parsed.delay ?? 0,
            }),
          });
          const text = await res.text();
          let data: any = text;
          try { data = JSON.parse(text); } catch {}
          if (!res.ok) {
            return Response.json({ ok: false, status: res.status, error: data }, { status: 502 });
          }
          return Response.json({ ok: true, instance: INSTANCE, data });
        }

        // image / video / document → /message/sendMedia
        const res = await fetch(`${apiUrl}/message/sendMedia/${INSTANCE}`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            number,
            mediatype: parsed.mediatype,
            media: parsed.media,
            caption: parsed.caption,
            fileName: parsed.fileName,
            mimetype: parsed.mimetype,
            delay: parsed.delay ?? 0,
          }),
        });

        const text = await res.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch {}

        if (!res.ok) {
          return Response.json(
            { ok: false, status: res.status, error: data },
            { status: 502 },
          );
        }

        return Response.json({
          ok: true,
          instance: INSTANCE,
          messageId: data?.key?.id ?? null,
          data,
        });
      },
    },
  },
});
