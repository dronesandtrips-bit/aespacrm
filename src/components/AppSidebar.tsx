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
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/contatos", label: "Contatos", icon: Users },
  { to: "/disparos", label: "Disparos", icon: Send },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/pipeline", label: "Pipeline", icon: Kanban },
  { to: "/whatsapp", label: "WhatsApp", icon: Smartphone },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

const WIDTH_KEY = "wpp-crm-sidebar-width";
const COLLAPSED_KEY = "wpp-crm-sidebar-collapsed";
const MIN = 200;
const MAX = 400;
const DEFAULT = 260;
const COLLAPSED = 72;

type Props = {
  /** Quando true, renderiza versão "interna" para usar dentro de um Sheet (mobile). */
  inSheet?: boolean;
  onNavigate?: () => void;
};

export function AppSidebar({ inSheet = false, onNavigate }: Props) {
  const location = useLocation();
  const [width, setWidth] = useState<number>(DEFAULT);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const dragging = useRef(false);

  useEffect(() => {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    if (w >= MIN && w <= MAX) setWidth(w);
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.max(MIN, Math.min(MAX, e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(WIDTH_KEY, String(width));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  const startDrag = (e: React.MouseEvent) => {
    if (collapsed || inSheet) return;
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  };

  const effectiveWidth = inSheet ? "100%" : collapsed ? COLLAPSED : width;
  const isCollapsed = !inSheet && collapsed;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        style={{ width: effectiveWidth }}
        className={cn(
          "shrink-0 flex flex-col border-r bg-card relative",
          inSheet ? "h-full" : "hidden md:flex",
        )}
      >
        <div className={cn("flex items-center gap-2 h-16 border-b px-4", isCollapsed && "justify-center px-0")}>
          <div className="size-9 rounded-xl bg-[image:var(--gradient-primary)] grid place-items-center text-primary-foreground shadow-[var(--shadow-elegant)] shrink-0">
            <MessageCircle className="size-5" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="font-bold text-sm leading-tight">ZapCRM</div>
              <div className="text-[11px] text-muted-foreground">WhatsApp Business</div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {items.map(({ to, label, icon: Icon }) => {
            const active =
              location.pathname === to || location.pathname.startsWith(to + "/");
            const link = (
              <Link
                key={to}
                to={to}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isCollapsed && "justify-center px-0",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!isCollapsed && <span className="truncate">{label}</span>}
              </Link>
            );
            if (isCollapsed) {
              return (
                <Tooltip key={to}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              );
            }
            return link;
          })}
        </nav>

        <div className={cn("p-3 border-t flex items-center gap-2", isCollapsed && "justify-center")}>
          {!inSheet && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              className="size-8 shrink-0"
              aria-label={collapsed ? "Expandir" : "Recolher"}
            >
              {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </Button>
          )}
          {!isCollapsed && (
            <span className="text-[11px] text-muted-foreground">v1.0 · Modo demo</span>
          )}
        </div>

        {!inSheet && !collapsed && (
          <div
            onMouseDown={startDrag}
            className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            role="separator"
            aria-orientation="vertical"
          />
        )}
      </aside>
    </TooltipProvider>
  );
}
