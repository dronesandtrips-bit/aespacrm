import { Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export function AppShell() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const focusMode = location.pathname === "/inbox" || location.pathname.startsWith("/inbox/");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      <AppSidebar focusMode={focusMode} />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-[280px] [&>button]:hidden">
          <AppSidebar inSheet onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex-1 flex flex-col min-w-0">
        {!focusMode && <AppHeader onMenuClick={() => setMobileOpen(true)} />}
        <main className={focusMode ? "flex-1 overflow-hidden" : "flex-1 p-4 sm:p-6 overflow-auto"}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
