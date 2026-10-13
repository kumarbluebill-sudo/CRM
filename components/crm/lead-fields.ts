import type { FormField } from "@/components/forms/entity-form";
import {
  HOTEL_CATEGORIES,
  LEAD_STATUSES,
  PRIORITIES,
  TRIP_TYPES,
  options,
} from "@/lib/crm/constants";
import { nationalityOptions } from "@/lib/geo/nationalities";
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
      name: "contactName",
      label: "Full name",
      defaultValue: lead?.contact_name,
      placeholder: "e.g. Asha Sharma",
    },
    {
      name: "contactPhone",
      label: "Mobile number (with country code)",
      type: "tel",
      defaultValue: lead?.contact_phone,
      placeholder: "+91 98765 43210",
    },
    {
      name: "contactEmail",
      label: "Email address",
      type: "email",
      defaultValue: lead?.contact_email,
    },
    {
      name: "nationality",
      label: "Nationality",
      type: "select",
      options: nationalityOptions(lead?.nationality),
      defaultValue: lead?.nationality,
      placeholder: "Search nationality…",
    },
    {
      name: "title",
      label: "Lead title (optional)",
      wide: true,
      defaultValue: lead?.title,
      placeholder: "Defaults to name and destination, e.g. Sharma family – Dubai",
    },
    {
      name: "customerId",
      label: "Customer",
      type: "select",
      options: customers,
      defaultValue: lead?.customer_id ?? args.defaultCustomerId,
    },
    { name: "destination", label: "Travel destination", defaultValue: lead?.destination },
    {
      name: "departureDate",
      label: "Travel start date",
      type: "date",
      defaultValue: lead?.departure_date,
    },
    { name: "returnDate", label: "Travel end date", type: "date", defaultValue: lead?.return_date },
    {
      name: "nextFollowUpDate",
      label: "Next follow-up date",
      type: "date",
      defaultValue: lead?.next_follow_up_date,
    },
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
    {
      name: "notes",
      label: "Enquiry details / requirements",
      type: "textarea",
      defaultValue: lead?.notes,
    },
  ];
}
