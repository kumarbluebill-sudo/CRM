#!/usr/bin/env node
/**
 * Applies database/migrations/*.sql, in filename order, to a Postgres database (Supabase included).
 *
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs            apply pending migrations
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs --status   show applied / pending / drifted
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs --dry-run  list what would run
 *
 * - Each migration runs in its own transaction and is recorded in public.schema_migrations with a checksum.
 * - A migration already applied whose file has since CHANGED stops the run ("drift"): never edit an applied
 *   migration, add a new one.
 * - A Postgres advisory lock prevents two deploys from migrating at once.
 * - Use the DIRECT connection string (port 5432), or the pooler in session mode, not transaction mode.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../database/migrations");
const args = new Set(process.argv.slice(2));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const checksum = (f) =>
  createHash("sha256")
    .update(readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n"))
    .digest("hex");

const client = new pg.Client({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
});

/** Returns the process exit code. Cleanup (unlock + disconnect) always runs because nothing exits early. */
async function main() {
  await client.query("select pg_advisory_lock(727274)");
  await client.query(`create table if not exists public.schema_migrations (
    filename text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  // No policies: only the table owner can read it.
  await client.query("alter table public.schema_migrations enable row level security");
  const applied = new Map(
    (await client.query("select filename, checksum from public.schema_migrations")).rows.map(
      (r) => [r.filename, r.checksum],
    ),
  );

  const drifted = files.filter((f) => applied.has(f) && applied.get(f) !== checksum(f));
  const missing = [...applied.keys()].filter((f) => !files.includes(f));
  const pending = files.filter((f) => !applied.has(f));

  if (args.has("--status")) {
    for (const f of files) {
      const state = applied.has(f) ? (drifted.includes(f) ? "DRIFT  " : "applied") : "pending";
      console.log(`${state}  ${f}`);
    }
    for (const f of missing) console.log(`MISSING  ${f} (applied but no longer in the repository)`);
    return drifted.length ? 1 : 0;
  }
  if (drifted.length) {
    console.error("Refusing to continue: these applied migrations were edited:");
    for (const f of drifted) console.error("  " + f);
    console.error("Add a new migration instead.");
    return 1;
  }
  if (pending.length === 0) {
    console.log("Database is up to date.");
    return 0;
  }
  if (args.has("--dry-run")) {
    console.log("Would apply:");
    for (const f of pending) console.log("  " + f);
    return 0;
  }
  for (const f of pending) {
    const sql = readFileSync(path.join(dir, f), "utf8");
    process.stdout.write(`applying ${f} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into public.schema_migrations (filename, checksum) values ($1, $2)",
        [f, checksum(f)],
      );
      await client.query("commit");
      console.log("ok");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      console.log("FAILED");
      console.error(`${f}: ${error.message}`);
      console.error("Nothing from this file was applied. Fix it and re-run.");
      return 1;
    }
  }
  console.log(`Applied ${pending.length} migration(s).`);
  return 0;
}

let code = 1;
try {
  await client.connect();
  code = await main();
} catch (error) {
  console.error(`Could not run migrations: ${error.message}`);
} finally {
  await client.query("select pg_advisory_unlock(727274)").catch(() => {});
  await client.end().catch(() => {});
}
process.exit(code);
