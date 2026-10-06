import { describe, expect, it } from "vitest";
import {
  fromEditorDoc,
  itineraryDocSchema,
  newDay,
  newItem,
  toEditorDoc,
} from "@/lib/itinerary/schema";

const base = { title: "Dubai 5N", days: [] };

describe("itineraryDocSchema", () => {
  it("accepts a minimal document and normalizes blanks to null", () => {
    const r = itineraryDocSchema.parse({ ...base, destination: "", summary: "  " });
    expect(r.destination).toBeNull();
    expect(r.summary).toBeNull();
    expect(r.status).toBe("DRAFT");
  });

  it("rejects non-https image URLs", () => {
    const item = { type: "ACTIVITY", title: "Tour", imageUrl: "javascript:alert(1)" };
    expect(itineraryDocSchema.safeParse({ ...base, days: [{ items: [item] }] }).success).toBe(
      false,
    );
    expect(
      itineraryDocSchema.safeParse({
        ...base,
        days: [{ items: [{ ...item, imageUrl: "http://x.com/a.jpg" }] }],
      }).success,
    ).toBe(false);
    expect(
      itineraryDocSchema.safeParse({
        ...base,
        days: [{ items: [{ ...item, imageUrl: "https://x.com/a.jpg" }] }],
      }).success,
    ).toBe(true);
  });

  it("validates item type, time and title", () => {
    const day = (i: object) => ({ ...base, days: [{ items: [i] }] });
    expect(itineraryDocSchema.safeParse(day({ type: "BOGUS", title: "x" })).success).toBe(false);
    expect(itineraryDocSchema.safeParse(day({ type: "MEAL", title: "" })).success).toBe(false);
    expect(
      itineraryDocSchema.safeParse(day({ type: "MEAL", title: "x", time: "25:00" })).success,
    ).toBe(false);
    expect(
      itineraryDocSchema.safeParse(day({ type: "MEAL", title: "x", time: "08:30" })).success,
    ).toBe(true);
  });

  it("caps the number of days", () => {
    const days = Array.from({ length: 61 }, () => ({ items: [] }));
    expect(itineraryDocSchema.safeParse({ ...base, days }).success).toBe(false);
  });

  it("does not pass through unknown keys such as organization_id", () => {
    const r = itineraryDocSchema.parse({ ...base, organization_id: "x" });
    expect(r).not.toHaveProperty("organization_id");
  });
});

describe("editor conversion", () => {
  it("round-trips through the editor representation", () => {
    const day = newDay();
    const item = newItem("HOTEL");
    item.title = "Atlantis";
    day.items.push(item);
    const doc = toEditorDoc({ title: "Trip", inclusions: ["a", "b"], days: [] });
    doc.days.push(day);
    const out = itineraryDocSchema.parse(fromEditorDoc(doc));
    expect(out.inclusions).toEqual(["a", "b"]);
    expect(out.days[0].items[0]).toMatchObject({ type: "HOTEL", title: "Atlantis" });
    expect(JSON.stringify(out)).not.toContain("key");
  });
});
