import type { FormField } from "@/components/forms/entity-form";
import { label } from "@/lib/crm/constants";
import { ENQUIRY_STATUSES } from "@/lib/crm/schemas";
import type { EnquiryRow } from "@/lib/crm/lead-history";
import type { Option, TeamMember } from "@/lib/crm/types";

export function enquiryFields(args: {
  enquiry?: EnquiryRow | null;
  /** Used to pre-fill a new enquiry from the lead's own requirements. */
  lead?: {
    destination: string | null;
    departure_date: string | null;
    return_date: string | null;
    adults: number;
    children: number;
    infants: number;
    lead_source_id: string | null;
    assigned_user_id: string | null;
    notes: string | null;
  };
  sources: Option[];
  team: TeamMember[];
}): FormField[] {
  const { enquiry: e, lead: l, sources, team } = args;
  return [
    { name: "destination", label: "Destination", defaultValue: e?.destination ?? l?.destination },
    {
      name: "travellers",
      label: "Number of travellers",
      type: "number",
      min: 1,
      defaultValue:
        e?.travellers ?? (l ? l.adults + l.children + l.infants || undefined : undefined),
    },
    {
      name: "departureDate",
      label: "Travel start date",
      type: "date",
      defaultValue: e?.departure_date ?? l?.departure_date,
    },
    {
      name: "returnDate",
      label: "Travel end date",
      type: "date",
      defaultValue: e?.return_date ?? l?.return_date,
    },
    {
      name: "leadSourceId",
      label: "Enquiry source",
      type: "select",
      options: sources,
      defaultValue: e?.lead_source_id ?? l?.lead_source_id,
    },
    {
      name: "assignedUserId",
      label: "Assigned staff",
      type: "select",
      options: team.map((m) => ({ value: m.userId, label: m.name })),
      defaultValue: e?.assigned_user_id ?? l?.assigned_user_id,
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: ENQUIRY_STATUSES.map((s) => ({ value: s, label: label(s) })),
      defaultValue: e?.status ?? "OPEN",
    },
    {
      name: "lostReason",
      label: "Reason if lost",
      defaultValue: e?.lost_reason,
      placeholder: "Required when the status is Lost",
    },
    {
      name: "requirements",
      label: "Travel requirements",
      type: "textarea",
      wide: true,
      defaultValue: e?.requirements ?? l?.notes,
    },
  ];
}
