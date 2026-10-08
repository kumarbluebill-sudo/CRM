import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(import.meta.dirname, "../../database/migrations");

/**
 * On Supabase, extension functions (pgcrypto, etc.) live in the `extensions` schema, which functions that pin
 * `search_path = public` cannot see. The local test database puts them in `public`, so tests would not catch a call
 * that only fails on the real platform. This guard keeps migrations on built-in functions.
 */
describe("migrations are portable to Supabase", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  it("never call pgcrypto functions", () => {
    const banned =
      /\b(gen_random_bytes|digest|hmac|crypt|gen_salt|pgp_sym_\w+|pgp_pub_\w+|encrypt|decrypt)\s*\(/i;
    const offenders = files.filter((f) => {
      const sql = readFileSync(path.join(dir, f), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      return banned.test(sql);
    });
    expect(offenders).toEqual([]);
  });

  it("use only built-in uuid generation", () => {
    const all = files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
    expect(all).not.toMatch(/uuid_generate_v\d/i);
    expect(all).toMatch(/gen_random_uuid\(\)/);
  });
});
