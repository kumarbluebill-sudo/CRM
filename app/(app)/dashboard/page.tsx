import type { Metadata } from "next";
import { CalendarClock, CreditCard, Inbox, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Dashboard" };

const METRICS = ["New Leads", "Hot Leads", "Quotes", "Bookings", "Revenue", "Outstanding"] as const;

const LISTS = [
  { title: "Today's Follow-ups", icon: CalendarClock },
  { title: "Upcoming Trips", icon: Inbox },
  { title: "Pending Payments", icon: CreditCard },
  { title: "Recent Leads", icon: UserPlus },
] as const;

export default function DashboardPage() {
  const today = new Intl.DateTimeFormat("en-IN", { dateStyle: "full" }).format(new Date());

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground text-sm">{today}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["New Lead", "New Customer", "New Quotation", "Create Itinerary"].map((label) => (
            <Button
              key={label}
              size="sm"
              variant="outline"
              disabled
              title="Available in a later phase"
            >
              <Plus className="size-4" aria-hidden />
              {label}
            </Button>
          ))}
        </div>
      </div>

      <section
        aria-label="Key metrics"
        className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
      >
        {METRICS.map((label) => (
          <Card key={label} size="sm">
            <CardHeader>
              <CardTitle className="text-muted-foreground text-xs font-medium">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground/60 text-2xl font-semibold">—</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section aria-label="Activity" className="grid gap-4 md:grid-cols-2">
        {LISTS.map(({ title, icon }) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <EmptyState
                icon={icon}
                title="Nothing to show yet"
                description="Data appears here once the CRM modules are live."
              />
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
