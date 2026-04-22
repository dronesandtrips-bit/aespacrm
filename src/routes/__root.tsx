import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Voltar ao início
        </a>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ZapCRM — WhatsApp CRM & Marketing" },
      {
        name: "description",
        content:
          "Plataforma profissional de automação e gestão de vendas via WhatsApp. Disparos, pipeline e CRM.",
      },
      { property: "og:title", content: "ZapCRM — WhatsApp CRM & Marketing" },
      { name: "twitter:title", content: "ZapCRM — WhatsApp CRM & Marketing" },
      { name: "description", content: "A web application for WhatsApp CRM and sales automation, managing contacts, sending bulk messages, and tracking sales pipelines." },
      { property: "og:description", content: "A web application for WhatsApp CRM and sales automation, managing contacts, sending bulk messages, and tracking sales pipelines." },
      { name: "twitter:description", content: "A web application for WhatsApp CRM and sales automation, managing contacts, sending bulk messages, and tracking sales pipelines." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/b74f0b52-3050-41c2-8887-8c3c0b1baf07/id-preview-d6654487--5dc251ad-274a-4973-8802-237a0d651136.lovable.app-1776820094777.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/b74f0b52-3050-41c2-8887-8c3c0b1baf07/id-preview-d6654487--5dc251ad-274a-4973-8802-237a0d651136.lovable.app-1776820094777.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
