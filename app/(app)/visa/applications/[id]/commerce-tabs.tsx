import Link from "next/link";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import {
  CreateQuotationButton,
  FinalVisaUpload,
  VisaMessageForm,
} from "@/components/visa/commerce-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { label, options } from "@/lib/crm/constants";
import { formatMoney } from "@/lib/quotation/pricing";
import { TEMPLATE_LABELS, type TemplateKey } from "@/lib/comms/templates";
import { DELIVERY_METHODS, daysUntil } from "@/lib/visa/constants";
import {
  getLinkedBooking,
  getLinkedQuotation,
  listDeliveries,
  listResults,
  listSubmissions,
  listVisaMessages,
  listVisaSuppliers,
  personName,
  type ApplicationRow,
  type TravellerRow,
} from "@/lib/visa/queries";
import {
  priceApplicationAction,
  recordDeliveryAction,
  recordSubmissionAction,
  setExpectedCompletionAction,
} from "@/app/(app)/visa/actions";

type Perms = ReadonlySet<string>;
const CLOSED = new Set(["CLOSED", "CANCELLED", "REJECTED", "DELIVERED"]);
const EARLY = [
  "NEW",
  "DOCUMENTS_PENDING",
  "DOCUMENTS_RECEIVED",
  "DOCUMENT_REVIEW",
  "CORRECTION_REQUIRED",
  "READY_FOR_SUBMISSION",
  "SUBMITTED",
  "PROCESSING",
  "EMBASSY_REVIEW",
];

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted-foreground text-xs">{k}</dt>
          <dd>{v || "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

export async function PricingTab({
  app,
  p,
  travellerCount,
}: {
  app: ApplicationRow;
  p: Perms;
  travellerCount: number;
}) {
  if (!p.has("visa.price.view"))
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have permission to view pricing.
      </p>
    );
  const [quotation, booking] = await Promise.all([
    app.quotation_id ? getLinkedQuotation(app.quotation_id) : null,
    app.booking_id ? getLinkedBooking(app.booking_id) : null,
  ]);
  const locked = Boolean(app.quotation_id || app.booking_id);
  const canPrice = p.has("visa.edit") && !locked && !CLOSED.has(app.status);
  const cur = app.price_currency ?? "INR";
  return (
    <section aria-label="Pricing" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {app.total_price == null ? (
            <p className="text-muted-foreground text-sm">
              Not priced yet. The price is calculated on the server from the product&apos;s current
              fees for {travellerCount} traveller{travellerCount === 1 ? "" : "s"}.
            </p>
          ) : (
            <Facts
              rows={[
                ["Per traveller (taxes included)", formatMoney(Number(app.unit_price), cur)],
                ["Travellers", String(travellerCount)],
                ["Processing", app.express ? "Express" : "Normal"],
                [
                  "Discount",
                  Number(app.discount_amount) > 0
                    ? `${formatMoney(Number(app.discount_amount), cur)}${app.discount_reason ? ` · ${app.discount_reason}` : ""}`
                    : "None",
                ],
                ["Total", <strong key="t">{formatMoney(Number(app.total_price), cur)}</strong>],
                ["Priced", app.priced_at?.slice(0, 10)],
              ]}
            />
          )}
          {canPrice && (
            <details className="rounded-lg border p-3" open={app.total_price == null}>
              <summary className="cursor-pointer text-sm font-medium">
                {app.total_price == null ? "Calculate the price" : "Recalculate"}
              </summary>
              <div className="pt-3">
                <EntityForm
                  action={priceApplicationAction.bind(null, app.id)}
                  submitLabel="Calculate and save"
                  fields={[
                    {
                      name: "express",
                      label: "Express processing",
                      type: "checkbox",
                      defaultValue: app.express,
                    },
                    ...(p.has("visa.discount")
                      ? [
                          {
                            name: "discount",
                            label: "Discount (amount)",
                            type: "number" as const,
                            min: 0,
                            step: "0.01",
                          },
                          { name: "reason", label: "Reason for the discount", wide: true },
                        ]
                      : []),
                  ]}
                />
              </div>
            </details>
          )}
          {locked && (
            <p className="text-muted-foreground text-xs">
              The price is locked because a quotation exists. Add or remove travellers before
              creating the quotation.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quotation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {quotation ? (
            <p className="flex flex-wrap items-center gap-3">
              <Link
                href={`/quotations/${quotation.id}`}
                className="text-primary font-medium underline"
              >
                {quotation.quotation_number}
              </Link>
              <StatusBadge value={quotation.status} />
              {booking && (
                <Link href={`/bookings/${booking.id}`} className="text-primary underline">
                  Booking {booking.booking_number}
                </Link>
              )}
            </p>
          ) : app.total_price != null &&
            p.has("quotes.create") &&
            p.has("visa.edit") &&
            !CLOSED.has(app.status) ? (
            <>
              <p className="text-muted-foreground">
                Creates a standard quotation with one visa line. Send it, get approval and convert
                it to a booking in the usual way; payments, receipts and invoices then work as for
                any booking.
              </p>
              <div>
                <CreateQuotationButton applicationId={app.id} />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">No quotation yet. Price the application first.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export async function PaymentsTab({ app, p }: { app: ApplicationRow; p: Perms }) {
  const booking = app.booking_id ? await getLinkedBooking(app.booking_id) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payments</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {booking ? (
          <>
            <Facts
              rows={[
                ["Booking", booking.booking_number],
                ["Booking status", <StatusBadge key="s" value={booking.status} />],
                ["Total", formatMoney(Number(booking.total_amount), booking.currency)],
                ["Paid", formatMoney(Number(booking.paid_amount), booking.currency)],
                [
                  "Balance due",
                  <strong
                    key="b"
                    className={
                      Number(booking.balance_amount) > 0 ? "text-tone-bad" : "text-tone-ok"
                    }
                  >
                    {formatMoney(Number(booking.balance_amount), booking.currency)}
                  </strong>,
                ],
              ]}
            />
            {p.has("bookings.view") && (
              <div>
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/bookings/${booking.id}`} />}
                >
                  Open booking to record a payment or issue an invoice
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">
            There&apos;s no booking yet. Payments are collected on the booking, which is created
            when the visa quotation is converted.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export async function SupplierTab({ app, p }: { app: ApplicationRow; p: Perms }) {
  const canSeeSupplier = p.has("visa.supplier.view");
  const [rows, suppliers] = await Promise.all([
    canSeeSupplier ? listSubmissions(app.id) : [],
    canSeeSupplier ? listVisaSuppliers() : [],
  ]);
  const submitted = ["SUBMITTED", "PROCESSING", "EMBASSY_REVIEW"].includes(app.status);
  const left = daysUntil(app.expected_completion);
  const overdue = submitted && left !== null && left < 0;
  return (
    <section aria-label="Supplier" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expected completion</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            {app.expected_completion ? (
              <>
                {app.expected_completion}
                {overdue && (
                  <span className="ml-2 text-tone-bad">Overdue by {Math.abs(left!)} day(s)</span>
                )}
                {submitted && left !== null && left >= 0 && (
                  <span className="text-muted-foreground ml-2">in {left} day(s)</span>
                )}
              </>
            ) : (
              "Set automatically when the application is submitted, from the product's processing time."
            )}
          </p>
          {p.has("visa.process") && !CLOSED.has(app.status) && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Change the date</summary>
              <div className="pt-3">
                <EntityForm
                  action={setExpectedCompletionAction.bind(null, app.id)}
                  submitLabel="Save date"
                  fields={[
                    {
                      name: "expectedCompletion",
                      label: "Expected completion",
                      type: "date",
                      defaultValue: app.expected_completion,
                    },
                  ]}
                />
              </div>
            </details>
          )}
        </CardContent>
      </Card>
      {canSeeSupplier && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Supplier submissions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing submitted to a supplier yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="font-medium">
                      {r.suppliers?.company_name ?? "No supplier"}
                    </span>
                    <span className="text-muted-foreground">
                      {r.reference ? `Ref ${r.reference} · ` : ""}submitted {r.submitted_on}
                      {r.actual_completion ? ` · completed ${r.actual_completion}` : ""}
                    </span>
                    {r.cost != null && (
                      <span className="ml-auto">
                        {formatMoney(Number(r.cost), app.price_currency ?? "INR")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {p.has("visa.application.submit") && submitted && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Record a supplier submission
                </summary>
                <div className="pt-3">
                  <EntityForm
                    action={recordSubmissionAction.bind(null, app.id)}
                    submitLabel="Record"
                    fields={[
                      {
                        name: "supplierId",
                        label: "Supplier",
                        type: "select",
                        defaultValue: app.supplier_id,
                        options: suppliers,
                      },
                      { name: "reference", label: "Supplier reference" },
                      ...(p.has("visa.supplier.edit")
                        ? [
                            {
                              name: "cost",
                              label: "Cost charged",
                              type: "number" as const,
                              min: 0,
                              step: "0.01",
                            },
                          ]
                        : []),
                      { name: "notes", label: "Notes", type: "textarea", wide: true },
                    ]}
                  />
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

export async function DeliveryTab({
  app,
  p,
  travellers,
  names,
}: {
  app: ApplicationRow;
  p: Perms;
  travellers: TravellerRow[];
  names: Map<string, string>;
}) {
  const canSee = p.has("visa.document.view");
  const [results, deliveries] = await Promise.all([
    canSee ? listResults(app.id) : [],
    listDeliveries(app.id),
  ]);
  const byTraveller = new Map(results.map((r) => [r.traveller_id, r]));
  const canRecord =
    p.has("visa.process") &&
    p.has("visa.document.upload") &&
    ["APPROVED", "VISA_RECEIVED"].includes(app.status);
  const canDeliver =
    p.has("visa.process") && app.status === "VISA_RECEIVED" && results.some((r) => r.document_id);
  return (
    <section aria-label="Delivery" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Final visa</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!canSee ? (
            <p className="text-muted-foreground text-sm">
              You don&apos;t have permission to view visa documents.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {travellers.map((t) => {
                const r = byTraveller.get(t.id);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-40 font-medium">{personName(t)}</span>
                    {r ? (
                      <>
                        <span className="text-muted-foreground">
                          {r.visa_number ? `No. ${r.visa_number}` : "No number recorded"}
                          {r.valid_from || r.valid_until
                            ? ` · ${r.valid_from ?? "?"} to ${r.valid_until ?? "?"}`
                            : ""}
                        </span>
                        {r.document_id && (
                          <Button
                            size="xs"
                            variant="outline"
                            nativeButton={false}
                            className="ml-auto"
                            render={
                              <a
                                href={`/api/documents/${r.document_id}/download?inline=1`}
                                target="_blank"
                                rel="noopener noreferrer"
                              />
                            }
                          >
                            View file
                          </Button>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not recorded yet</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canRecord && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Add the final visa</summary>
              <div className="pt-3">
                <FinalVisaUpload
                  travellers={travellers.map((t) => ({ id: t.id, name: personName(t) }))}
                />
              </div>
            </details>
          )}
          {!canRecord && EARLY.includes(app.status) && (
            <p className="text-muted-foreground text-xs">
              The final visa can be added once the application is approved.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery to the customer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {deliveries.length === 0 ? (
            <p className="text-muted-foreground text-sm">Not delivered yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{label(d.method)}</span>
                  <span className="text-muted-foreground">
                    {d.delivered_on}
                    {d.confirmation ? ` · ${d.confirmation}` : ""}
                    {d.delivered_by ? ` · ${names.get(d.delivered_by) ?? "Staff"}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canDeliver && (
            <details className="rounded-lg border p-3" open>
              <summary className="cursor-pointer text-sm font-medium">Record delivery</summary>
              <div className="pt-3">
                <EntityForm
                  action={recordDeliveryAction.bind(null, app.id)}
                  submitLabel="Mark delivered"
                  fields={[
                    {
                      name: "method",
                      label: "How was it delivered?",
                      type: "select",
                      required: true,
                      options: options(DELIVERY_METHODS),
                    },
                    {
                      name: "confirmation",
                      label: "Confirmation (courier number, who collected…)",
                    },
                    { name: "notes", label: "Notes", type: "textarea", wide: true },
                  ]}
                />
              </div>
            </details>
          )}
          {app.status === "VISA_RECEIVED" && !canDeliver && p.has("visa.process") && (
            <p className="text-muted-foreground text-xs">
              Add the final visa file for at least one traveller before recording delivery.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export async function MessagesTab({ app, p }: { app: ApplicationRow; p: Perms }) {
  const messages = await listVisaMessages(app.id);
  return (
    <section aria-label="Messages" className="flex flex-col gap-4">
      {p.has("communications.send") && !CLOSED.has(app.status) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message the customer</CardTitle>
          </CardHeader>
          <CardContent>
            <VisaMessageForm applicationId={app.id} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sent and drafted</CardTitle>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-muted-foreground text-sm">No messages yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {messages.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">
                    {TEMPLATE_LABELS[m.template_key as TemplateKey] ?? m.template_key}
                  </span>
                  <span className="text-muted-foreground">
                    {label(m.channel)} ·{" "}
                    {(m.sent_at ?? m.created_at).slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="ml-auto">
                    <StatusBadge value={m.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
