import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPABASE_STUB } from "../helpers/db";

/**
 * Runs the real scripts/migrate.mjs against a throwaway Postgres reached over a socket, so the production migration
 * path is exercised, not just the SQL.
 */
describe("scripts/migrate.mjs", () => {
  const repo = path.resolve(import.meta.dirname, "../..");
  const PORT = 54329;
  const url = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
  let db: PGlite;
  let server: PGLiteSocketServer;
  let sandbox: string;

  // Must be async: the database server lives in THIS process, so a blocking call would deadlock it.
  const run = (...args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      execFile(
        "node",
        [path.join(sandbox, "scripts/migrate.mjs"), ...args],
        { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" },
        (error, stdout, stderr) =>
          resolve({
            code: error ? ((error as { code?: number }).code ?? 1) : 0,
            out: `${stdout}${stderr}`,
          }),
      );
    });

  beforeAll(async () => {
    // Copy the script and migrations to a sandbox so the drift test can edit a file without touching the repo.
    // Inside the repository so `pg` resolves from its node_modules (the folder is git-ignored).
    sandbox = mkdtempSync(path.join(repo, ".test-tmp-migrate-"));
    mkdirSync(path.join(sandbox, "scripts"));
    mkdirSync(path.join(sandbox, "database/migrations"), { recursive: true });
    copyFileSync(path.join(repo, "scripts/migrate.mjs"), path.join(sandbox, "scripts/migrate.mjs"));
    for (const f of readdirSync(path.join(repo, "database/migrations")))
      copyFileSync(
        path.join(repo, "database/migrations", f),
        path.join(sandbox, "database/migrations", f),
      );
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(SUPABASE_STUB);
    server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 4 });
    await server.start();
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
    await db?.close();
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("shows everything pending on a fresh database, and a dry run changes nothing", async () => {
    const status = await run("--status");
    expect(status.out).toMatch(/pending\s+001_initial_schema\.sql/);
    expect((await run("--dry-run")).out).toContain("Would apply");
    expect((await run("--status")).out).not.toMatch(/applied\s+001_/);
  });

  it("applies every migration in order, once", async () => {
    const first = await run();
    expect(first.code, first.out).toBe(0);
    expect(first.out).toMatch(/Applied \d+ migration/);
    const again = await run();
    expect(again.out).toContain("up to date");
    expect((await run("--status")).out).not.toMatch(/pending/);
  }, 180_000);

  it("refuses to continue when an applied migration was edited (drift)", async () => {
    writeFileSync(
      path.join(sandbox, "database/migrations/001_initial_schema.sql"),
      "-- edited after being applied\nselect 1;\n",
    );
    const r = await run();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/edited/);
    expect((await run("--status")).out).toMatch(/DRIFT\s+001_initial_schema\.sql/);
  });

  it("rolls back a failing migration completely and reports it", async () => {
    copyFileSync(
      path.join(repo, "database/migrations/001_initial_schema.sql"),
      path.join(sandbox, "database/migrations/001_initial_schema.sql"),
    );
    writeFileSync(
      path.join(sandbox, "database/migrations/999_broken.sql"),
      "create table public.should_not_exist (id int);\nselect * from public.does_not_exist;\n",
    );
    const r = await run();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/999_broken\.sql/);
    expect(r.out).toMatch(/Nothing from this file was applied/);
  });
});
