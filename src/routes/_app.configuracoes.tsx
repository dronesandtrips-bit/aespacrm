import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/_app/configuracoes")({
  component: () => (
    <Card className="p-12 text-center max-w-2xl mx-auto">
      <Construction className="size-12 mx-auto text-primary mb-4" />
      <h2 className="text-xl font-semibold mb-2">Configurações</h2>
      <p className="text-sm text-muted-foreground">Em breve.</p>
    </Card>
  ),
});
