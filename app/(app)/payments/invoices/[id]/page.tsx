import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { InvoiceEditor } from "@/components/invoicing/invoice-editor";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { uuid } from "@/lib/crm/schemas";
import { GST_STATES, stateCodeFromName, stateName } from "@/lib/gst/states";
import {
  getInvoiceFull,
  getTaxProfile,
  invoicePaymentStatus,
  listTaxCodes,
} from "@/lib/invoicing/queries";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/quotation/pricing";
import { createCreditNoteAction } from "@/app/(app)/payments/invoices/actions";

export const metadata: Metadata = { title: "Invoice" };

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  if (!session.permissions.has("payments.view")) notFound();
  const data = await getInvoiceFull(id);
  if (!data) notFound();
  const { invoice: inv, lines, creditNotes } = data;
  const [profile, codes] = await Promise.all([getTaxProfile(), listTaxCodes()]);
  const can = (p: string) => session.permissions.has(p);
  const money = (n: number) => formatMoney(Number(n), inv.currency);
  const isDraft = inv.status === "DRAFT";
  const registered = isDraft
    ? Boolean(profile?.gst_registered)
    : Boolean(inv.tax_snapshot?.registered);
  const profileReady = Boolean(profile?.legal_name && profile?.address && profile?.state_code);
  const pay = invoicePaymentStatus(
    Number(inv.total_amount),
    Number(inv.bookings?.paid_amount ?? 0),
  );

  let defaultPlace = inv.place_of_supply ?? "";
  if (isDraft && !defaultPlace) {
    const supabase = await createClient();
    const { data: c } = await supabase
      .from("customers")
      .select("state")
      .eq("id", inv.customer_id)
      .maybeSingle();
    defaultPlace = stateCodeFromName(c?.state as string | null) ?? profile?.state_code ?? "";
  }
  const title = inv.invoice_number ?? "Draft invoice";
  const diff = inv.bookings
    ? Math.round((Number(inv.total_amount) - Number(inv.bookings.total_amount)) * 100) / 100
    : 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={title}
        description={`${inv.doc_type === "TAX_INVOICE" ? "Tax invoice" : "Invoice"} · booking ${inv.bookings?.booking_number ?? ""}`}
        actions={
          <>
            <StatusBadge value={inv.status} />
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noopener noreferrer" />
              }
            >
              <Download className="size-4" aria-hidden /> {isDraft ? "Preview PDF" : "PDF"}
            </Button>
          </>
        }
      />

      {isDraft && !profileReady && (
        <p
          role="note"
          className="border-tone-warn/30 bg-tone-warn-soft text-tone-warn rounded-lg border p-3 text-sm"
        >
          The invoicing profile (legal name, address and state) isn&apos;t complete, so this
          can&apos;t be issued yet.{" "}
          {can("invoicing.manage") ? (
            <Link href="/settings/invoicing" className="underline">
              Complete it in Invoicing settings.
            </Link>
          ) : (
            "Ask an accountant or administrator to complete it."
          )}
        </p>
      )}

      {isDraft ? (
        can("payments.create") ? (
          <Card>
            <CardContent>
              <InvoiceEditor
                invoice={{
                  id: inv.id,
                  dueDate: inv.due_date ?? "",
                  notes: inv.notes ?? "",
                  terms: inv.terms ?? "",
                  placeOfSupply: defaultPlace,
                  customerGstin: inv.customer_gstin ?? "",
                  billName: inv.bill_to.name ?? "",
                  billAddress: inv.bill_to.address ?? "",
                  priceIncludesTax: inv.price_includes_tax,
                }}
                lines={lines.map((l) => ({
                  description: l.description,
                  taxCodeId: l.tax_code_id,
                  quantity: Number(l.quantity),
                  unitPrice: Number(l.unit_price),
                  discount: Number(l.discount),
                }))}
                taxCodes={codes.map((c) => ({
                  id: c.id,
                  name: c.name,
                  rate: Number(c.rate),
                  verified: Boolean(c.verified_at),
                  active: c.active,
                }))}
                states={GST_STATES}
                registered={registered}
                profileReady={profileReady && can("payments.create")}
              />
            </CardContent>
          </Card>
        ) : (
          <p className="text-muted-foreground text-sm">You can view this draft but not edit it.</p>
        )
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lines</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-1.5 pr-3 font-medium">Description</th>
                    <th className="px-2 font-medium">SAC</th>
                    <th className="px-2 text-right font-medium">Qty</th>
                    <th className="px-2 text-right font-medium">Rate</th>
                    <th className="px-2 text-right font-medium">Taxable</th>
                    <th className="px-2 text-right font-medium">Tax</th>
                    <th className="pl-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{l.description}</td>
                      <td className="px-2">{l.sac_code ?? "–"}</td>
                      <td className="px-2 text-right">{l.quantity}</td>
                      <td className="px-2 text-right">{Number(l.rate)}%</td>
                      <td className="px-2 text-right">{money(l.taxable)}</td>
                      <td className="px-2 text-right">
                        {money(Number(l.cgst) + Number(l.sgst) + Number(l.igst))}
                      </td>
                      <td className="pl-2 text-right">{money(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Totals{isDraft ? " (calculated by the server)" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            <Row label="Taxable value" value={money(inv.subtotal)} />
            {inv.supply_type === "INTRA" && (
              <>
                <Row label="CGST" value={money(inv.cgst)} />
                <Row label="SGST" value={money(inv.sgst)} />
              </>
            )}
            {inv.supply_type === "INTER" && <Row label="IGST" value={money(inv.igst)} />}
            {inv.supply_type === "NONE" && <Row label="Tax" value={money(inv.tax_total)} />}
            {Number(inv.rounding) !== 0 && <Row label="Round off" value={money(inv.rounding)} />}
            <Row label="Total" value={money(inv.total_amount)} strong />
            {inv.place_of_supply && (
              <p className="text-muted-foreground pt-1 text-xs">
                Place of supply: {inv.place_of_supply} · {stateName(inv.place_of_supply)}
                {inv.supply_type === "INTRA"
                  ? " (same state: CGST + SGST)"
                  : inv.supply_type === "INTER"
                    ? " (other state: IGST)"
                    : ""}
              </p>
            )}
            {isDraft && diff !== 0 && (
              <p className="text-muted-foreground pt-1 text-xs">
                This differs from the booking total by {money(Math.abs(diff))} (
                {diff > 0 ? "higher" : "lower"}). Check it is intended.
              </p>
            )}
          </CardContent>
        </Card>
        {inv.status === "ISSUED" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <Row
                label="Status"
                value={
                  pay.status === "PAID"
                    ? "Paid"
                    : pay.status === "PARTIAL"
                      ? "Partly paid"
                      : "Unpaid"
                }
              />
              <Row label="Paid on the booking" value={money(pay.paid)} />
              <Row label="Balance" value={money(pay.balance)} strong />
              <p className="text-muted-foreground pt-1 text-xs">
                Payments are recorded on the booking.{" "}
                <Link className="underline" href={`/bookings/${inv.booking_id}`}>
                  Open booking
                </Link>
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {creditNotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {creditNotes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{c.credit_note_number}</span>
                  <span className="text-muted-foreground">
                    {c.issue_date} · {c.reason}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {money(c.total_amount)}
                    <Button
                      size="xs"
                      variant="outline"
                      nativeButton={false}
                      render={
                        <a
                          href={`/api/credit-notes/${c.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <Download className="size-3" aria-hidden /> PDF
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {inv.status === "ISSUED" && inv.tax_snapshot && can("invoicing.manage") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Correct or cancel this invoice</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              An issued invoice is never edited or deleted. A credit note cancels it in full, and a
              new invoice can then be raised for the booking.
            </p>
            <EntityForm
              action={createCreditNoteAction.bind(null, inv.id)}
              submitLabel="Issue credit note for the full invoice"
              fields={[{ name: "reason", label: "Reason", required: true, wide: true }]}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
