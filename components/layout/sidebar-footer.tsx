import Link from "next/link";
import { LogOut, Palette } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { ROW, ROW_IDLE } from "@/components/layout/nav-styles";
import type { ShellUser } from "@/components/layout/app-shell";
import { cn } from "@/lib/utils";

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

/**
 * Profile, appearance and sign-out, pinned to the bottom of the sidebar and of the mobile drawer. The avatar is
 * initials (not an image). Labels hide when the sidebar is collapsed, leaving aligned icons.
 */
export function SidebarFooter({ user }: { user: ShellUser }) {
  return (
    <div className="border-sidebar-border flex shrink-0 flex-col gap-0.5 border-t p-2.5">
      <Link
        href="/profile"
        title="Your profile"
        aria-label={`Your profile (${user.name})`}
        className={cn(ROW, ROW_IDLE, "h-12")}
      >
        <span
          aria-hidden
          className="bg-tone-violet-soft text-tone-violet grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
        >
          {initials(user.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col group-data-[collapsed=true]:hidden">
          <span className="truncate text-sm leading-tight font-semibold">{user.name}</span>
          <span className="truncate text-xs leading-tight font-normal">{user.email}</span>
        </span>
      </Link>
      <Link href="/profile/appearance" title="Appearance" className={cn(ROW, ROW_IDLE)}>
        <span className="grid size-5 shrink-0 place-items-center">
          <Palette className="size-[18px] [stroke-width:1.75]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate group-data-[collapsed=true]:sr-only">
          Appearance
        </span>
      </Link>
      <form action={logoutAction} className="w-full">
        <button type="submit" title="Sign out" className={cn(ROW, ROW_IDLE, "text-left")}>
          <span className="grid size-5 shrink-0 place-items-center">
            <LogOut className="size-[18px] [stroke-width:1.75]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate group-data-[collapsed=true]:sr-only">
            Sign out
          </span>
        </button>
      </form>
    </div>
  );
}
