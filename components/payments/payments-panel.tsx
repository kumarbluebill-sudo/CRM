import Link from "next/link";
import { Download } from "lucide-react";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { CreateInvoiceButton } from "@/components/invoicing/create-invoice-button";
import {
  DeleteScheduleButton,
  OnlinePayButton,
  VoidInvoiceButton,
} from "@/components/payments/payment-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { label, options } from "@/lib/crm/constants";
import { formatMoney } from "@/lib/quotation/pricing";
import { MANUAL_METHODS } from "@/lib/payments/schema";
import { listBookingPayments } from "@/lib/payments/queries";
import { addScheduleAction, recordPaymentAction } from "@/app/(app)/payments/actions";

/** Payments, instalments and invoices for one booking. Writes are offered only to payments.create. */
export async function PaymentsPanel({
  bookingId,
  currency,
  balance,
  bookingStatus,
  canManage,
  onlineEnabled,
}: {
  bookingId: string;
  currency: string;
  balance: number;
  bookingStatus: string;
  canManage: boolean;
  onlineEnabled: boolean;
}) {
  const { payments, schedule, invoices } = await listBookingPayments(bookingId);
  const money = (n: number) => formatMoney(Number(n), currency);
  const payable = canManage && !["DRAFT", "CANCELLED"].includes(bookingStatus);
  const activeInvoice = invoices.find((i) => i.status === "ISSUED" || i.status === "DRAFT");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>Payments</span>
          {payable && onlineEnabled && balance > 0 && (
            <OnlinePayButton bookingId={bookingId} balance={balance} />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section aria-label="Instalments" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Payment schedule</h3>
          {schedule.length === 0 ? (
            <p className="text-muted-foreground text-sm">No instalments set.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {schedule.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 p-2.5">
                  <span className="min-w-32 font-medium">{s.label}</span>
                  <span className="text-muted-foreground">Due {s.due_date}</span>
                  <span className="ml-auto">
                    {money(s.covered)} / {money(s.amount)}
                  </span>
                  <StatusBadge value={s.schedule_status} />
                  {canManage && s.schedule_status !== "PAID" && (
                    <DeleteScheduleButton bookingId={bookingId} id={s.id} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Add instalment</summary>
              <div className="pt-3">
                <EntityForm
                  action={addScheduleAction.bind(null, bookingId)}
                  submitLabel="Add instalment"
                  fields={[
                    { name: "label", label: "Label", required: true, placeholder: "Deposit" },
                    { name: "dueDate", label: "Due date", type: "date", required: true },
                    {
                      name: "amount",
                      label: `Amount (${currency})`,
                      type: "number",
                      min: 0,
                      step: "0.01",
                      required: true,
                    },
                  ]}
                />
              </div>
            </details>
          )}
        </section>

        <section aria-label="Payments received" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Payments</h3>
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No payments yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 p-2.5">
                  <span className="min-w-24 font-medium">{money(p.amount)}</span>
                  <span className="text-muted-foreground">
                    {label(p.method)}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {(p.paid_at ?? p.created_at).slice(0, 10)}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <StatusBadge value={p.status} />
                    {p.status === "CAPTURED" && (
                      <Button
                        size="xs"
                        variant="outline"
                        nativeButton={false}
                        render={
                          <a
                            href={`/api/payments/${p.id}/receipt`}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        }
                      >
                        <Download className="size-3" aria-hidden /> {p.receipt_number}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {payable && balance > 0 && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Record a payment</summary>
              <div className="pt-3">
                <EntityForm
                  action={recordPaymentAction.bind(null, bookingId)}
                  submitLabel="Record payment"
                  fields={[
                    {
                      name: "amount",
                      label: `Amount (${currency})`,
                      type: "number",
                      min: 0,
                      step: "0.01",
                      required: true,
                      defaultValue: balance,
                    },
                    {
                      name: "method",
                      label: "Method",
                      type: "select",
                      required: true,
                      options: options(MANUAL_METHODS),
                      defaultValue: "BANK_TRANSFER",
                    },
                    {
                      name: "reference",
                      label: "Reference / UTR",
                      placeholder: "Transaction or cheque number",
                    },
                    { name: "paidAt", label: "Received on", type: "date" },
                    { name: "notes", label: "Notes", type: "textarea", wide: true },
                  ]}
                />
              </div>
            </details>
          )}
        </section>

        <section aria-label="Invoices" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Invoices</h3>
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invoice issued.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 p-2.5">
                  <Link
                    href={`/payments/invoices/${i.id}`}
                    className="min-w-28 font-medium hover:underline"
                  >
                    {i.invoice_number ?? "Draft invoice"}
                  </Link>
                  <span className="text-muted-foreground">
                    {i.issue_date}
                    {i.due_date ? ` · due ${i.due_date}` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <StatusBadge value={i.status} />
                    <Button
                      size="xs"
                      variant="outline"
                      nativeButton={false}
                      render={
                        <a
                          href={`/api/invoices/${i.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <Download className="size-3" aria-hidden /> PDF
                    </Button>
                    {canManage && i.status === "ISSUED" && !i.tax_snapshot && (
                      <VoidInvoiceButton bookingId={bookingId} invoiceId={i.id} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {payable && !activeInvoice && (
            <div>{canManage && <CreateInvoiceButton bookingId={bookingId} />}</div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
