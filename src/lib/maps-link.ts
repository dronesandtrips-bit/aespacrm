// Link curto de mapa para mensagens de agendamento no WhatsApp.
// Em vez de mandar a URL enorme do Google Maps (que ainda gera um cartão de
// preview gigante), enviamos https://<dominio>/m/<code>, que redireciona.
// Aditivo: não altera nenhum fluxo existente.

function base64urlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeMapsCode(code: string): string | null {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes).trim();
    return text.length ? text : null;
  } catch {
    return null;
  }
}

export function buildGoogleMapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/** URL curta pública que redireciona para o Google Maps do endereço. */
export function buildShortMapsUrl(location: string | null | undefined): string | null {
  const loc = (location ?? "").trim();
  if (!loc) return null;
  const base =
    process.env["ZAPCRM_PUBLIC_URL"]?.trim().replace(/\/+$/, "") ?? "https://crm.aespa.com.br";
  return `${base}/m/${base64urlEncode(loc)}`;
}
