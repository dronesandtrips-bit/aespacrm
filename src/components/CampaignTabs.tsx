import { Link, useLocation } from "@tanstack/react-router";
import { Send, GitBranch, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export const CAMPAIGN_PATHS = ["/disparos", "/sequencias", "/sequencias-dashboard"] as const;

const tabs = [
  { to: "/disparos", label: "Disparo Avulso", icon: Send },
  { to: "/sequencias", label: "Sequências", icon: GitBranch },
  { to: "/sequencias-dashboard", label: "Acompanhamento", icon: BarChart3 },
] as const;

/** Abas da central "Campanhas & Sequências" — apenas navegação entre as telas existentes. */
export function CampaignTabs() {
  const { pathname } = useLocation();
  if (!CAMPAIGN_PATHS.some((p) => pathname === p)) return null;
  return (
    <nav aria-label="Campanhas & Sequências" className="mb-4 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1">
      {tabs.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          preload="intent"
          className={cn(
            "flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            pathname === to
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
