import { describe, expect, it } from "vitest";
import {
  maskPassport,
  passportExpiryWarning,
  passportSchema,
  passengerSchema,
  supplierSchema,
  bookingUpdateSchema,
} from "@/lib/booking/schema";
import {
  MAX_DOCUMENT_BYTES,
  safeDocumentName,
  validateDocumentFile,
} from "@/lib/documents/validate";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("passport helpers", () => {
  it("masks all but the last three characters", () => {
    expect(maskPassport("M1234567")).toBe("•••••567");
    expect(maskPassport("AB1")).toBe("•••");
    expect(maskPassport("M1234567")).not.toContain("1234");
  });

  it("normalises and validates passport numbers", () => {
    expect(passportSchema.parse({ passportNumber: " m 123 4567 " }).passportNumber).toBe(
      "M1234567",
    );
    for (const bad of ["abc", "bad number!", "A".repeat(13), "<script>"]) {
      expect(passportSchema.safeParse({ passportNumber: bad }).success, bad).toBe(false);
    }
  });

  it("warns when a passport expires before or within 6 months of the trip end", () => {
    expect(passportExpiryWarning("2026-01-01", "2026-06-01")).toMatch(/before the trip/);
    expect(passportExpiryWarning("2026-09-01", "2026-06-01")).toMatch(/6 months/);
    expect(passportExpiryWarning("2030-01-01", "2026-06-01")).toBeNull();
    expect(passportExpiryWarning(null, "2026-06-01")).toBeNull();
  });
});

describe("booking and supplier schemas", () => {
  it("validates passengers", () => {
    expect(passengerSchema.safeParse({ fullName: "A" }).success).toBe(false);
    expect(
      passengerSchema.parse({ fullName: "Asha Sharma", gender: "", dateOfBirth: "" }).gender,
    ).toBeUndefined();
    expect(passengerSchema.safeParse({ fullName: "Asha Sharma", gender: "ROBOT" }).success).toBe(
      false,
    );
  });

  it("rejects a return date before departure", () => {
    expect(
      bookingUpdateSchema.safeParse({
        title: "Trip",
        travelStart: "2026-12-10",
        travelEnd: "2026-12-01",
      }).success,
    ).toBe(false);
    expect(
      bookingUpdateSchema.safeParse({
        title: "Trip",
        travelStart: "2026-12-10",
        travelEnd: "2026-12-12",
      }).success,
    ).toBe(true);
  });

  it("validates suppliers", () => {
    const ok = { type: "HOTEL", companyName: "Atlantis", isActive: "on" };
    expect(supplierSchema.parse(ok).isActive).toBe(true);
    expect(supplierSchema.safeParse({ ...ok, type: "SPACESHIP" }).success).toBe(false);
    expect(supplierSchema.safeParse({ ...ok, phone: "abc" }).success).toBe(false);
    expect(supplierSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false);
  });
});

describe("validateDocumentFile", () => {
  it("accepts every allowed type with the right signature", () => {
    expect(validateDocumentFile(f("a.pdf", "application/pdf"), PDF)).toMatchObject({
      ok: true,
      mime: "application/pdf",
    });
    expect(validateDocumentFile(f("a.png", "image/png"), PNG)).toMatchObject({
      ok: true,
      ext: "png",
    });
    expect(validateDocumentFile(f("a.jpeg", "image/jpeg"), JPG)).toMatchObject({
      ok: true,
      ext: "jpg",
    });
    expect(validateDocumentFile(f("a.docx", ""), ZIP).ok).toBe(true);
    expect(validateDocumentFile(f("a.xlsx", "application/octet-stream"), ZIP).ok).toBe(true);
    expect(
      validateDocumentFile(f("a.txt", "text/plain"), new TextEncoder().encode("hello")).ok,
    ).toBe(true);
  });

  it("rejects dangerous or mismatched files", () => {
    for (const name of ["a.exe", "a.svg", "a.html", "a.js", "a.pdf.exe", "a"]) {
      expect(validateDocumentFile(f(name, "application/pdf"), PDF).ok, name).toBe(false);
    }
    expect(validateDocumentFile(f("a.pdf", "image/png"), PDF).ok).toBe(false); // MIME mismatch
    expect(validateDocumentFile(f("fake.pdf", "application/pdf"), PNG).ok).toBe(false); // wrong signature
    expect(
      validateDocumentFile(f("fake.png", "image/png"), new TextEncoder().encode("MZ exe")).ok,
    ).toBe(false);
    expect(validateDocumentFile(f("a.pdf", "application/pdf", 0), PDF).ok).toBe(false);
    expect(
      validateDocumentFile(f("a.pdf", "application/pdf", MAX_DOCUMENT_BYTES + 1), PDF).ok,
    ).toBe(false);
  });

  it("sanitises display names", () => {
    expect(safeDocumentName("../../etc/passwd")).toBe("passwd");
    expect(safeDocumentName("my<passport>.pdf")).toBe("my_passport_.pdf");
  });
});
