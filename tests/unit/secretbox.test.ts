import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/crypto/secretbox";

const key = randomBytes(32);
const ORG = "11111111-1111-1111-1111-111111111111";

describe("secretbox (AES-256-GCM)", () => {
  it("round-trips and never stores plaintext", () => {
    const sealed = encryptSecret("rzp-secret-value", key, ORG);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("rzp-secret-value");
    expect(decryptSecret(sealed, key, ORG)).toBe("rzp-secret-value");
  });
  it("uses a fresh IV every time", () => {
    expect(encryptSecret("x", key, ORG)).not.toBe(encryptSecret("x", key, ORG));
  });
  it("refuses a different key, a different organization, tampering and bad formats", () => {
    const sealed = encryptSecret("secret", key, ORG);
    expect(() => decryptSecret(sealed, randomBytes(32), ORG)).toThrow();
    expect(() => decryptSecret(sealed, key, "22222222-2222-2222-2222-222222222222")).toThrow();
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered!!").toString("base64url");
    expect(() => decryptSecret(parts.join(":"), key, ORG)).toThrow();
    expect(() => decryptSecret("v2:a:b:c", key, ORG)).toThrow();
    expect(() => decryptSecret("garbage", key, ORG)).toThrow();
  });
  it("requires a 32-byte key", () => {
    expect(() => parseKey(undefined)).toThrow();
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow();
    expect(parseKey(key.toString("base64")).length).toBe(32);
  });
});
