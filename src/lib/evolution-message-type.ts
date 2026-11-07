// Cópia fiel do detector de tipo usado no webhook da Evolution, para que as
// mensagens recuperadas apareçam no chat exatamente como as recebidas ao vivo.

export function detectMessageType(msg: any): {
  type: string;
  body: string;
  media_url: string | null;
  media_mime: string | null;
  media_caption: string | null;
} {
  // Baileys envelopes: alguns tipos vêm wrappeados (ex.: documentWithCaptionMessage,
  // ephemeralMessage, viewOnceMessage, viewOnceMessageV2). Desempacotamos antes.
  let m = msg?.message ?? {};
  for (let i = 0; i < 4; i++) {
    const inner =
      m?.documentWithCaptionMessage?.message ??
      m?.ephemeralMessage?.message ??
      m?.viewOnceMessage?.message ??
      m?.viewOnceMessageV2?.message ??
      m?.viewOnceMessageV2Extension?.message ??
      m?.editedMessage?.message ??
      null;
    if (!inner) break;
    m = inner;
  }

  if (m.conversation) {
    return { type: "text", body: m.conversation, media_url: null, media_mime: null, media_caption: null };
  }
  if (m.extendedTextMessage?.text) {
    return { type: "text", body: m.extendedTextMessage.text, media_url: null, media_mime: null, media_caption: null };
  }
  if (m.imageMessage) {
    return {
      type: "image",
      body: m.imageMessage.caption ?? "[imagem]",
      media_url: m.imageMessage.url ?? null,
      media_mime: m.imageMessage.mimetype ?? null,
      media_caption: m.imageMessage.caption ?? null,
    };
  }
  if (m.videoMessage) {
    return {
      type: "video",
      body: m.videoMessage.caption ?? "[vídeo]",
      media_url: m.videoMessage.url ?? null,
      media_mime: m.videoMessage.mimetype ?? null,
      media_caption: m.videoMessage.caption ?? null,
    };
  }
  if (m.audioMessage) {
    return {
      type: "audio",
      body: "[áudio]",
      media_url: m.audioMessage.url ?? null,
      media_mime: m.audioMessage.mimetype ?? null,
      media_caption: null,
    };
  }
  if (m.documentMessage) {
    return {
      type: "document",
      body: m.documentMessage.fileName ?? "[documento]",
      media_url: m.documentMessage.url ?? null,
      media_mime: m.documentMessage.mimetype ?? null,
      media_caption: m.documentMessage.caption ?? null,
    };
  }
  if (m.stickerMessage) {
    return { type: "sticker", body: "[sticker]", media_url: m.stickerMessage.url ?? null, media_mime: m.stickerMessage.mimetype ?? null, media_caption: null };
  }
  if (m.locationMessage || m.liveLocationMessage) {
    const loc = m.locationMessage ?? m.liveLocationMessage;
    const lat = loc.degreesLatitude ?? loc.latitude ?? null;
    const lng = loc.degreesLongitude ?? loc.longitude ?? null;
    const name = (loc.name ?? "").toString().trim();
    const address = (loc.address ?? "").toString().trim();
    const isLive = !!m.liveLocationMessage;
    const mapsUrl =
      lat != null && lng != null
        ? `https://www.google.com/maps?q=${lat},${lng}`
        : null;
    const label = [isLive ? "Localização em tempo real" : "", name, address].filter(Boolean).join(" — ");
    return {
      type: "location",
      body: label || (isLive ? "[localização ao vivo]" : "[localização]"),
      media_url: mapsUrl,
      media_mime: lat != null && lng != null ? `geo:${lat},${lng}` : null,
      media_caption: label || null,
    };
  }
  if (m.contactMessage) {
    const displayName = (m.contactMessage.displayName ?? "").toString().trim();
    const vcard = (m.contactMessage.vcard ?? "").toString();
    const telMatch = vcard.match(/TEL[^:]*:([+\d\s()-]+)/i);
    const phone = telMatch ? telMatch[1].trim() : "";
    const label = [displayName, phone].filter(Boolean).join(" — ") || "Contato compartilhado";
    return {
      type: "contact",
      body: label,
      media_url: null,
      media_mime: "text/vcard",
      media_caption: vcard || label,
    };
  }
  if (m.contactsArrayMessage) {
    const arr = Array.isArray(m.contactsArrayMessage.contacts) ? m.contactsArrayMessage.contacts : [];
    const names = arr.map((c: any) => (c?.displayName ?? "").toString().trim()).filter(Boolean);
    const label = names.length ? `Contatos: ${names.join(", ")}` : "Contatos compartilhados";
    return {
      type: "contact",
      body: label,
      media_url: null,
      media_mime: "text/vcard",
      media_caption: JSON.stringify(arr).slice(0, 4000),
    };
  }
  if (m.reactionMessage) {
    return { type: "reaction", body: m.reactionMessage.text ?? "👍", media_url: null, media_mime: null, media_caption: null };
  }
  return { type: "unknown", body: "[mensagem não suportada]", media_url: null, media_mime: null, media_caption: null };
}
