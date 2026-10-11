#!/usr/bin/env node
/**
 * Proves a backup file can be restored, WITHOUT touching any real database: it decrypts and checks the file, builds a
 * scratch Postgres (PGlite) from the repository's migrations, loads every row into it and compares the counts.
 *
 *   BACKUP_ENCRYPTION_KEY=<base64> node scripts/restore-check.mjs <file.crmbk> <organization-id>
 *   (add --env-file=.env.local to read the key from there)
 *
 * Exit 0 only if the file is intact and every table restores with the same number of rows.
 * This is the drill to run before trusting a backup, and the first step of a real restore (see docs/RUNBOOK.md).
 */
import { createDecipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createTestDb } from "../tests/helpers/db.ts";

const [file, org] = process.argv.slice(2);
if (!file || !org) {
  console.error("Usage: node scripts/restore-check.mjs <file.crmbk> <organization-id>");
  process.exit(2);
}
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY ?? "", "base64");
if (key.length !== 32) {
  console.error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64.");
  process.exit(2);
}

const fail = (msg) => {
  console.error(`FAILED: ${msg}`);
  process.exit(1);
};

const sealed = readFileSync(file);
const MAGIC = Buffer.from("CRMBK1\n", "utf8");
if (sealed.length < MAGIC.length + 28 || !sealed.subarray(0, MAGIC.length).equals(MAGIC))
  fail("this is not a backup file, or it is damaged");
console.log(`file sha256: ${createHash("sha256").update(sealed).digest("hex")}`);

let gz;
try {
  const d = createDecipheriv("aes-256-gcm", key, sealed.subarray(MAGIC.length, MAGIC.length + 12));
  d.setAAD(Buffer.from(`crm-backup:${org}`, "utf8"));
  d.setAuthTag(sealed.subarray(MAGIC.length + 12, MAGIC.length + 28));
  gz = Buffer.concat([d.update(sealed.subarray(MAGIC.length + 28)), d.final()]);
} catch {
  fail("cannot decrypt: the file is damaged, the key is wrong, or it belongs to another agency");
}

const tables = {};
let header;
let footer;
try {
  const lines = gunzipSync(gz).toString("utf8").split("\n").filter(Boolean);
  header = JSON.parse(lines[0]);
  for (const t of header.tables) tables[t] = [];
  for (const line of lines.slice(1)) {
    const o = JSON.parse(line);
    if (o.end) footer = o;
    else tables[o.t].push(o.r);
  }
} catch {
  fail("the backup is corrupt");
}
if (!footer) fail("the backup is incomplete (cut short)");
if (header.organizationId !== org) fail("the backup belongs to a different agency");
for (const [t, rows] of Object.entries(tables))
  if (footer.rowCounts[t] !== rows.length) fail(`row count mismatch in ${t}`);
console.log(`backup taken ${header.createdAt}, ${header.tables.length} tables`);

console.log("building a scratch database from the migrations…");
const db = await createTestDb();
await db.exec("set session_replication_role = replica");
for (const [t, rows] of Object.entries(tables)) {
  if (!rows.length) continue;
  await db.query(
    `insert into public."${t}" select * from jsonb_populate_recordset(null::public."${t}", $1::jsonb)`,
    [JSON.stringify(rows)],
  );
}
await db.exec("set session_replication_role = origin");

let bad = 0;
let total = 0;
for (const [t, rows] of Object.entries(tables)) {
  const { rows: r } = await db.query(`select count(*)::int as n from public."${t}"`);
  const ok = r[0].n === rows.length;
  total += r[0].n;
  if (!ok) bad++;
  if (rows.length || !ok) console.log(`${ok ? "ok  " : "FAIL"} ${t.padEnd(32)} ${String(r[0].n).padStart(7)} / ${rows.length}`);
}
await db.close();
if (bad) fail(`${bad} table(s) did not restore completely`);
console.log(`\nPASSED: ${total} rows restored into a scratch database and counted. No real database was touched.`);
