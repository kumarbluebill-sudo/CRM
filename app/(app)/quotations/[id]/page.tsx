import type { Metadata } from "next";
import { LocalTime } from "@/components/datetime/local-time";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { ConvertToBookingButton } from "@/components/booking/convert-button";
import { QuotationBuilder } from "@/components/quotation/builder";
import { QuotationStatusActions } from "@/components/quotation/status-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { uuid } from "@/lib/crm/schemas";
import { getQuotationDocument, listQuotationVersions } from "@/lib/quotation/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Quotation" };

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const doc = await getQuotationDocument(id, true); // null for missing or other-organization ids (RLS)
  if (!doc) notFound();
  const versions = await listQuotationVersions(id);

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("id, name")
    .eq("id", doc.customerId as string)
    .maybeSingle();

  const status = String(doc.status);
  const editable =
    ["DRAFT", "NEGOTIATION"].includes(status) && session.permissions.has("quotes.update");
  // The server decides what the user may see; the client only renders what it was given.
  const canSeeCost = doc.canSeeCost === true;
  const canSeeProfit = doc.canSeeProfit === true;
  const perms = ["quotes.send", "quotes.update"].filter((p) => session.permissions.has(p));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={String(doc.title)}
        description={`${String(doc.number)} · ${customer?.name ?? "Customer"}${doc.validUntil ? ` · valid until ${String(doc.validUntil)}` : ""}`}
        actions={
          <>
            <StatusBadge value={status} />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={`/api/quotations/${id}/pdf`} target="_blank" rel="noopener" />}
            >
              <Download className="size-4" aria-hidden /> PDF
            </Button>
            {status === "APPROVED" && session.permissions.has("bookings.create") && (
              <ConvertToBookingButton quotationId={id} />
            )}
            <QuotationStatusActions
              id={id}
              status={status}
              permissions={perms}
              canDelete={session.permissions.has("quotes.delete")}
            />
          </>
        }
      />
      {!editable && (
        <p
          role="note"
          className="border-tone-warn/30 bg-tone-warn-soft text-tone-warn rounded-lg border p-3 text-sm"
        >
          {["DRAFT", "NEGOTIATION"].includes(status)
            ? "You have read-only access to this quotation."
            : "This quotation is locked. Move it to negotiation to make changes."}
        </p>
      )}
      <QuotationBuilder
        key={`${id}-${String(doc.version)}-${status}`}
        id={id}
        initial={doc}
        canEdit={editable}
        canSeeCost={canSeeCost}
        canSeeProfit={canSeeProfit}
        currency={String(doc.currency)}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version history</CardTitle>
        </CardHeader>
        <CardContent>
          {versions.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Snapshots are saved when you send, approve, change a price or click “Save version”.
            </p>
          )}
          <ul className="flex flex-col gap-2 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex justify-between gap-2">
                <span>
                  v{v.version_number} · {v.label ?? "Snapshot"}
                </span>
                <span className="text-muted-foreground">
                  <LocalTime value={v.created_at} />
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {doc.itineraryId ? (
        <p className="text-xs">
          <Link className="text-primary underline" href={`/itineraries/${String(doc.itineraryId)}`}>
            Open linked itinerary
          </Link>
        </p>
      ) : null}
    </div>
  );
}
