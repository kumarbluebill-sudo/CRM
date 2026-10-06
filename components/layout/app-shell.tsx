import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";

export type ShellUser = { name: string; email: string };

export function AppShell({
  children,
  user,
  organizationName,
  banner,
}: {
  children: React.ReactNode;
  user: ShellUser;
  organizationName: string;
  banner?: React.ReactNode;
}) {
  return (
    <div className="bg-muted/40 flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} organizationName={organizationName} />
        {banner}
        <main id="main" className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
