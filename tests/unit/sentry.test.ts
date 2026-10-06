import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDsn, reportToSentry } from "@/lib/utils/sentry";
import { logger } from "@/lib/utils/logger";

describe("parseDsn", () => {
  it("extracts the envelope endpoint and public key", () => {
    expect(parseDsn("https://abc123@o1.ingest.sentry.io/456")).toEqual({
      endpoint: "https://o1.ingest.sentry.io/api/456/envelope/",
      key: "abc123",
    });
  });
  it("rejects anything that isn't an https DSN with a numeric project", () => {
    for (const bad of ["", "http://k@h/1", "https://h/1", "https://k@h/notnumber", "garbage"])
      expect(parseDsn(bad)).toBeNull();
  });
});

describe("reportToSentry", () => {
  beforeEach(() => {
    vi.stubEnv("SENTRY_DSN", "https://abc123@o1.ingest.sentry.io/456");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends a valid envelope containing only the message and redacted context", () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    logger.error("payment failed", { code: "X1", password: "hunter2", token: "t" });
    // other tests may have used up the per-minute cap in this process; send directly with a far-future clock too
    reportToSentry("error", "direct", { a: 1 }, Date.now() + 3_600_000);
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/456/envelope/");
    expect((init.headers as Record<string, string>)["x-sentry-auth"]).toContain(
      "sentry_key=abc123",
    );
    const lines = String(init.body).split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1])).toEqual({ type: "event" });
    const event = JSON.parse(lines[2]);
    expect(event.message).toBe("payment failed");
    expect(event.extra).toEqual({ code: "X1", password: "[REDACTED]", token: "[REDACTED]" });
    expect(String(init.body)).not.toContain("hunter2");
  });

  it("does nothing without a DSN, and never throws when the network fails", () => {
    vi.stubEnv("SENTRY_DSN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    reportToSentry("error", "x", {}, Date.now() + 7_200_000);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("SENTRY_DSN", "https://abc123@o1.ingest.sentry.io/456");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(() => reportToSentry("error", "x", {}, Date.now() + 10_800_000)).not.toThrow();
  });

  it("caps events per minute", () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const t = Date.now() + 20_000_000;
    for (let i = 0; i < 50; i++) reportToSentry("error", `e${i}`, {}, t);
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });
});
