import type { FormField } from "@/components/forms/entity-form";
import { label } from "@/lib/crm/constants";
import { SUPPLIER_TYPES } from "@/lib/booking/schema";
import type { SupplierRow } from "@/lib/booking/queries";

export function supplierFields(s?: SupplierRow | null, showActive = false): FormField[] {
  return [
    {
      name: "companyName",
      label: "Company name",
      required: true,
      wide: true,
      defaultValue: s?.company_name,
    },
    {
      name: "type",
      label: "Type",
      type: "select",
      required: true,
      options: SUPPLIER_TYPES.map((t) => ({ value: t, label: label(t) })),
      defaultValue: s?.type ?? "HOTEL",
    },
    { name: "destination", label: "Destination / area", defaultValue: s?.destination },
    { name: "contactName", label: "Main contact", defaultValue: s?.contact_name },
    { name: "phone", label: "Phone", type: "tel", defaultValue: s?.phone },
    { name: "email", label: "Email", type: "email", defaultValue: s?.email },
    {
      name: "paymentTerms",
      label: "Payment terms",
      type: "textarea",
      defaultValue: s?.payment_terms,
    },
    { name: "notes", label: "Notes", type: "textarea", defaultValue: s?.notes },
    ...(showActive
      ? [
          {
            name: "isActive",
            label: "Active supplier",
            type: "checkbox" as const,
            defaultValue: s?.is_active ?? true,
          },
        ]
      : []),
  ];
}
