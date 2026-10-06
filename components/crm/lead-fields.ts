import type { FormField } from "@/components/forms/entity-form";
import {
  HOTEL_CATEGORIES,
  LEAD_STATUSES,
  PRIORITIES,
  TRIP_TYPES,
  options,
} from "@/lib/crm/constants";
import type { LeadRow, Option, TeamMember } from "@/lib/crm/types";

export function leadFields(args: {
  lead?: LeadRow | null;
  customers: Option[];
  sources: Option[];
  team: TeamMember[];
  defaultCustomerId?: string;
}): FormField[] {
  const { lead, customers, sources, team } = args;
  return [
    {
      name: "title",
      label: "Title",
      required: true,
      wide: true,
      defaultValue: lead?.title,
      placeholder: "e.g. Sharma family – Dubai",
    },
    {
      name: "customerId",
      label: "Customer",
      type: "select",
      options: customers,
      defaultValue: lead?.customer_id ?? args.defaultCustomerId,
    },
    { name: "destination", label: "Destination", defaultValue: lead?.destination },
    { name: "departureDate", label: "Departure", type: "date", defaultValue: lead?.departure_date },
    { name: "returnDate", label: "Return", type: "date", defaultValue: lead?.return_date },
    { name: "adults", label: "Adults", type: "number", min: 0, defaultValue: lead?.adults ?? 1 },
    {
      name: "children",
      label: "Children",
      type: "number",
      min: 0,
      defaultValue: lead?.children ?? 0,
    },
    { name: "infants", label: "Infants", type: "number", min: 0, defaultValue: lead?.infants ?? 0 },
    {
      name: "budget",
      label: "Budget",
      type: "number",
      min: 0,
      step: "0.01",
      defaultValue: lead?.budget,
    },
    { name: "currency", label: "Currency", defaultValue: lead?.currency ?? "INR" },
    {
      name: "tripType",
      label: "Trip type",
      type: "select",
      required: true,
      options: options(TRIP_TYPES),
      defaultValue: lead?.trip_type ?? "LEISURE",
    },
    {
      name: "hotelCategory",
      label: "Hotel category",
      type: "select",
      options: options(HOTEL_CATEGORIES),
      defaultValue: lead?.hotel_category,
    },
    {
      name: "leadSourceId",
      label: "Source",
      type: "select",
      options: sources,
      defaultValue: lead?.lead_source_id,
    },
    {
      name: "assignedUserId",
      label: "Assigned to",
      type: "select",
      options: team.map((m) => ({ value: m.userId, label: m.name })),
      defaultValue: lead?.assigned_user_id,
    },
    {
      name: "priority",
      label: "Priority",
      type: "select",
      required: true,
      options: options(PRIORITIES),
      defaultValue: lead?.priority ?? "MEDIUM",
    },
    {
      name: "status",
      label: "Stage",
      type: "select",
      required: true,
      options: options(LEAD_STATUSES),
      defaultValue: lead?.status ?? "NEW",
    },
    {
      name: "transportRequired",
      label: "Transport required",
      type: "checkbox",
      defaultValue: lead?.transport_required,
    },
    {
      name: "visaRequired",
      label: "Visa required",
      type: "checkbox",
      defaultValue: lead?.visa_required,
    },
    {
      name: "insuranceRequired",
      label: "Insurance required",
      type: "checkbox",
      defaultValue: lead?.insurance_required,
    },
    { name: "notes", label: "Notes / requirements", type: "textarea", defaultValue: lead?.notes },
  ];
}
