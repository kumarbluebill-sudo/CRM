import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { logoutAction } from "@/app/(auth)/actions";

export const metadata: Metadata = {
  title: { default: "Platform admin", template: "%s · Platform admin" },
  robots: { index: false, follow: false },
};

/** Separate from the agency app: no agency data, only plans and subscriptions, for platform administrators. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="bg-background min-h-dvh">
      <header className="bg-card flex h-14 items-center gap-4 border-b px-5">
        <p className="text-sm font-semibold">Platform admin</p>
        <nav aria-label="Platform" className="flex gap-3 text-sm">
          <Link href="/admin/organizations" className="hover:underline">
            Agencies
          </Link>
          <Link href="/admin/plans" className="hover:underline">
            Plans
          </Link>
        </nav>
        <div className="flex-1" />
        <span className="text-muted-foreground hidden text-xs sm:inline">{admin.email}</span>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <main className="mx-auto max-w-6xl p-5">{children}</main>
    </div>
  );
}
