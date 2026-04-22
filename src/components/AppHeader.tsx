import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, Menu, User } from "lucide-react";
import { useNavigate, useLocation } from "@tanstack/react-router";

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/contatos": "Contatos",
  "/disparos": "Disparos em Massa",
  "/inbox": "Inbox",
  "/pipeline": "Pipeline",
  "/whatsapp": "WhatsApp Connect",
  "/configuracoes": "Configurações",
};

type Props = { onMenuClick?: () => void };

export function AppHeader({ onMenuClick }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const title = titles[pathname] ?? "ZapCRM";

  return (
    <header className="h-16 border-b bg-card/80 backdrop-blur sticky top-0 z-10 flex items-center justify-between px-4 sm:px-6 gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden shrink-0"
          onClick={onMenuClick}
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate">{title}</h1>
          <p className="text-xs text-muted-foreground truncate">
            Bem-vindo de volta, {user?.name}
          </p>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 shrink-0">
            <div className="size-8 rounded-full bg-primary/10 grid place-items-center text-primary text-sm font-semibold">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <span className="hidden sm:inline text-sm">{user?.email}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Minha conta</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <User className="size-4 mr-2" /> Perfil
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              logout();
              navigate({ to: "/login" });
            }}
          >
            <LogOut className="size-4 mr-2" /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
