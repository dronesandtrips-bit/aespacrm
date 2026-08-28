// Redirecionador público /m/$q — abre o Google Maps do endereço codificado.
// Usado nos links curtos das mensagens de agendamento no WhatsApp.
import { createFileRoute } from "@tanstack/react-router";
import { buildGoogleMapsUrl, decodeMapsCode } from "@/lib/maps-link";

export const Route = createFileRoute("/m/$q")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const location = decodeMapsCode(params.q);
        if (!location) return new Response("Link inválido", { status: 404 });
        return new Response(null, {
          status: 302,
          headers: {
            Location: buildGoogleMapsUrl(location),
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex, nofollow",
          },
        });
      },
    },
  },
});
