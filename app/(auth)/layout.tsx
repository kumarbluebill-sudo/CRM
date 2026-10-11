import Image from "next/image";
import { CalendarCheck, FileText, Plane, ShieldCheck } from "lucide-react";

const POINTS = [
  { icon: FileText, text: "Quotations, itineraries and invoices in one place" },
  { icon: CalendarCheck, text: "Bookings, visas and follow-ups that never slip" },
  { icon: ShieldCheck, text: "Your agency's data stays private to your agency" },
];

function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
        <Plane className="size-5" aria-hidden />
      </span>
      <span className="text-lg font-semibold">Smart Travel CRM</span>
    </div>
  );
}

/**
 * Sign-in, registration and password pages. From large screens up, a travel illustration with the product's promise
 * sits beside the form; on phones and tablets only the form is shown, so nothing heavy loads.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <aside
        aria-label="About Smart Travel CRM"
        className="relative hidden overflow-hidden bg-[#0a2a5e] text-white lg:block"
      >
        <Image
          src="/login-art/travel-hero.svg"
          alt=""
          fill
          priority
          unoptimized
          sizes="55vw"
          className="object-cover"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/55 to-transparent px-12 pt-40 pb-12">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-white text-[#0a2a5e]">
              <Plane className="size-5" aria-hidden />
            </span>
            <span className="text-lg font-semibold">Smart Travel CRM</span>
          </div>
          <p className="mt-5 max-w-md text-3xl leading-tight font-semibold">
            Plan, quote and book every trip from one place.
          </p>
          <ul className="mt-6 flex max-w-md flex-col gap-3 text-sm text-white/90">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <Icon className="size-4 shrink-0" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main
        id="main"
        className="bg-background flex min-h-dvh flex-col items-center justify-center gap-6 p-4 sm:p-8"
      >
        <Brand className="lg:hidden" />
        <div className="bg-card w-full max-w-sm rounded-xl border p-6 shadow-sm">{children}</div>
        <p className="text-muted-foreground max-w-sm text-center text-xs">
          Need help? Ask your administrator, or open Help center after signing in.
        </p>
      </main>
    </div>
  );
}
