import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanText } from "../../scripts/scan-secrets.mjs";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

describe("secret scan", () => {
  it("flags credential-looking text and ignores placeholders", () => {
    expect(scanText("-----BEGIN PRIVATE KEY-----")).toContain("private key block");
    expect(scanText("OPENAI=sk-" + "a".repeat(40))).toContain("OpenAI-style key");
    expect(scanText("postgresql://postgres:Hunter2Hunter2@db.example.com:5432/x")).toContain(
      "Postgres URL with password",
    );
    expect(scanText("postgresql://postgres:[YOUR-PASSWORD]@db.example.com/x")).toEqual([]);
    expect(scanText("postgres://user:password@localhost/db")).toEqual([]);
  });
});

describe("API routes", () => {
  const routes = walk(join(process.cwd(), "app", "api"));
  const text = (p: string) => readFileSync(p, "utf8");

  it("public portal routes that change state check the request origin", () => {
    const pay = routes.find((r) => r.replace(/\\/g, "/").endsWith("portal/[token]/pay/route.ts"))!;
    expect(text(pay)).toContain("sameOrigin(");
  });

  it("every route that changes state authenticates, checks a secret, or verifies a signature", () => {
    const mutating = routes.filter((r) =>
      /export async function (POST|PUT|PATCH|DELETE)/.test(text(r)),
    );
    expect(mutating.length).toBeGreaterThan(0);
    for (const r of mutating) {
      const t = text(r);
      const ok =
        /getSessionContext|requireOrgSession|requirePermission|CRON_SECRET|verifyWebhook|signature|isPortalToken/i.test(
          t,
        );
      expect(ok, `${r} changes state without an obvious identity check`).toBe(true);
    }
  });
});
