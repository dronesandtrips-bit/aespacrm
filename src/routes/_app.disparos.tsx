import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Construction } from "lucide-react";

function Soon({ title }: { title: string }) {
  return (
    <Card className="p-12 text-center max-w-2xl mx-auto">
      <Construction className="size-12 mx-auto text-primary mb-4" />
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground">
        Esta seção será construída na próxima iteração. A fundação (auth, layout, dashboard
        e contatos) já está pronta para você validar.
      </p>
    </Card>
  );
}

export const Route = createFileRoute("/_app/disparos")({
  component: () => <Soon title="Disparos em Massa" />,
});
