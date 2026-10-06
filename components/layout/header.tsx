import { MobileNav } from "@/components/layout/mobile-nav";

export function Header() {
  return (
    <header className="bg-card flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
      <MobileNav />
      <div className="flex-1" />
      {/* User menu and organization switcher arrive with authentication (Phase 2). */}
    </header>
  );
}
