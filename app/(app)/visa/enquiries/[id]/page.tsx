import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { StatusButtons } from "@/components/visa/visa-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listTeamMembers } from "@/lib/crm/queries";
import { uuid } from "@/lib/crm/schemas";
import { formatMoney } from "@/lib/quotation/pricing";
import { getEnquiry, listProducts } from "@/lib/visa/queries";
import { convertEnquiryAction } from "@/app/(app)/visa/actions";

export const metadata: Metadata = { title: "Visa enquiry" };

const NEXT: Record<string, string[]> = {
  NEW: ["CONTACTED", "QUOTATION_SENT", "FOLLOW_UP", "LOST", "CANCELLED"],
  CONTACTED: ["QUOTATION_SENT", "FOLLOW_UP", "LOST", "CANCELLED"],
  QUOTATION_SENT: ["FOLLOW_UP", "LOST", "CANCELLED"],
  FOLLOW_UP: ["CONTACTED", "QUOTATION_SENT", "LOST", "CANCELLED"],
};

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const e = await getEnquiry(id);
  if (!e) notFound();
  const [team, products] = await Promise.all([
    listTeamMembers(),
    listProducts({ activeOnly: true }),
  ]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const open = e.status !== "CONVERTED" && e.status !== "LOST" && e.status !== "CANCELLED";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={e.enquiry_number}
        description={`${e.customers?.name ?? "Customer"}${e.visa_countries?.name ? ` · ${e.visa_countries.name}` : ""}`}
        actions={
          <>
            <StatusBadge value={e.status} />
            <StatusBadge value={e.priority} />
          </>
        }
      />
      <Card>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Customer", e.customers?.name],
            ["Phone", e.customers?.phone],
            ["Email", e.customers?.email],
            ["Destination", e.visa_countries?.name],
            ["Nationality", e.nationality],
            ["Travel date", e.travel_date],
            ["Travellers", String(e.travellers)],
            ["Source", e.source],
            ["Assigned to", e.assigned_to ? names.get(e.assigned_to) : "Unassigned"],
            ["Follow up on", e.follow_up_date],
          ].map(([k, v]) => (
            <div key={k as string}>
              <p className="text-muted-foreground text-xs">{k}</p>
              <p>{v || "–"}</p>
            </div>
          ))}
          {e.notes && (
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="text-muted-foreground text-xs">Notes</p>
              <p className="whitespace-pre-line">{e.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {open && session.permissions.has("visa.edit") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Move this enquiry</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusButtons
              applicationId={id}
              next={NEXT[e.status] ?? []}
              canProcess
              kind="enquiry"
            />
          </CardContent>
        </Card>
      )}

      {e.status === "CONVERTED" && e.converted_application_id && (
        <p className="text-sm">
          Converted to{" "}
          <Link
            href={`/visa/applications/${e.converted_application_id}`}
            className="text-primary underline"
          >
            its visa application
          </Link>
          .
        </p>
      )}

      {open && session.permissions.has("visa.create") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Convert to a visa application</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              Creates the application with its first traveller and the document checklist for the
              chosen product.
              {!e.product_id && " Choose the visa product now."}
            </p>
            <EntityForm
              action={convertEnquiryAction.bind(null, id)}
              submitLabel="Convert to application"
              fields={[
                {
                  name: "productId",
                  label: "Visa product",
                  type: "select",
                  required: !e.product_id,
                  wide: true,
                  defaultValue: e.product_id,
                  options: products.map((p) => ({
                    value: p.id,
                    label: `${p.visa_countries?.name ?? ""} · ${label(p.visa_type)} · ${label(p.entry_type)}${p.unit_price != null ? ` · ${formatMoney(p.unit_price, p.currency)}` : ""}`,
                  })),
                },
                {
                  name: "nationality",
                  label: "Nationality",
                  required: !e.nationality,
                  defaultValue: e.nationality,
                },
              ]}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
