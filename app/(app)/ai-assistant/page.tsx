import type { Metadata } from "next";
import { AlertTriangle, Bot } from "lucide-react";
import { AssistantForm } from "@/components/ai/assistant-form";
import { ItineraryDraftForm } from "@/components/ai/itinerary-form";
import { PageHeader } from "@/components/crm/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { uuid } from "@/lib/crm/schemas";
import { isAiConfigured } from "@/lib/import/ai";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "AI Assistant" };

export default async function AiAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string; lead?: string }>;
}) {
  const session = await requireOrgSession();
  if (!session.permissions.has("ai.use")) {
    return (
      <EmptyState
        icon={Bot}
        title="No access"
        description="You don't have permission to use the AI assistant."
      />
    );
  }
  const sp = await searchParams;
  const supabase = await createClient();
  const canBookings = session.permissions.has("bookings.view");
  const canLeads = session.permissions.has("leads.view");
  const [bookings, leads] = await Promise.all([
    canBookings
      ? supabase
          .from("bookings")
          .select("id, booking_number, title")
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
    canLeads
      ? supabase
          .from("leads")
          .select("id, title, destination")
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
  ]);
  const bookingOpts = (bookings.data ?? []).map((b) => ({
    value: b.id as string,
    label: `${b.booking_number} · ${b.title}`,
  }));
  const leadOpts = (leads.data ?? []).map((l) => ({
    value: l.id as string,
    label: `${l.title}${l.destination ? ` · ${l.destination}` : ""}`,
  }));
  const initialId = [sp.booking, sp.lead].find((v) => v && uuid.safeParse(v).success);
  const initialType = sp.lead && !sp.booking ? "LEAD" : "BOOKING";
  const configured = isAiConfigured();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="AI Assistant"
        description="Summaries, message drafts and answers about a booking or lead. It only reads records you can open and never changes anything."
      />
      <div
        role="note"
        className="border-tone-warn/30 bg-tone-warn-soft text-tone-warn flex gap-3 rounded-lg border p-4 text-sm"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          AI can be wrong. Always check its output against the record before sending or acting on
          it. Contact details, passport data and supplier costs are never shared with the AI
          service.
        </p>
      </div>
      {!configured && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          AI isn&apos;t set up yet. An admin needs to add <code>OPENAI_API_KEY</code>. Everything
          else in the CRM works without it.
        </p>
      )}
      {configured && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ask the assistant</CardTitle>
            </CardHeader>
            <CardContent>
              <AssistantForm
                bookings={bookingOpts}
                leads={leadOpts}
                initialType={initialType}
                initialId={initialId}
              />
            </CardContent>
          </Card>
          {session.permissions.has("itineraries.create") && canLeads && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Draft an itinerary from a lead</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-muted-foreground text-sm">
                  Creates a suggestion you review and edit like an imported document. It can&apos;t
                  be published until you confirm you&apos;ve checked it.
                </p>
                <ItineraryDraftForm leads={leadOpts} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
