import { describe, expect, it } from "vitest";
import { AppError, toSafeError } from "@/lib/utils/errors";

describe("toSafeError", () => {
  it("passes AppError messages through", () => {
    expect(toSafeError(new AppError("Nope", "X", 403))).toEqual({
      message: "Nope",
      code: "X",
      status: 403,
    });
  });

  it("hides internal error details", () => {
    const safe = toSafeError(new Error('relation "leads" does not exist'));
    expect(safe.message).not.toContain("relation");
    expect(safe.status).toBe(500);
  });
});
