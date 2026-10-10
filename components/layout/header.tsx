import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { MobileNav } from "@/components/layout/mobile-nav";
import { QuickActions, SearchBox, type QuickAction } from "@/components/layout/header-actions";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/actions";
import type { ShellUser } from "@/components/layout/app-shell";

const initials = (name: string) =>
  name
    .split(/s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

export function Header({
  user,
  organizationName,
  quickActions,
  canSettings,
  slot,
}: {
  user: ShellUser;
  organizationName: string;
  quickActions: QuickAction[];
  canSettings: boolean;
  /** Extra header content (the notification bell arrives here). */
  slot?: React.ReactNode;
}) {
  return (
    <header className="bg-card flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-5 print:hidden">
      <MobileNav name={organizationName} />
      <p className="hidden max-w-48 truncate text-sm font-medium lg:block">{organizationName}</p>
      <SearchBox />
      <div className="flex-1" />
      <QuickActions actions={quickActions} />
      {slot}
      {canSettings && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Settings"
          nativeButton={false}
          render={<Link href="/settings" />}
        >
          <Settings className="size-4" aria-hidden />
        </Button>
      )}
      <Link
        href="/profile"
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 border-l pl-3 text-sm"
        aria-label="Your profile"
      >
        <span
          aria-hidden
          className="bg-tone-violet-soft text-tone-violet flex size-[30px] items-center justify-center rounded-full text-xs font-semibold"
        >
          {initials(user.name)}
        </span>
        <span className="text-foreground hidden max-w-32 truncate font-medium md:inline">
          {user.name}
        </span>
      </Link>
      <form action={logoutAction}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut className="size-4" aria-hidden />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </form>
    </header>
  );
}
