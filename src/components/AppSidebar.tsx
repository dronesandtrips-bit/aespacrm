import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Send,
  Inbox,
  Kanban,
  Settings,
  Smartphone,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/contatos", label: "Contatos", icon: Users },
  { to: "/disparos", label: "Disparos", icon: Send },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/pipeline", label: "Pipeline", icon: Kanban },
  { to: "/whatsapp", label: "WhatsApp", icon: Smartphone },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function AppSidebar() {
  const location = useLocation();
  return (
    <aside className="hidden md:flex w-[260px] shrink-0 flex-col border-r bg-card">
      <div className="flex items-center gap-2 px-6 h-16 border-b">
        <div className="size-9 rounded-xl bg-[image:var(--gradient-primary)] grid place-items-center text-primary-foreground shadow-[var(--shadow-elegant)]">
          <MessageCircle className="size-5" />
        </div>
        <div>
          <div className="font-bold text-sm leading-tight">ZapCRM</div>
          <div className="text-[11px] text-muted-foreground">WhatsApp Business</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map(({ to, label, icon: Icon }) => {
          const active =
            location.pathname === to || location.pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t text-xs text-muted-foreground">
        v1.0 · Modo demo
      </div>
    </aside>
  );
}
