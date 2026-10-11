/**
 * The getting-started checklist. "Done" is worked out from real records the person can already see, so it never needs
 * to be ticked by hand and can never disagree with the system.
 */
export type ChecklistItem = {
  key: string;
  title: string;
  hint: string;
  href: string;
  /** Needed to see the step at all. */
  permission: string;
  /** Table whose row count (as seen through the person's own access) marks the step done. */
  table: string;
  /** At least this many rows. */
  atLeast: number;
  guide: string;
};

export const CHECKLIST: ChecklistItem[] = [
  {
    key: "team",
    title: "Invite your team",
    hint: "Add the people who will use the CRM.",
    href: "/settings/team",
    permission: "users.manage",
    table: "organization_members",
    atLeast: 2,
    guide: "staff-roles-and-access",
  },
  {
    key: "customer",
    title: "Add your first customer",
    hint: "A customer is the person or company you sell to.",
    href: "/customers/new",
    permission: "customers.create",
    table: "customers",
    atLeast: 1,
    guide: "leads-and-customers",
  },
  {
    key: "lead",
    title: "Record an enquiry",
    hint: "Track where it came from and who follows it up.",
    href: "/leads/new",
    permission: "leads.create",
    table: "leads",
    atLeast: 1,
    guide: "leads-and-customers",
  },
  {
    key: "itinerary",
    title: "Build an itinerary",
    hint: "Day-by-day plan you can turn into a quotation.",
    href: "/itineraries/new",
    permission: "itineraries.create",
    table: "itineraries",
    atLeast: 1,
    guide: "itineraries-and-packages",
  },
  {
    key: "quotation",
    title: "Send a quotation",
    hint: "A branded PDF with prices and terms.",
    href: "/quotations/new",
    permission: "quotes.create",
    table: "quotations",
    atLeast: 1,
    guide: "quotations",
  },
  {
    key: "booking",
    title: "Confirm a booking",
    hint: "Track travellers, suppliers, vouchers and payments.",
    href: "/bookings",
    permission: "bookings.create",
    table: "bookings",
    atLeast: 1,
    guide: "bookings",
  },
];
