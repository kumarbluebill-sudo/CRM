import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/actions";
import type { ShellUser } from "@/components/layout/app-shell";

export function Header({ user, organizationName }: { user: ShellUser; organizationName: string }) {
  return (
    <header className="bg-card flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
      <MobileNav />
      <p className="truncate text-sm font-medium">{organizationName}</p>
      <div className="flex-1" />
      <Link
        href="/profile"
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm"
      >
        <UserRound className="size-4" aria-hidden />
        <span className="hidden max-w-40 truncate sm:inline">{user.name}</span>
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
