import { BOOKING_STATUSES } from "@/lib/booking/schema";

/**
 * The booking process as a reference guide for staff. It describes what people do and which CRM page to use; it does
 * not move a booking between statuses. Only the statuses and transitions the application really has are named here.
 */

export type StepKind = "start" | "process" | "end";

export type WorkflowStep = {
  id: string;
  kind: StepKind;
  title: string;
  /** What to do, in one or two sentences. */
  explain: string;
  /** CRM page that does this step, and the permission needed to open it. */
  href?: string;
  linkLabel?: string;
  permission?: string;
  /** Booking status the booking has at this point, when the step changes it. */
  status?: (typeof BOOKING_STATUSES)[number];
};

export type Branch = {
  label: string;
  /** "main" continues the process; "loop" goes back; "exception" leaves the normal path. */
  kind: "main" | "loop" | "exception";
  result: string;
  href?: string;
  linkLabel?: string;
  permission?: string;
};

export type Decision = {
  id: string;
  question: string;
  explain: string;
  branches: Branch[];
};

/** The flow in order. A decision always follows the step it names in `after`. */
export const STEPS: WorkflowStep[] = [
  {
    id: "lead",
    kind: "start",
    title: "Lead received",
    explain:
      "An enquiry arrives from a call, message, website or referral. Create the lead so it gets its LD reference number.",
    href: "/leads/new",
    linkLabel: "New lead",
    permission: "leads.create",
  },
  {
    id: "contact",
    kind: "process",
    title: "Contact customer",
    explain:
      "Call or message the customer, then record the call on the lead so the history shows who spoke to them and when.",
    href: "/leads",
    linkLabel: "Leads",
    permission: "leads.view",
  },
  {
    id: "requirements",
    kind: "process",
    title: "Collect travel requirements",
    explain:
      "Destination, dates, number of travellers, budget, hotel category and anything special. Note them on the lead.",
    href: "/leads",
    linkLabel: "Leads",
    permission: "leads.view",
  },
  {
    id: "enquiry",
    kind: "process",
    title: "Create enquiry",
    explain:
      "Add an enquiry on the lead's Enquiry History tab. A customer can have several enquiries over time.",
    href: "/enquiries",
    linkLabel: "Enquiries",
    permission: "leads.view",
  },
  {
    id: "itinerary",
    kind: "process",
    title: "Prepare itinerary",
    explain: "Build the day-by-day plan from the requirements, or start from a saved package.",
    href: "/itineraries",
    linkLabel: "Itineraries",
    permission: "itineraries.view",
  },
  {
    id: "quotation",
    kind: "process",
    title: "Generate quotation",
    explain:
      "Price the itinerary into a quotation with options, taxes and terms. It gets a Q reference number.",
    href: "/quotations",
    linkLabel: "Quotations",
    permission: "quotes.view",
  },
  {
    id: "send",
    kind: "process",
    title: "Send quotation to customer",
    explain: "Send it by email or WhatsApp. The quotation moves to Sent.",
    href: "/quotations",
    linkLabel: "Quotations",
    permission: "quotes.view",
  },
  {
    id: "availability",
    kind: "process",
    title: "Confirm services and availability",
    explain:
      "Check that hotels, transport and activities are available for the agreed dates before taking money.",
    href: "/suppliers",
    linkLabel: "Suppliers",
    permission: "suppliers.view",
  },
  {
    id: "documents",
    kind: "process",
    title: "Collect required customer documents",
    explain:
      "Passports, IDs and any visa papers. Passport and visa files are kept as sensitive documents.",
    href: "/documents",
    linkLabel: "Documents",
    permission: "documents.view",
  },
  {
    id: "booking",
    kind: "process",
    title: "Create booking",
    explain:
      "Convert the approved quotation into a booking. It gets a B reference number and starts as Payment pending.",
    href: "/bookings",
    linkLabel: "Bookings",
    permission: "bookings.view",
    status: "PAYMENT_PENDING",
  },
  {
    id: "advance",
    kind: "process",
    title: "Record advance payment",
    explain:
      "Record what the customer paid and give them a receipt. The booking shows how much is paid and how much is due.",
    href: "/payments",
    linkLabel: "Payments & billing",
    permission: "payments.view",
  },
  {
    id: "suppliers",
    kind: "process",
    title: "Confirm suppliers and services",
    explain:
      "Ask each supplier to confirm and mark each booking item as confirmed. Use job orders to assign the work to staff.",
    href: "/jobs",
    linkLabel: "Job orders",
    permission: "jobs.view",
  },
  {
    id: "confirmation",
    kind: "process",
    title: "Issue booking confirmation",
    explain: "Change the booking to Confirmed and send the customer their confirmation.",
    href: "/bookings",
    linkLabel: "Bookings",
    permission: "bookings.view",
    status: "CONFIRMED",
  },
  {
    id: "balance",
    kind: "process",
    title: "Track balance payment",
    explain:
      "Follow up the remaining amount before travel. Overdue payments show in notifications.",
    href: "/payments",
    linkLabel: "Payments & billing",
    permission: "payments.view",
  },
  {
    id: "traveldocs",
    kind: "process",
    title: "Prepare travel documents",
    explain:
      "Vouchers, tickets, the itinerary and invoice. Upload them to the booking and share with the customer.",
    href: "/documents",
    linkLabel: "Documents",
    permission: "documents.view",
  },
  {
    id: "progress",
    kind: "process",
    title: "Trip in progress",
    explain: "The customer is travelling. Be reachable for changes and problems.",
    href: "/bookings",
    linkLabel: "Bookings",
    permission: "bookings.view",
    status: "IN_PROGRESS",
  },
  {
    id: "completed",
    kind: "process",
    title: "Trip completed",
    explain: "Mark the booking Completed once the customer is back and all services are delivered.",
    href: "/bookings",
    linkLabel: "Bookings",
    permission: "bookings.view",
    status: "COMPLETED",
  },
  {
    id: "feedback",
    kind: "process",
    title: "Collect customer feedback",
    explain: "Ask how the trip went and note it on the customer record.",
    href: "/customers",
    linkLabel: "Customers",
    permission: "customers.view",
  },
  {
    id: "repeat",
    kind: "end",
    title: "Follow up for repeat business",
    explain: "Schedule a follow-up for the next trip, anniversary or season.",
    href: "/followups",
    linkLabel: "Follow-ups",
    permission: "tasks.view",
  },
];

