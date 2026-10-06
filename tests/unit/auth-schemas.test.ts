import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, resetPasswordSchema } from "@/lib/auth/schemas";

describe("auth schemas", () => {
  it("normalizes email on login", () => {
    const r = loginSchema.parse({ email: "  A@B.COM ", password: "x" });
    expect(r.email).toBe("a@b.com");
  });

  it("rejects weak passwords on register", () => {
    for (const password of ["short1A", "alllowercase123", "ALLUPPERCASE123", "NoNumbersHere"]) {
      expect(
        registerSchema.safeParse({ fullName: "Asha K", email: "a@b.com", password }).success,
      ).toBe(false);
    }
    expect(
      registerSchema.safeParse({ fullName: "Asha K", email: "a@b.com", password: "Str0ngPassw0rd" })
        .success,
    ).toBe(true);
  });

  it("requires matching passwords on reset", () => {
    const r = resetPasswordSchema.safeParse({
      password: "Str0ngPassw0rd",
      confirm: "Different1Pass",
    });
    expect(r.success).toBe(false);
  });
});
