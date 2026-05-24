// GET /api/public/link-preview?url=...
// Busca a URL e retorna metadados Open Graph / oEmbed para renderizar
// preview de link no inbox (estilo WhatsApp).
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

function pickMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    // <meta property="og:title" content="..."> ou name="..."
    const re = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`,
      "i",
    );
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
    const re2 = new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name)\\s*=\\s*["']${name}["']`,
      "i",
    );
    const m2 = html.match(re2);
    if (m2?.[1]) return decodeEntities(m2[1].trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function isSafeUrl(u: URL): boolean {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host === "0.0.0.0" ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
    return false;
  return true;
}

export const Route = createFileRoute("/api/public/link-preview")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: PUBLIC_CORS }),
      GET: async ({ request }) => {
        try {
          const u = new URL(request.url);
          const target = u.searchParams.get("url");
          if (!target) return jsonResponse({ error: "missing url" }, 400);
          let parsed: URL;
          try {
            parsed = new URL(target);
          } catch {
            return jsonResponse({ error: "invalid url" }, 400);
          }
          if (!isSafeUrl(parsed))
            return jsonResponse({ error: "blocked url" }, 400);

          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          let res: Response;
          try {
            res = await fetch(parsed.toString(), {
              method: "GET",
              redirect: "follow",
              signal: ctrl.signal,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (compatible; ZapCRMBot/1.0; +https://crm.aespa.com.br)",
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
              },
            });
          } finally {
            clearTimeout(t);
          }
          if (!res.ok) {
            return jsonResponse(
              { url: parsed.toString(), error: `http ${res.status}` },
              200,
            );
          }
          const ct = res.headers.get("content-type") ?? "";
          if (!ct.includes("html")) {
            return jsonResponse(
              { url: parsed.toString(), title: null, description: null, image: null, siteName: null },
              200,
            );
          }
          // Limita a 512KB para evitar abuso.
          const reader = res.body?.getReader();
          let html = "";
          if (reader) {
            const dec = new TextDecoder();
            let total = 0;
            const MAX = 512 * 1024;
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              total += value.byteLength;
              html += dec.decode(value, { stream: true });
              if (total >= MAX) {
                try {
                  await reader.cancel();
                } catch {}
                break;
              }
            }
          } else {
            html = await res.text();
          }

          const title =
            pickMeta(html, ["og:title", "twitter:title"]) ??
            (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null);
          const description = pickMeta(html, [
            "og:description",
            "twitter:description",
            "description",
          ]);
          let image = pickMeta(html, [
            "og:image:secure_url",
            "og:image",
            "twitter:image",
            "twitter:image:src",
          ]);
          const siteName = pickMeta(html, ["og:site_name", "application-name"]);

          if (image) {
            try {
              image = new URL(image, parsed).toString();
            } catch {
              image = null;
            }
          }

          return jsonResponse(
            {
              url: parsed.toString(),
              title: title ? title.slice(0, 300) : null,
              description: description ? description.slice(0, 500) : null,
              image,
              siteName: siteName ? siteName.slice(0, 120) : null,
            },
            200,
            { "Cache-Control": "public, max-age=86400" },
          );
        } catch (err: any) {
          return jsonResponse(
            { error: err?.message ?? "internal error" },
            200,
          );
        }
      },
    },
  },
});
