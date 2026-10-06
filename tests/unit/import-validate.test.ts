import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMPORT_BYTES, safeDisplayName, validateImportFile } from "@/lib/import/validate";
import { redactForAi } from "@/lib/import/ai";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const TEXT = new TextEncoder().encode("Day 1 - Arrival");
const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("validateImportFile", () => {
  it("accepts valid PDF, DOCX, XLSX and TXT", () => {
    expect(validateImportFile(file("a.pdf", "application/pdf"), PDF)).toMatchObject({
      ok: true,
      type: "PDF",
    });
    expect(
      validateImportFile(
        file("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ZIP,
      ),
    ).toMatchObject({ ok: true, type: "DOCX" });
    expect(
      validateImportFile(
        file("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ZIP,
      ),
    ).toMatchObject({ ok: true, type: "XLSX" });
    expect(validateImportFile(file("a.txt", "text/plain"), TEXT)).toMatchObject({
      ok: true,
      type: "TXT",
    });
  });

  it("rejects invalid extensions", () => {
    for (const n of ["a.exe", "a.js", "a.pdf.exe", "a", "a.docm", "a.html"]) {
      expect(validateImportFile(file(n, "application/pdf"), PDF).ok, n).toBe(false);
    }
  });

  it("rejects an extension/MIME mismatch", () => {
    expect(validateImportFile(file("a.pdf", "image/png"), PDF).ok).toBe(false);
    expect(validateImportFile(file("a.docx", "application/pdf"), ZIP).ok).toBe(false);
  });

  it("rejects files whose real signature does not match the extension", () => {
    expect(
      validateImportFile(
        file("fake.pdf", "application/pdf"),
        new TextEncoder().encode("MZ\x90 executable"),
      ).ok,
    ).toBe(false);
    expect(validateImportFile(file("fake.docx", ""), PDF).ok).toBe(false);
    expect(validateImportFile(file("bin.txt", "text/plain"), new Uint8Array([65, 0, 66])).ok).toBe(
      false,
    );
  });

  it("rejects empty and oversized files", () => {
    expect(validateImportFile(file("a.pdf", "application/pdf", 0), PDF).ok).toBe(false);
    expect(validateImportFile(file("a.pdf", "application/pdf", MAX_IMPORT_BYTES + 1), PDF).ok).toBe(
      false,
    );
    expect(validateImportFile(file("a.pdf", "application/pdf", MAX_IMPORT_BYTES), PDF).ok).toBe(
      true,
    );
  });
});

describe("safeDisplayName", () => {
  it("strips paths and unsafe characters", () => {
    expect(safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(safeDisplayName("C:\\Users\\x\\my<script>.pdf")).toBe("my_script_.pdf");
    expect(safeDisplayName("")).toBe("document");
    expect(safeDisplayName("a".repeat(300) + ".pdf").length).toBeLessThanOrEqual(100);
  });
});

describe("redactForAi (data minimization)", () => {
  it("removes emails, phone numbers and passport-like ids before AI use", () => {
    const out = redactForAi(
      "Contact john@x.com or +91 98765 43210. Passport A1234567. Hotel Atlantis, Dubai.",
    );
    expect(out).not.toMatch(/john@x\.com|98765|A1234567/);
    expect(out).toContain("Hotel Atlantis, Dubai");
  });
});

describe("rateLimit (in-memory fallback)", () => {
  beforeEach(() => resetRateLimits());
  it("blocks after the limit and recovers after the window", async () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect((await rateLimit("k", 3, 1000, t)).allowed).toBe(true);
    const blocked = await rateLimit("k", 3, 1000, t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await rateLimit("k", 3, 1000, t + 1001)).allowed).toBe(true);
    expect((await rateLimit("other", 3, 1000, t)).allowed).toBe(true);
  });
});

describe("rateLimit (Upstash)", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const redis = (count: number, ttl = 30000) =>
    vi.fn(
      async () => new Response(JSON.stringify([{ result: count }, { result: 1 }, { result: ttl }])),
    );

  it("uses shared counters and authenticates with the token", async () => {
    const fetchMock = redis(2);
    vi.stubGlobal("fetch", fetchMock);
    const r = await rateLimit("login:1.2.3.4", 3, 60_000);
    expect(r).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.upstash.io/pipeline");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(String(init.body)).toContain("rl:login:1.2.3.4");
  });
  it("blocks above the limit and reports when to retry", async () => {
    vi.stubGlobal("fetch", redis(4, 12_000));
    expect(await rateLimit("k", 3, 60_000)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 12,
    });
  });
  it("falls back to the in-memory limiter when Redis is down (still limits, never throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    for (let i = 0; i < 2; i++) expect((await rateLimit("k", 2, 60_000)).allowed).toBe(true);
    expect((await rateLimit("k", 2, 60_000)).allowed).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    expect((await rateLimit("fresh", 2, 60_000)).allowed).toBe(true);
  });
});
