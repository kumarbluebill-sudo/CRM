import { Plane } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main"
      className="bg-muted/40 flex min-h-dvh flex-col items-center justify-center gap-6 p-4"
    >
      <div className="flex items-center gap-2.5">
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
          <Plane className="size-5" aria-hidden />
        </span>
        <span className="text-lg font-semibold">Smart Travel CRM</span>
      </div>
      <div className="bg-card w-full max-w-sm rounded-xl border p-6 shadow-sm">{children}</div>
    </main>
  );
}
