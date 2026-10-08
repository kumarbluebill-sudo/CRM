import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPABASE_STUB } from "../helpers/db";

const repo = path.resolve(import.meta.dirname, "../..");

describe("database/bundle.sql (paste into the Supabase SQL Editor)", () => {
  let db: PGlite;
  const migrations = readdirSync(path.join(repo, "database/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  beforeAll(async () => {
    execFileSync("node", [path.join(repo, "scripts/bundle-sql.mjs")], { stdio: "ignore" });
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(SUPABASE_STUB);
  }, 60_000);
  afterAll(async () => db.close());

  it("applies to an empty database in one go and records every migration with its checksum", async () => {
    await db.exec(readFileSync(path.join(repo, "database/bundle.sql"), "utf8"));
    const rows = (
      await db.query<{ filename: string; checksum: string }>(
        "select filename, checksum from public.schema_migrations order by filename",
      )
    ).rows;
    expect(rows.map((r) => r.filename)).toEqual(migrations);
    for (const r of rows) {
      const sql = readFileSync(path.join(repo, "database/migrations", r.filename), "utf8").replace(
        /\r\n/g,
        "\n",
      );
      expect(r.checksum, r.filename).toBe(createHash("sha256").update(sql).digest("hex"));
    }
  });

  it("produces a working schema (an organization can be created)", async () => {
    const uid = (
      await db.query<{ id: string }>(
        "insert into auth.users (email) values ('o@x.test') returning id",
      )
    ).rows[0].id;
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`,
    );
    const org = (
      await db.query<{ create_organization: string }>(
        "select public.create_organization('Bundle Test Agency')",
      )
    ).rows[0];
    await db.exec("reset role;");
    expect(org.create_organization).toMatch(/^[0-9a-f-]{36}$/);
    const sub = await db.query<{ plan_key: string; status: string }>(
      "select plan_key, status from subscriptions",
    );
    expect(sub.rows).toEqual([{ plan_key: "PRO", status: "TRIALING" }]);
  });
});
