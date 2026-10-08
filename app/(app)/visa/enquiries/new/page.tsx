import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/crm/page-header";
import { EntityForm } from "@/components/forms/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOrgSession } from "@/lib/auth/session";
import { label, options } from "@/lib/crm/constants";
import { listCustomerOptions, listTeamMembers } from "@/lib/crm/queries";
import { formatMoney } from "@/lib/quotation/pricing";
import { PRIORITIES } from "@/lib/visa/constants";
import { findCustomerDuplicates, listProducts } from "@/lib/visa/queries";
import { createEnquiryAction } from "@/app/(app)/visa/actions";

export const metadata: Metadata = { title: "New visa enquiry" };

export default async function NewEnquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; mobile?: string; email?: string; name?: string }>;
}) {
  // requireOrgSession redirects when signed out (so the page is never prerendered at build time).
  const session = await requireOrgSession();
  if (!session.permissions.has("visa.create")) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No access"
        description="You don't have permission to create visa enquiries."
      />
    );
  }
  const sp = await searchParams;
  const searched = Boolean(sp.mobile || sp.email || sp.name);
  const [customers, team, products, matches] = await Promise.all([
    listCustomerOptions(),
    listTeamMembers(),
    listProducts({ activeOnly: true }),
    searched
      ? findCustomerDuplicates({ mobile: sp.mobile, email: sp.email, name: sp.name })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="New visa enquiry"
        description="Find the customer first so nobody is entered twice."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Find an existing customer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex flex-wrap gap-2" role="search">
            <Input
              name="mobile"
              defaultValue={sp.mobile}
              placeholder="Mobile"
              className="max-w-40"
              aria-label="Mobile"
            />
            <Input
              name="email"
              defaultValue={sp.email}
              placeholder="Email"
              className="max-w-52"
              aria-label="Email"
            />
            <Input
              name="name"
              defaultValue={sp.name}
              placeholder="Name"
              className="max-w-52"
              aria-label="Name"
            />
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
          </form>
          {searched &&
            (matches.length === 0 ? (
              <p className="text-sm">
                No existing customer found.{" "}
                <Link href="/customers/new" className="text-primary underline">
                  Create a new customer
                </Link>
                , then come back and pick them below.
              </p>
            ) : (
              <ul
                className="divide-y rounded-lg border text-sm"
                aria-label="Existing customers found"
              >
                {matches.map((m) => (
                  <li
                    key={`${m.customer_id}-${m.matched_on}`}
                    className="flex flex-wrap items-center gap-3 p-2.5"
                  >
                    <span className="font-medium">{m.customer_name}</span>
                    <span className="text-muted-foreground">matched on {label(m.matched_on)}</span>
                    <Link
                      href={`/visa/enquiries/new?customer=${m.customer_id}`}
                      className="text-primary ml-auto underline"
                    >
                      Use this customer
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Enquiry details</CardTitle>
        </CardHeader>
        <CardContent>
          <EntityForm
            action={createEnquiryAction}
            submitLabel="Create enquiry"
            fields={[
              {
                name: "customerId",
                label: "Customer",
                type: "select",
                required: true,
                wide: true,
                options: customers,
                defaultValue: sp.customer,
              },
              {
                name: "productId",
                label: "Visa product",
                type: "select",
                wide: true,
                options: products.map((p) => ({
                  value: p.id,
                  label: `${p.visa_countries?.name ?? ""} · ${label(p.visa_type)} · ${label(p.entry_type)}${p.unit_price != null ? ` · ${formatMoney(p.unit_price, p.currency)}` : ""}`,
                })),
              },
              { name: "nationality", label: "Nationality", placeholder: "e.g. Indian" },
              { name: "travelDate", label: "Travel date", type: "date" },
              {
                name: "travellers",
                label: "Number of travellers",
                type: "number",
                min: 1,
                defaultValue: 1,
              },
              { name: "source", label: "Source", placeholder: "Walk-in, phone, referral…" },
              {
                name: "assignedTo",
                label: "Assigned to",
                type: "select",
                options: team.map((m) => ({ value: m.userId, label: m.name })),
              },
              {
                name: "priority",
                label: "Priority",
                type: "select",
                required: true,
                options: options(PRIORITIES),
                defaultValue: "NORMAL",
              },
              { name: "followUpDate", label: "Follow up on", type: "date" },
              { name: "notes", label: "Notes", type: "textarea", wide: true },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
