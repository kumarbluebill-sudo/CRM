import { createHash, randomBytes } from "node:crypto";

/** 256 bits of randomness, URL-safe (43 characters). */
export function generatePortalToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored; the raw token exists in the link and nowhere else. */
export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const isPortalToken = (v: string) => /^[A-Za-z0-9_-]{43}$/.test(v);
