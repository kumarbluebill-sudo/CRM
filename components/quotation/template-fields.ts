import type { FormField } from "@/components/forms/entity-form";
import type { TemplateRow } from "@/lib/quotation/queries";

export function templateFields(t?: TemplateRow | null): FormField[] {
  return [
    { name: "name", label: "Template name", required: true, wide: true, defaultValue: t?.name },
    { name: "intro", label: "Introduction", type: "textarea", defaultValue: t?.intro },
    {
      name: "paymentTerms",
      label: "Payment terms",
      type: "textarea",
      defaultValue: t?.payment_terms,
    },
    {
      name: "cancellationPolicy",
      label: "Cancellation policy",
      type: "textarea",
      defaultValue: t?.cancellation_policy,
    },
    { name: "terms", label: "Terms and conditions", type: "textarea", defaultValue: t?.terms },
  ];
}
