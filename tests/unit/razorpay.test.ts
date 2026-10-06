import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWebhookPayload, toMinorUnits, verifyWebhookSignature } from "@/lib/payments/razorpay";
import { manualPaymentSchema, scheduleSchema } from "@/lib/payments/schema";

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ event: "payment.captured" });
  it("accepts a correct signature", () => {
    expect(verifyWebhookSignature(body, sign(body, "s3cret"), "s3cret")).toBe(true);
  });
  it("rejects wrong secret, tampered body, missing or malformed signatures", () => {
    expect(verifyWebhookSignature(body, sign(body, "other"), "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body + " ", sign(body, "s3cret"), "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, null, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, "", "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, "abc", "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, "s3cret"), "")).toBe(false);
  });
});

describe("toMinorUnits", () => {
  it("converts without float drift", () => {
    expect(toMinorUnits(30000)).toBe(3000000);
    expect(toMinorUnits(0.29)).toBe(29);
    expect(toMinorUnits(1.005)).toBe(101);
    expect(toMinorUnits(87150.1)).toBe(8715010);
  });
});

describe("parseWebhookPayload", () => {
  it("extracts only the fields we use", () => {
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_1",
            order_id: "order_1",
            amount: 5000,
            currency: "INR",
            email: "a@b.c",
          },
        },
      },
    });
    expect(parseWebhookPayload(raw)).toEqual({
      type: "payment.captured",
      orderId: "order_1",
      paymentId: "pay_1",
      amount: 5000,
      currency: "INR",
    });
  });
  it("returns null for malformed input and ignores wrongly typed fields", () => {
    expect(parseWebhookPayload("not json")).toBeNull();
    expect(parseWebhookPayload("{}")).toBeNull();
    expect(parseWebhookPayload(JSON.stringify({ event: 5 }))).toBeNull();
    const odd = parseWebhookPayload(
      JSON.stringify({
        event: "x",
        payload: { payment: { entity: { order_id: 7, amount: "5" } } },
      }),
    );
    expect(odd).toMatchObject({ orderId: null, amount: null });
  });
});

describe("payment schemas", () => {
  it("accepts amounts with commas and rejects zero, negatives and 3 decimals", () => {
    const ok = manualPaymentSchema.safeParse({
      amount: "1,25,000.50",
      method: "UPI",
      reference: "",
    });
    expect(ok.success && ok.data.amount).toBe(125000.5);
    for (const amount of ["0", "-5", "1.234", "abc"]) {
      expect(manualPaymentSchema.safeParse({ amount, method: "CASH" }).success).toBe(false);
    }
    expect(manualPaymentSchema.safeParse({ amount: "10", method: "RAZORPAY" }).success).toBe(false);
  });
  it("requires a due date for instalments", () => {
    expect(scheduleSchema.safeParse({ label: "Deposit", dueDate: "", amount: "100" }).success).toBe(
      false,
    );
    expect(
      scheduleSchema.safeParse({ label: "Deposit", dueDate: "2026-12-01", amount: "100" }).success,
    ).toBe(true);
  });
});
