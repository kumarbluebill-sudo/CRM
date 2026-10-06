import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingItemEditor } from "@/components/booking/item-editor";
import { BookingStatusActions } from "@/components/booking/booking-status-actions";
import { SendMessageForm } from "@/components/comms/send-message-form";
import { PortalCard } from "@/components/portal/portal-card";
import { PaymentsPanel } from "@/components/payments/payments-panel";
import { isOnlinePaymentsEnabled } from "@/lib/payments/queries";
import { PassengerPanel } from "@/components/booking/passenger-panel";
import { PageHeader } from "@/components/crm/page-header";
import { StatusBadge } from "@/components/crm/status-badge";
import { TaskCompleteButton } from "@/components/crm/task-complete-button";
import { taskFields } from "@/components/crm/task-fields";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentUpload } from "@/components/documents/document-upload";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgSession } from "@/lib/auth/session";
import { label } from "@/lib/crm/constants";
import { listTasks, listTeamMembers } from "@/lib/crm/queries";
import { uuid } from "@/lib/crm/schemas";
import {
  getBooking,
  listBookingHistory,
  listBookingItems,
  listDocuments,
  listPassengers,
  listPassportInfo,
  listSupplierOptions,
} from "@/lib/booking/queries";
import { formatMoney } from "@/lib/quotation/pricing";
import { addBookingItemAction, updateBookingAction } from "@/app/(app)/bookings/actions";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { SERVICE_TYPES } from "@/lib/booking/schema";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireOrgSession();
  const booking = await getBooking(id); // null for missing or other-organization ids (RLS)
  if (!booking) notFound();

  const canEdit =
    session.permissions.has("bookings.update") &&
    booking.status !== "CANCELLED" &&
    booking.status !== "COMPLETED";
  const canSensitive = session.permissions.has("passengers.view_sensitive");
  const canSuppliers = session.permissions.has("suppliers.view");

  const [items, passengers, history, docs, tasks, team, suppliers] = await Promise.all([
    listBookingItems(id),
    listPassengers(id),
    listBookingHistory(id),
    session.permissions.has("documents.view")
      ? listDocuments({ bookingId: id })
      : Promise.resolve({ rows: [], total: 0, page: 1 }),
    session.permissions.has("tasks.view")
      ? listTasks({ scope: "open", relatedId: id })
      : Promise.resolve({ rows: [], total: 0, page: 1 }),
    listTeamMembers(),
    canSuppliers ? listSupplierOptions() : Promise.resolve([]),
  ]);
  const passportMap = canSensitive
    ? await listPassportInfo(passengers.map((p) => p.id))
    : new Map();
  const supplierNames = new Map(suppliers.map((s) => [s.value, s.label]));
  const money = (n: number) => formatMoney(Number(n), booking.currency);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={booking.title}
        description={`${booking.booking_number} · ${booking.customers?.name ?? "Customer"}${booking.destination ? ` · ${booking.destination}` : ""}`}
        actions={
          <>
            <StatusBadge value={booking.status} />
            {session.permissions.has("ai.use") && (
              <Link href={`/ai-assistant?booking=${id}`} className="text-primary text-sm underline">
                Ask AI
              </Link>
            )}
            {session.permissions.has("bookings.update") && (
              <BookingStatusActions id={id} status={booking.status} />
            )}
          </>
        }
      />
      {booking.status === "CANCELLED" && booking.cancellation_reason && (
        <p
          role="note"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          Cancelled: {booking.cancellation_reason}
        </p>
      )}

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            "Travel",
            booking.travel_start
              ? `${booking.travel_start}${booking.travel_end ? ` → ${booking.travel_end}` : ""}`
              : "Dates not set",
          ],
          [
            "Travellers",
            `${booking.adults} adult${booking.adults === 1 ? "" : "s"}${booking.children ? `, ${booking.children} child${booking.children === 1 ? "" : "ren"}` : ""}`,
          ],
          ["Total", money(booking.total_amount)],
          ["Balance", `${money(booking.balance_amount)} (paid ${money(booking.paid_amount)})`],
        ].map(([k, v]) => (
          <Card key={k} size="sm">
            <CardContent>
              <p className="text-muted-foreground text-xs">{k}</p>
              <p className="text-sm font-medium">{v}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {canEdit && (
        <details className="bg-card rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">Edit booking details</summary>
          <div className="pt-3">
            <EntityForm
              action={updateBookingAction.bind(null, id)}
              submitLabel="Save booking"
              fields={[
                {
                  name: "title",
                  label: "Title",
                  required: true,
                  wide: true,
                  defaultValue: booking.title,
                },
                { name: "destination", label: "Destination", defaultValue: booking.destination },
                {
                  name: "travelStart",
                  label: "Departure",
                  type: "date",
                  defaultValue: booking.travel_start,
                },
                {
                  name: "travelEnd",
                  label: "Return",
                  type: "date",
                  defaultValue: booking.travel_end,
                },
                {
                  name: "adults",
                  label: "Adults",
                  type: "number",
                  min: 0,
                  defaultValue: booking.adults,
                },
                {
                  name: "children",
                  label: "Children",
                  type: "number",
                  min: 0,
                  defaultValue: booking.children,
                },
                {
                  name: "notes",
                  label: "Internal notes",
                  type: "textarea",
                  defaultValue: booking.notes,
                },
              ]}
            />
          </div>
        </details>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Services & suppliers</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {items.map((it) => (
            <BookingItemEditor
              key={it.id}
              bookingId={id}
              item={it}
              suppliers={suppliers}
              supplierName={it.supplier_id ? supplierNames.get(it.supplier_id) : undefined}
              canEdit={canEdit}
              currency={booking.currency}
            />
          ))}
          {!canSuppliers && (
            <p className="text-muted-foreground text-xs">
              You don&apos;t have access to the supplier directory, so supplier names are hidden.
            </p>
          )}
          {canEdit && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Add a service</summary>
              <div className="pt-3">
                <EntityForm
                  action={addBookingItemAction.bind(null, id)}
                  submitLabel="Add service"
                  fields={[
                    {
                      name: "type",
                      label: "Type",
                      type: "select",
                      required: true,
                      options: SERVICE_TYPES.map((t) => ({ value: t, label: label(t) })),
                    },
                    { name: "description", label: "Description", required: true },
                    {
                      name: "quantity",
                      label: "Quantity",
                      type: "number",
                      min: 0,
                      step: "0.01",
                      defaultValue: 1,
                    },
                    { name: "serviceDate", label: "Service date", type: "date" },
                    { name: "supplierId", label: "Supplier", type: "select", options: suppliers },
                  ]}
                />
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Passengers</CardTitle>
        </CardHeader>
        <CardContent>
          <PassengerPanel
            bookingId={id}
            passengers={passengers}
            passports={Object.fromEntries(passportMap)}
            canEdit={canEdit}
            canSensitive={canSensitive}
            travelEnd={booking.travel_end}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operations tasks</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {tasks.rows.length === 0 && (
            <p className="text-muted-foreground text-sm">No open tasks.</p>
          )}
          {tasks.rows.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">{t.title}</p>
                <p className="text-muted-foreground text-xs">
                  {t.due_date ?? "No due date"} · {label(t.priority)}
                </p>
              </div>
              {session.permissions.has("tasks.manage") && (
                <TaskCompleteButton id={t.id} done={false} />
              )}
            </div>
          ))}
          {session.permissions.has("tasks.manage") && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Add a task</summary>
              <div className="pt-3">
                <EntityForm
                  action={createTaskAction}
                  submitLabel="Add task"
                  hidden={{ relatedType: "BOOKING", relatedId: id }}
                  fields={taskFields({ team, compact: true })}
                />
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {session.permissions.has("payments.view") && (
        <PaymentsPanel
          bookingId={id}
          currency={booking.currency}
          balance={Number(booking.balance_amount)}
          bookingStatus={booking.status}
          canManage={session.permissions.has("payments.create")}
          onlineEnabled={await isOnlinePaymentsEnabled()}
        />
      )}

      {session.permissions.has("portal.manage") && (
        <PortalCard
          bookingId={id}
          active={booking.status !== "DRAFT" && booking.status !== "CANCELLED"}
        />
      )}

      {session.permissions.has("communications.send") && booking.status !== "CANCELLED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message the customer</CardTitle>
          </CardHeader>
          <CardContent>
            <SendMessageForm bookingId={id} />
          </CardContent>
        </Card>
      )}

      {session.permissions.has("documents.view") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documents</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {session.permissions.has("documents.upload") && (
              <DocumentUpload bookingId={id} canSensitive={canSensitive} />
            )}
            <DocumentList
              docs={docs.rows}
              canDownload={session.permissions.has("documents.download")}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {h.from_status ? `${label(h.from_status)} → ` : ""}
                  <strong>{label(h.to_status)}</strong>
                  {h.reason ? <span className="text-muted-foreground"> · {h.reason}</span> : null}
                </span>
                <span className="text-muted-foreground">
                  {new Date(h.created_at).toLocaleString("en-IN")}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <p className="text-xs">
        <Link className="text-primary underline" href={`/quotations/${booking.quotation_id}`}>
          Open original quotation
        </Link>
      </p>
    </div>
  );
}
