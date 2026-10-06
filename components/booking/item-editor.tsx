import Link from "next/link";
import { FileCheck } from "lucide-react";
import { StatusBadge } from "@/components/crm/status-badge";
import { EntityForm } from "@/components/forms/entity-form";
import { Button } from "@/components/ui/button";
import { label } from "@/lib/crm/constants";
import { CONFIRMATION_STATUSES } from "@/lib/booking/schema";
import type { BookingItemRow } from "@/lib/booking/queries";
import { updateBookingItemAction } from "@/app/(app)/bookings/actions";

const STATUS_TONE: Record<string, string> = {
  PENDING: "TODO",
  REQUESTED: "IN_PROGRESS",
  CONFIRMED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

export function BookingItemEditor({
  bookingId,
  item,
  suppliers,
  supplierName,
  canEdit,
  currency,
}: {
  bookingId: string;
  item: BookingItemRow;
  suppliers: { value: string; label: string }[];
  supplierName?: string;
  canEdit: boolean;
  currency: string;
}) {
  const canVoucher = item.confirmation_status === "CONFIRMED" && item.supplier_id;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{item.description}</p>
          <p className="text-muted-foreground text-xs">
            {label(item.type)} · qty {Number(item.quantity)}
            {item.service_date ? ` · ${item.service_date}` : ""}
            {supplierName ? ` · ${supplierName}` : " · no supplier yet"}
            {item.confirmation_reference ? ` · ref ${item.confirmation_reference}` : ""}
          </p>
          {item.unit_price !== null && (
            <p className="text-muted-foreground text-xs">
              Sold at {currency} {Number(item.unit_price).toLocaleString("en-IN")} each
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge value={STATUS_TONE[item.confirmation_status] ?? "TODO"} />
          <span className="text-xs">{label(item.confirmation_status)}</span>
          {canVoucher && (
            <Button
              size="xs"
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/api/bookings/${bookingId}/items/${item.id}/voucher`}
                  target="_blank"
                />
              }
            >
              <FileCheck className="size-3.5" aria-hidden /> Voucher
            </Button>
          )}
        </div>
      </div>
      {canEdit && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium">
            Manage supplier and confirmation
          </summary>
          <div className="pt-2">
            <EntityForm
              action={updateBookingItemAction.bind(null, item.id, bookingId)}
              submitLabel="Save service"
              fields={[
                {
                  name: "description",
                  label: "Description",
                  required: true,
                  wide: true,
                  defaultValue: item.description,
                },
                {
                  name: "supplierId",
                  label: "Supplier",
                  type: "select",
                  options: suppliers,
                  defaultValue: item.supplier_id,
                },
                {
                  name: "serviceDate",
                  label: "Service date",
                  type: "date",
                  defaultValue: item.service_date,
                },
                {
                  name: "confirmationStatus",
                  label: "Confirmation",
                  type: "select",
                  required: true,
                  options: CONFIRMATION_STATUSES.map((s) => ({ value: s, label: label(s) })),
                  defaultValue: item.confirmation_status,
                },
                {
                  name: "confirmationReference",
                  label: "Supplier reference",
                  defaultValue: item.confirmation_reference,
                },
                { name: "notes", label: "Notes", type: "textarea", defaultValue: item.notes },
              ]}
            />
          </div>
        </details>
      )}
    </div>
  );
}
