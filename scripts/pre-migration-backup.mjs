#!/usr/bin/env node
/**
 * Takes a full-database safety copy BEFORE applying migrations to a real database.
 *
 *   DATABASE_URL=postgres://… node scripts/pre-migration-backup.mjs
 *
 * Uses pg_dump (custom format) when it is installed. Otherwise exports every table in the public schema as
 * compressed NDJSON and, if BACKUP_ENCRYPTION_KEY is set, encrypts it (it refuses to write a plaintext copy unless
 * you pass --plain). Output goes to ./backups (git-ignored) or BACKUP_LOCAL_DIR. Move the file somewhere safe: this
 * script never uploads anything and never changes the database.
 *
 * This is a safety net for a deploy, not a substitute for the hosting provider's point-in-time recovery.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}
const plain = process.argv.includes("--plain");
const outDir = path.resolve(process.env.BACKUP_LOCAL_DIR || "backups");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const dump = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
if (dump.status === 0) {
  const out = path.join(outDir, `pre-migration-${stamp}.dump`);
  const r = spawnSync("pg_dump", ["--format=custom", "--no-owner", `--file=${out}`, url], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("pg_dump failed.");
    process.exit(1);
  }
  console.log(`pg_dump written: ${out}\nRestore with: pg_restore --clean --if-exists --no-owner -d <url> ${out}`);
  process.exit(0);
}

const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY ?? "", "base64");
if (key.length !== 32 && !plain) {
  console.error("pg_dump is not installed and BACKUP_ENCRYPTION_KEY is not set. Refusing to write an unencrypted copy (use --plain to override).");
  process.exit(2);
}
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("begin isolation level repeatable read read only");
  const { rows: tables } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
  );
  const lines = [JSON.stringify({ format: "crm-pre-migration", createdAt: new Date().toISOString(), tables: tables.map((t) => t.table_name) })];
  const counts = {};
  for (const { table_name: t } of tables) {
    const { rows } = await client.query(`select to_jsonb(x) as r from public."${t}" x`);
    counts[t] = rows.length;
    for (const row of rows) lines.push(JSON.stringify({ t, r: row.r }));
  }
  lines.push(JSON.stringify({ end: true, rowCounts: counts }));
  await client.query("commit");
  let data = gzipSync(Buffer.from(lines.join("\n") + "\n"));
  let name = `pre-migration-${stamp}.ndjson.gz`;
  if (key.length === 32) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update(data), c.final()]);
    data = Buffer.concat([Buffer.from("CRMPM1\n"), iv, c.getAuthTag(), ct]);
    name += ".enc";
  }
  writeFileSync(path.join(outDir, name), data);
  console.log(`Written: ${path.join(outDir, name)} (${Object.values(counts).reduce((a, b) => a + b, 0)} rows in ${tables.length} tables)`);
} finally {
  await client.end();
}
