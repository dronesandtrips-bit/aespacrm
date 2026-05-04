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
  Search,
  GitBranch,
  Activity,
  BarChart3,
  FileText,
  Sparkles,
} from "lucide-react";

// Ícone oficial do WhatsApp (logo brand) — lucide não tem brand icons
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.04 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.886 9.884zm8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/explorar", label: "Explorar", icon: Search },
  { to: "/contatos", label: "Contatos", icon: Users },
  { to: "/disparos", label: "Disparos", icon: Send },
  { to: "/sequencias", label: "Sequências", icon: GitBranch },
  { to: "/sequencias-dashboard", label: "Métricas Seq.", icon: BarChart3 },
  { to: "/templates", label: "Templates", icon: FileText },
  { to: "/historico-ia", label: "Histórico IA", icon: Sparkles },
  { to: "/logs", label: "Logs", icon: Activity },
  { to: "/inbox", label: "WhatsWeb", icon: Inbox },
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
  /** Modo foco: força mini-sidebar; expande no hover como overlay. */
  focusMode?: boolean;
};

export function AppSidebar({ inSheet = false, onNavigate, focusMode = false }: Props) {
  const location = useLocation();
  const [width, setWidth] = useState<number>(DEFAULT);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hovered, setHovered] = useState<boolean>(false);
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

  
  const effectiveCollapsed = !inSheet && (collapsed || (focusMode && !hovered));
  const effectiveWidth = inSheet
    ? "100%"
    : focusMode
      ? hovered ? width : COLLAPSED
      : collapsed ? COLLAPSED : width;
  const isCollapsed = effectiveCollapsed;

  return (
    <TooltipProvider delayDuration={0}>
      {/* Spacer reserva o espaço da rail no focusMode para o conteúdo não pular */}
      {focusMode && !inSheet && (
        <div style={{ width: COLLAPSED }} className="shrink-0 hidden md:block" aria-hidden />
      )}
      <aside
        onMouseEnter={() => focusMode && setHovered(true)}
        onMouseLeave={() => focusMode && setHovered(false)}
        style={{ width: effectiveWidth }}
        className={cn(
          "shrink-0 flex flex-col border-r bg-card",
          inSheet ? "h-full" : "hidden md:flex",
          focusMode && !inSheet && "fixed inset-y-0 left-0 z-40 shadow-lg transition-[width] duration-200",
          !focusMode && "relative",
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
            <span className="text-[11px] text-muted-foreground">ZapCRM © 2026</span>
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
