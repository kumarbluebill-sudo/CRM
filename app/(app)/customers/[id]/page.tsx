import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { customerFields } from "@/components/crm/customer-fields";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { getCustomer, listCustomerLeads } from "@/lib/crm/queries";
import { uuid } from "@/lib/crm/schemas";
import { updateCustomerAction } from "@/app/(app)/customers/actions";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const customer = await getCustomer(id); // RLS: null for missing or other-organization ids
  if (!customer) notFound();
  const leads = await listCustomerLeads(id);
  const canUpdate = session.permissions.has("customers.update");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={customer.name}
        description={[customer.city, customer.country].filter(Boolean).join(", ") || undefined}
        actions={
          session.permissions.has("leads.create") && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href={`/leads/new?customer=${id}`} />}
            >
              <Plus className="size-4" aria-hidden /> New lead
            </Button>
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="bg-card rounded-xl border p-5 lg:col-span-2">
          {canUpdate ? (
            <EntityForm
              action={updateCustomerAction.bind(null, id)}
              submitLabel="Save changes"
              fields={customerFields(customer)}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              You have read-only access to this customer.
            </p>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads & trips</CardTitle>
          </CardHeader>
          <CardContent>
            {leads.length === 0 && <p className="text-muted-foreground text-sm">No leads yet.</p>}
            <ul className="flex flex-col gap-3">
              {leads.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-2 text-sm">
                  <div>
                    <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                      {l.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">{l.destination ?? "—"}</p>
                  </div>
                  <StatusBadge value={l.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
