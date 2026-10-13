import { describe, expect, it } from "vitest";
import { NAV_GROUPS, activeHrefFor, visibleNav } from "@/components/layout/nav-config";
import { ROW, ROW_ACTIVE, ROW_IDLE } from "@/components/layout/nav-styles";
import { PERMISSIONS } from "@/lib/permissions";

const labelsOf = (title: string) =>
  NAV_GROUPS.find((g) => g.title?.toLowerCase() === title.toLowerCase())?.items.map((i) => i.label);

describe("sidebar sections", () => {
  it("starts with the four requested sections, in order", () => {
    expect(NAV_GROUPS.slice(0, 4).map((g) => g.title)).toEqual([
      "Main menu",
      "Sales & travel",
      "Operations",
      "Management",
    ]);
    expect(labelsOf("Main menu")).toEqual(["Dashboard", "Leads", "Customers", "Enquiries"]);
    expect(labelsOf("Sales & travel")).toEqual([
      "Itineraries",
      "Quotations",
      "Bookings",
      "Job Orders",
    ]);
    expect(labelsOf("Operations")).toEqual([
      "Suppliers",
      "Payments & Billing",
      "Documents",
      "Follow-ups",
      "Notifications",
    ]);
    expect(labelsOf("Management")).toEqual([
      "Reports",
      "Staff & Permissions",
      "Subscription & Plans",
      "Settings",
    ]);
  });

  it("keeps every other page reachable in sections below, without duplicates", () => {
    const rest = NAV_GROUPS.slice(4);
    expect(rest.map((g) => g.title)).toEqual(["Visa", "Communications", "More"]);
    const labels = rest.flatMap((g) => g.items.map((i) => i.label));
    for (const l of [
      "Tasks",
      "Invoices",
      "Receipts",
      "AI Assistant",
      "Help center",
      "Visa dashboard",
      "Outbox",
    ]) {
      expect(labels).toContain(l);
    }
    const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(NAV_GROUPS.every((g) => g.title)).toBe(true);
  });

  it("points Staff & Permissions and Subscription & Plans at the existing pages with their permissions", () => {
    const all = NAV_GROUPS.flatMap((g) => g.items);
    const staff = all.find((i) => i.label === "Staff & Permissions")!;
    const plans = all.find((i) => i.label === "Subscription & Plans")!;
    expect(staff.href).toBe("/settings/team");
    expect(staff.permission).toBe("users.manage");
    expect(plans.href).toBe("/settings/billing");
    expect([plans.permission].flat()).toEqual(expect.arrayContaining(["billing.manage"]));
    const known = new Set<string>(PERMISSIONS);
    for (const i of all)
      for (const p of [i.permission ?? []].flat()) expect(known.has(p), p).toBe(true);
  });

  it("shows badges only on Follow-ups and Notifications", () => {
    const badged = NAV_GROUPS.flatMap((g) => g.items)
      .filter((i) => i.badge)
      .map((i) => i.label);
    expect(badged.sort()).toEqual(["Follow-ups", "Notifications"]);
  });

  it("gives a viewer a short, valid menu with no empty sections", () => {
    const groups = visibleNav(NAV_GROUPS, (p) => ["leads.view", "customers.view"].includes(p));
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toEqual(
      expect.arrayContaining(["Dashboard", "Leads", "Customers", "Enquiries", "Notifications"]),
    );
    expect(labels).not.toContain("Settings");
    expect(labels).not.toContain("Staff & Permissions");
    expect(labels).not.toContain("Subscription & Plans");
  });
});

describe("which menu item is highlighted", () => {
  const items = NAV_GROUPS.flatMap((g) => g.items);

  it("highlights the item that owns the page", () => {
    expect(activeHrefFor(items, "/leads")).toBe("/leads");
    expect(activeHrefFor(items, "/leads/abc-123")).toBe("/leads");
    expect(activeHrefFor(items, "/payments")).toBe("/payments");
  });

  it("prefers the most specific item", () => {
    expect(activeHrefFor(items, "/payments/invoices")).toBe("/payments/invoices");
    expect(activeHrefFor(items, "/visa/queue")).toBe("/visa/queue");
    expect(activeHrefFor(items, "/visa")).toBe("/visa");
    expect(activeHrefFor(items, "/settings/branding")).toBe("/settings");
    expect(activeHrefFor(items, "/settings")).toBe("/settings");
  });

  it("keeps Staff & Permissions lit on its related settings pages, and Subscription on billing", () => {
    for (const p of [
      "/settings/team",
      "/settings/roles",
      "/settings/staff",
      "/settings/roles/abc",
    ]) {
      expect(activeHrefFor(items, p), p).toBe("/settings/team");
    }
    expect(activeHrefFor(items, "/settings/billing")).toBe("/settings/billing");
  });

  it("highlights nothing for an unknown page, and does not match on a shared prefix", () => {
    expect(activeHrefFor(items, "/nowhere")).toBeUndefined();
    expect(activeHrefFor(items, "/leadsx")).toBeUndefined();
  });
});

describe("row styling", () => {
  it("is shared plain strings, so server and client components render identical rows", () => {
    for (const c of [ROW, ROW_IDLE, ROW_ACTIVE]) expect(typeof c).toBe("string");
    expect(ROW).toContain("h-9");
    expect(ROW).toContain("focus-visible:ring-2"); // a visible keyboard focus state
    expect(ROW).toContain("motion-reduce:transition-none");
    expect(ROW_ACTIVE).toContain("before:bg-sidebar-primary"); // the left indicator
    expect(ROW_IDLE).toContain("hover:");
  });
});