/** Decisions, keyed by the step they come after. */
export const DECISIONS: Record<string, Decision> = {
  send: {
    id: "customer-decision",
    question: "Customer decision?",
    explain:
      "Wait for the customer's answer and record it. Set a follow-up so the quotation is not forgotten.",
    branches: [
      {
        label: "Approves",
        kind: "main",
        result: "Continue: confirm services and availability. Mark the quotation Approved.",
      },
      {
        label: "Requests changes",
        kind: "loop",
        result: "Return to Prepare itinerary and Generate quotation, then send the new version.",
        href: "/itineraries",
        linkLabel: "Itineraries",
        permission: "itineraries.view",
      },
      {
        label: "Declines",
        kind: "exception",
        result:
          "Mark the enquiry Lost and record the reason. Schedule a future follow-up if the customer may travel later.",
        href: "/followups",
        linkLabel: "Follow-ups",
        permission: "tasks.view",
      },
    ],
  },
  availability: {
    id: "availability-decision",
    question: "Are services available?",
    explain: "Do not take payment for something you cannot supply.",
    branches: [
      { label: "Yes", kind: "main", result: "Continue: collect the customer's documents." },
      {
        label: "No",
        kind: "loop",
        result:
          "Offer alternatives, revise the itinerary and quotation, and ask the customer again.",
        href: "/quotations",
        linkLabel: "Quotations",
        permission: "quotes.view",
      },
    ],
  },
  advance: {
    id: "payment-decision",
    question: "Advance payment received?",
    explain:
      "The booking stays Payment pending until you confirm it, even if part of the amount has been paid.",
    branches: [
      { label: "Yes", kind: "main", result: "Continue: confirm suppliers and services." },
      {
        label: "No or only partly",
        kind: "exception",
        result:
          "Send a reminder and keep the booking Payment pending. If the customer does not pay by the agreed date, cancel the booking and give a reason.",
        href: "/payments",
        linkLabel: "Payments & billing",
        permission: "payments.view",
      },
    ],
  },
  suppliers: {
    id: "supplier-decision",
    question: "Suppliers confirmed?",
    explain:
      "A failed confirmation must be handled before the customer is told the trip is confirmed.",
    branches: [
      { label: "Yes", kind: "main", result: "Continue: issue the booking confirmation." },
      {
        label: "No (failed confirmation)",
        kind: "exception",
        result:
          "Find another supplier and update the booking item. If nothing suitable exists, tell the customer, cancel the booking with a reason and refund what was paid.",
        href: "/suppliers",
        linkLabel: "Suppliers",
        permission: "suppliers.view",
      },
    ],
  },
};

/** Cancellation and refund guidance shown under the diagram. */
export const CANCELLATION_NOTES = [
  "A booking can be cancelled from Draft, Payment pending, Confirmed or In progress. A reason is required and is kept in the booking's status history.",
  "Completed and Cancelled bookings cannot be changed again.",
  "The CRM does not send money back. Refund through the original payment method, record it in the booking notes, and issue a credit note for any GST invoice that was already issued.",
];

/** The statuses staff ask about, mapped to what the application actually has. */
export const STATUS_MAP: { asked: string; actual: string; where: string; note: string }[] = [
  {
    asked: "Draft",
    actual: "Draft",
    where: "Booking",
    note: "Created but not yet requested for payment.",
  },
  {
    asked: "Pending Customer Approval",
    actual: "Quotation: Sent, Viewed or Negotiation",
    where: "Quotation",
    note: "Before approval there is no booking yet, so this is the quotation's status.",
  },
  {
    asked: "Awaiting Payment",
    actual: "Payment pending",
    where: "Booking",
    note: "A booking starts here when it is created from an approved quotation.",
  },
  {
    asked: "Payment Partially Received",
    actual: "Payment pending, with an amount paid",
    where: "Booking",
    note: "Shown by the paid and balance amounts. It is not a separate status.",
  },
  {
    asked: "Confirmed",
    actual: "Confirmed",
    where: "Booking",
    note: "Payment and suppliers are in place.",
  },
  {
    asked: "In Progress",
    actual: "In progress",
    where: "Booking",
    note: "The customer is travelling.",
  },
  { asked: "Completed", actual: "Completed", where: "Booking", note: "Final. Cannot be changed." },
  {
    asked: "Cancelled",
    actual: "Cancelled",
    where: "Booking",
    note: "Final. A reason is required.",
  },
];

/** Allowed booking status changes, exactly as the database enforces them. */
export const TRANSITIONS: Record<
  (typeof BOOKING_STATUSES)[number],
  (typeof BOOKING_STATUSES)[number][]
> = {
  DRAFT: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
