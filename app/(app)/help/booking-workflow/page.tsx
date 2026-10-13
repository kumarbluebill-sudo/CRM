import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, CornerUpLeft, OctagonX } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { PrintButton } from "@/components/help/print-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import {
  CANCELLATION_NOTES,
  DECISIONS,
  STATUS_MAP,
  STEPS,
  TRANSITIONS,
  type Branch,
} from "@/lib/help/booking-workflow";
import { BOOKING_STATUSES } from "@/lib/booking/schema";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Booking workflow" };

const Arrow = ({ text }: { text?: string }) => (
  <div className="text-muted-foreground flex flex-col items-center py-1 print:py-0.5" aria-hidden>
    {text && <span className="text-[11px]">{text}</span>}
    <ArrowDown className="size-5" />
  </div>
);

export default async function BookingWorkflowPage() {
  const session = await requireOrgSession();
  const can = (p?: string) => !p || session.permissions.has(p);

  const link = (href?: string, text?: string, permission?: string) =>
    href && text && can(permission) ? (
      <Link href={href} className="text-primary text-xs font-medium underline print:no-underline">
        {text}
      </Link>
    ) : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        breadcrumb={[{ label: "Help center", href: "/help" }, { label: "Booking workflow" }]}
        title="Booking workflow"
        description="How a customer goes from first enquiry to a completed trip. A reference guide for staff; it contains no customer information."
        actions={<PrintButton />}
      />

      <p
        role="note"
        className="bg-muted text-muted-foreground rounded-lg border px-3 py-2 text-sm print:border-0"
      >
        This chart is a guide. It does not change a booking&apos;s status by itself. Staff still
        move a booking from one status to the next on the booking page.
      </p>

      <Card className="break-inside-avoid">
        <CardHeader>
          <CardTitle className="text-base">Legend</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-2">
            <span className="bg-card inline-block h-6 w-10 rounded-md border-2" aria-hidden />
            Step
          </div>
          <div className="flex items-center gap-2">
            <span
              className="bg-card inline-block size-6 rotate-45 border-2 border-sky-600"
              aria-hidden
            />
            Decision
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-6 w-10 rounded-md border-2 border-dashed border-amber-600 bg-amber-50 dark:bg-amber-950"
              aria-hidden
            />
            Exception path
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-6 w-10 rounded-md border-2 border-emerald-600 bg-emerald-50 dark:bg-emerald-950"
              aria-hidden
            />
            Start / finish
          </div>
        </CardContent>
      </Card>

      <ol aria-label="Booking process" className="flex flex-col items-center">
        {STEPS.map((step, index) => {
          const decision = DECISIONS[step.id];
          const terminal = step.kind === "start" || step.kind === "end";
          return (
            <li key={step.id} className="flex w-full flex-col items-center">
              {index > 0 && <Arrow />}
              <div
                className={cn(
                  "w-full max-w-xl break-inside-avoid rounded-xl border-2 p-3",
                  terminal
                    ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950"
                    : "bg-card border-border",
                )}
              >
                <p className="text-sm font-semibold tracking-wide uppercase">
                  <span className="text-muted-foreground mr-2 font-mono text-xs">{index + 1}</span>
                  {step.title}
                </p>
                <p className="text-sm">{step.explain}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  {link(step.href, step.linkLabel, step.permission)}
                  {step.status && (
                    <span className="bg-muted rounded-full px-2 py-0.5 text-xs">
                      Booking status: {label(step.status)}
                    </span>
                  )}
                </div>
              </div>

              {decision && (
                <>
                  <Arrow />
                  <div className="w-full max-w-3xl break-inside-avoid">
                    <div className="mx-auto flex max-w-sm items-center justify-center">
                      <div className="relative w-full border-2 border-sky-600 bg-sky-50 px-6 py-5 text-center [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)] max-sm:rounded-xl max-sm:[clip-path:none] dark:bg-sky-950">
                        <p className="text-sm font-semibold">{decision.question}</p>
                      </div>
                    </div>
                    <p className="text-muted-foreground mt-2 text-center text-sm">
                      {decision.explain}
                    </p>
                    <ul
                      className={cn(
                        "mt-3 grid gap-3",
                        decision.branches.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
                      )}
                    >
                      {decision.branches.map((b) => (
                        <BranchCard key={b.label} branch={b} link={link} />
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <Card className="break-inside-avoid">
        <CardHeader>
          <CardTitle className="text-base">Booking statuses</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Statuses staff ask about and where they live in the CRM
              </caption>
              <thead className="text-muted-foreground border-b text-xs uppercase">
                <tr>
                  <th className="py-2 pr-3">You may call it</th>
                  <th className="py-2 pr-3">In the CRM</th>
                  <th className="py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {STATUS_MAP.map((s) => (
                  <tr key={s.asked} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3 font-medium">{s.asked}</td>
                    <td className="py-2 pr-3">{s.actual}</td>
                    <td className="text-muted-foreground py-2">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="mb-1 font-medium">Allowed changes</h2>
            <ul className="flex flex-col gap-1">
              {BOOKING_STATUSES.map((s) => (
                <li key={s}>
                  <span className="font-medium">{label(s)}</span>
                  {" → "}
                  {TRANSITIONS[s].length ? (
                    TRANSITIONS[s].map((t) => label(t)).join(" or ")
                  ) : (
                    <span className="text-muted-foreground">final, no further change</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-1 font-medium">Cancellations and refunds</h2>
            <ul className="list-disc pl-5">
              {CANCELLATION_NOTES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BranchCard({
  branch,
  link,
}: {
  branch: Branch;
  link: (href?: string, text?: string, permission?: string) => React.ReactNode;
}) {
  const Icon =
    branch.kind === "loop" ? CornerUpLeft : branch.kind === "exception" ? OctagonX : ArrowDown;
  return (
    <li
      className={cn(
        "break-inside-avoid rounded-xl border-2 p-3 text-sm",
        branch.kind === "exception" &&
          "border-dashed border-amber-600 bg-amber-50 dark:bg-amber-950",
        branch.kind === "loop" && "border-dashed border-sky-600 bg-sky-50/60 dark:bg-sky-950/60",
        branch.kind === "main" && "bg-card border-emerald-600",
      )}
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <Icon className="size-4 shrink-0" aria-hidden />
        {branch.label}
        <span className="text-muted-foreground text-xs font-normal">
          {branch.kind === "loop" ? "(go back)" : branch.kind === "exception" ? "(exception)" : ""}
        </span>
      </p>
      <p>{branch.result}</p>
      <div className="mt-1">{link(branch.href, branch.linkLabel, branch.permission)}</div>
    </li>
  );
}
