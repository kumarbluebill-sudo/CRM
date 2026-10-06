import type { FormField } from "@/components/forms/entity-form";
import type { CustomerRow } from "@/lib/crm/types";

export function customerFields(c?: CustomerRow | null): FormField[] {
  return [
    { name: "name", label: "Full name", required: true, wide: true, defaultValue: c?.name },
    { name: "phone", label: "Phone", type: "tel", defaultValue: c?.phone },
    { name: "whatsapp", label: "WhatsApp", type: "tel", defaultValue: c?.whatsapp },
    { name: "email", label: "Email", type: "email", defaultValue: c?.email },
    { name: "dateOfBirth", label: "Date of birth", type: "date", defaultValue: c?.date_of_birth },
    { name: "address", label: "Address", wide: true, defaultValue: c?.address },
    { name: "city", label: "City", defaultValue: c?.city },
    { name: "state", label: "State", defaultValue: c?.state },
    { name: "country", label: "Country", defaultValue: c?.country },
    { name: "nationality", label: "Nationality", defaultValue: c?.nationality },
    { name: "notes", label: "Notes", type: "textarea", defaultValue: c?.notes },
  ];
}
