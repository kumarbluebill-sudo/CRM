import type { PGlite } from "@electric-sql/pglite";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";
import { buildArchive, sealArchive, verifyArchive, type ArchiveSource } from "@/lib/backup/archive";

const key = randomBytes(32);

describe("backups, retention, restore plans and a real restore (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let viewer: string;
  let admin: string;

  const q = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const rows = async <T = any>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;
  const sourceFor = (d: PGlite, org: string): ArchiveSource => ({
    tables: async () =>
      (await d.query<{ t: string[] }>("select public.backup_table_list() as t")).rows[0].t,
    rows: async (t, offset, limit) =>
      (
        await d.query<{ r: Record<string, unknown>[] }>(
          "select public.backup_export_rows($1, $2, $3, $4) as r",
          [t, org, offset, limit],
        )
      ).rows[0].r,
  });
  async function finishOk(run: string, org: string, counts = { customers: 1 }) {
    await db.query(
      "select public.backup_finish($1, true, 100, $2, $3::jsonb, $4, 'local', true, null)",
      [run, "a".repeat(64), JSON.stringify(counts), `org/${org}/2026/${run}.crmbk`],
    );
  }
  const begin = async (org: string, kind = "MANUAL", by: string | null = null) =>
    (await rows<{ id: string }>("select public.backup_begin($1, $2, $3) as id", [org, kind, by]))[0]
      .id;

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    admin = await createUser(db, "admin@a.test");
    viewer = await createUser(db, "viewer@a.test");
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1,$2,'ADMIN'), ($1,$3,'VIEWER')",
      [a.orgId, admin, viewer],
    );
    await db.query("update profiles set is_super_admin = true where id = $1", [a.userId]);
    for (const [org, names] of [
      [a.orgId, ["Asha", "Bhaskar", "Chitra"]],
      [b.orgId, ["Other agency customer"]],
    ] as const)
      for (const n of names)
        await db.query("insert into customers (organization_id, name) values ($1, $2)", [org, n]);
  }, 120_000);
  afterAll(async () => db.close());

  it("only people with backup.manage can see or change backup data", async () => {
    // owners hold it by default; admins and viewers do not
    expect((await q(a.userId, "select * from backup_settings")).length).toBe(0);
    await q(a.userId, "select public.save_backup_settings(true, 'DAILY', 30, 3)");
    expect((await q(a.userId, "select * from backup_settings")).length).toBe(1);
    for (const u of [admin, viewer]) {
      expect((await q(u, "select * from backup_settings")).length).toBe(0);
      expect(await fails(() => q(u, "select public.save_backup_settings(true,'DAILY',30,3)"))).toBe(
        true,
      );
      expect(
        await fails(() => q(u, "select public.backup_run_for_download(gen_random_uuid())")),
      ).toBe(true);
    }
    // another agency sees nothing
    expect((await q(b.userId, "select * from backup_settings")).length).toBe(0);
    // no direct writes, ever
    expect(
      await fails(() =>
        q(a.userId, "insert into backup_runs (organization_id, kind) values ($1,'MANUAL')", [
          a.orgId,
        ]),
      ),
    ).toBe(true);
    expect(await fails(() => q(a.userId, "update backup_settings set retention_days = 7"))).toBe(
      true,
    );
    expect(await fails(() => q(a.userId, "delete from backup_runs"))).toBe(true);
    // invalid settings are refused
    expect(
      await fails(() => q(a.userId, "select public.save_backup_settings(true,'HOURLY',30,3)")),
    ).toBe(true);
    expect(
      await fails(() => q(a.userId, "select public.save_backup_settings(true,'DAILY',2,3)")),
    ).toBe(true);
    expect(await q(null, "select * from backup_runs")).toHaveLength(0);
  });

  it("the export functions are not reachable by signed-in or anonymous users", async () => {
    for (const u of [a.userId, null]) {
      expect(
        await fails(() =>
          q(u, "select public.backup_export_rows('customers', $1, 0, 10)", [a.orgId]),
        ),
      ).toBe(true);
      expect(await fails(() => q(u, "select public.backup_table_list()"))).toBe(true);
      expect(
        await fails(() => q(u, "select public.backup_begin($1,'MANUAL',null)", [a.orgId])),
      ).toBe(true);
    }
  });

  it("exports one agency only, never secrets or platform billing, and never the super-admin flag", async () => {
    const tables = (await rows<{ t: string[] }>("select public.backup_table_list() as t"))[0].t;
    expect(tables).toContain("customers");
    expect(tables).toContain("organizations");
    for (const t of [
      "organization_payment_settings",
      "payment_webhook_events",
      "portal_links",
      "subscriptions",
      "billing_payments",
      "backup_runs",
      "backup_settings",
    ])
      expect(tables, t).not.toContain(t);
    const { gz, rowCounts } = await buildArchive(sourceFor(db, a.orgId), a.orgId, { pageSize: 2 });
    const parsed = verifyArchive(sealArchive(gz, key, a.orgId), key, a.orgId, { rowCounts });
    expect(parsed.tables.customers.map((c) => c.name).sort()).toEqual([
      "Asha",
      "Bhaskar",
      "Chitra",
    ]);
    expect(JSON.stringify(parsed.tables)).not.toContain("Other agency");
    expect(parsed.tables.organizations).toHaveLength(1);
    expect(parsed.tables.profiles.length).toBeGreaterThan(0);
    for (const p of parsed.tables.profiles) expect(p.is_super_admin).toBe(false);
    for (const [t, rs] of Object.entries(parsed.tables))
      if (t !== "organizations" && t !== "profiles")
        for (const r of rs) expect(r.organization_id, t).toBe(a.orgId);
    expect(
      await fails(() =>
        rows("select public.backup_export_rows('subscriptions', $1, 0, 10)", [a.orgId]),
      ),
    ).toBe(true);
    expect(
      await fails(() =>
        rows("select public.backup_export_rows('customers; drop table customers', $1, 0, 10)", [
          a.orgId,
        ]),
      ),
    ).toBe(true);
  });

  it("restores into an empty database with the same records (a real round trip)", async () => {
    const { gz, rowCounts } = await buildArchive(sourceFor(db, a.orgId), a.orgId);
    const parsed = verifyArchive(sealArchive(gz, key, a.orgId), key, a.orgId, { rowCounts });
    const scratch = await createTestDb();
    try {
      await scratch.exec("set session_replication_role = replica");
      for (const [t, rs] of Object.entries(parsed.tables))
        if (rs.length)
          await scratch.query(
            `insert into public."${t}" select * from jsonb_populate_recordset(null::public."${t}", $1::jsonb)`,
            [JSON.stringify(rs)],
          );
      await scratch.exec("set session_replication_role = origin");
      for (const [t, n] of Object.entries(rowCounts)) {
        const got = (
          await scratch.query<{ n: number }>(`select count(*)::int as n from public."${t}"`)
        ).rows[0].n;
        expect(got, t).toBe(n);
      }
      const names = (
        await scratch.query<{ name: string }>("select name from customers order by name")
      ).rows.map((r) => r.name);
      expect(names).toEqual(["Asha", "Bhaskar", "Chitra"]);
    } finally {
      await scratch.close();
    }
  }, 120_000);

  it("scripts/restore-check.mjs restores a real backup file into a scratch database and rejects a damaged one", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "crm-rc-"));
    try {
      const run = (file: string, org: string, k = key) =>
        spawnSync(process.execPath, ["scripts/restore-check.mjs", file, org], {
          encoding: "utf8",
          env: { ...process.env, BACKUP_ENCRYPTION_KEY: k.toString("base64") },
          timeout: 150_000,
        });
      {
        const { gz } = await buildArchive(sourceFor(db, a.orgId), a.orgId);
        const file = path.join(dir, "ok.crmbk");
        writeFileSync(file, sealArchive(gz, key, a.orgId));
        const ok = run(file, a.orgId);
        expect(ok.stdout + ok.stderr).toContain("PASSED");
        expect(ok.status).toBe(0);
        const bad = Buffer.from(readFileSync(file));
        bad[bad.length - 3] ^= 0xff;
        writeFileSync(path.join(dir, "bad.crmbk"), bad);
        const r = run(path.join(dir, "bad.crmbk"), a.orgId);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("FAILED");
        expect(run(file, b.orgId).status).toBe(1); // another agency
        expect(run(file, a.orgId, randomBytes(32)).status).toBe(1); // wrong key
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 400_000);

  it("allows one running backup per agency and recovers from a crashed one", async () => {
    const first = await begin(a.orgId);
    expect(await fails(() => begin(a.orgId))).toBe(true);
    await db.query(
      "update backup_runs set started_at = now() - interval '20 minutes' where id = $1",
      [first],
    );
    const second = await begin(a.orgId);
    expect(second).not.toBe(first);
    expect(
      (await rows("select status, error from backup_runs where id = $1", [first]))[0],
    ).toMatchObject({ status: "FAILED", error: "timed out" });
    await finishOk(second, a.orgId);
  });

  it("a failed backup records the failure, schedules a retry and notifies the people who manage backups", async () => {
    const run = await begin(a.orgId, "SCHEDULED");
    await db.query(
      "select public.backup_finish($1, false, null, null, null, null, null, false, 'destination unreachable')",
      [run],
    );
    expect(
      (await rows("select status, error from backup_runs where id = $1", [run]))[0],
    ).toMatchObject({ status: "FAILED", error: "destination unreachable" });
    const s = (
      await rows(
        "select last_failed_at, next_run_at from backup_settings where organization_id = $1",
        [a.orgId],
      )
    )[0];
    expect(s.last_failed_at).not.toBeNull();
    expect(new Date(s.next_run_at).getTime()).toBeGreaterThan(Date.now());
    const note = await q(
      a.userId,
      "select title, entity_type from notifications where title = 'A backup failed'",
    );
    expect(note).toHaveLength(1);
    expect(note[0].entity_type).toBe("BACKUP");
    expect(
      await q(viewer, "select 1 from notifications where title = 'A backup failed'"),
    ).toHaveLength(0);
    expect(
      (await q(a.userId, "select kind from security_events where kind = 'BACKUP_FAILED'")).length,
    ).toBe(1);
  });

  it("a run that was not read back and verified is never recorded as good", async () => {
    const run = await begin(a.orgId);
    await db.query(
      "select public.backup_finish($1, true, 10, $2, '{}'::jsonb, 'org/x/1.crmbk', 'local', false, null)",
      [run, "b".repeat(64)],
    );
    expect((await rows("select status from backup_runs where id = $1", [run]))[0].status).toBe(
      "FAILED",
    );
  });

  it("schedules by frequency and finds only agencies that are due", async () => {
    await db.query(
      "update backup_settings set enabled = true, next_run_at = now() - interval '1 minute' where organization_id = $1",
      [a.orgId],
    );
    expect(
      (await rows<{ organization_id: string }>("select * from public.backup_due()")).map(
        (r) => r.organization_id,
      ),
    ).toEqual([a.orgId]);
    const run = await begin(a.orgId, "SCHEDULED");
    await finishOk(run, a.orgId);
    expect((await rows("select * from public.backup_due()")).length).toBe(0);
    const next = (
      await rows("select next_run_at from backup_settings where organization_id = $1", [a.orgId])
    )[0].next_run_at;
    expect(new Date(next).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    await db.query("update backup_settings set enabled = false where organization_id = $1", [
      a.orgId,
    ]);
    await db.query(
      "update backup_settings set next_run_at = now() - interval '1 minute' where organization_id = $1",
      [a.orgId],
    );
    expect((await rows("select * from public.backup_due()")).length).toBe(0);
  });

  it("retention deletes old copies but always keeps the newest few", async () => {
    // a fresh agency so earlier runs do not interfere
    const c = await setupTenant(db, "c");
    await db.query(
      "insert into backup_settings (organization_id, retention_days, keep_min) values ($1, 7, 2)",
      [c.orgId],
    );
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await begin(c.orgId);
      await finishOk(id, c.orgId);
      await db.query(
        "update backup_runs set started_at = now() - make_interval(days => $2) where id = $1",
        [id, 20 - i * 3],
      );
      ids.push(id); // ages: 20, 17, 14, 11, 8 days
    }
    const expired = (
      await rows<{ id: string }>(
        "select id from public.backup_expired() where organization_id = $1",
        [c.orgId],
      )
    ).map((r) => r.id);
    expect(expired.sort()).toEqual([ids[0], ids[1], ids[2]].sort()); // the two newest are kept even though older than 7 days
    await db.query("select public.backup_mark_deleted($1)", [ids[0]]);
    expect(
      (await rows("select id from public.backup_expired() where organization_id = $1", [c.orgId]))
        .length,
    ).toBe(2);
    // a young backup is never expired
    const young = await begin(c.orgId);
    await finishOk(young, c.orgId);
    expect(
      (
        await rows<{ id: string }>(
          "select id from public.backup_expired() where organization_id = $1",
          [c.orgId],
        )
      ).map((r) => r.id),
    ).not.toContain(young);
  });

  it("a restore plan needs a verified backup and a fresh verified safety snapshot, changes no data, and is audited", async () => {
    const good = await begin(a.orgId);
    await finishOk(good, a.orgId);
    const safety = await begin(a.orgId, "PRE_RESTORE", a.userId);
    await finishOk(safety, a.orgId);
    const before = (await rows("select count(*)::int n from customers"))[0].n;

    for (const u of [admin, viewer])
      expect(
        await fails(() => q(u, "select public.request_restore_plan($1,$2,null)", [good, safety])),
      ).toBe(true);
    // a safety snapshot of the wrong kind, an unknown backup, another agency's backup
    expect(
      await fails(() =>
        q(a.userId, "select public.request_restore_plan($1,$2,null)", [good, good]),
      ),
    ).toBe(true);
    expect(
      await fails(() =>
        q(a.userId, "select public.request_restore_plan(gen_random_uuid(),$1,null)", [safety]),
      ),
    ).toBe(true);
    const bRun = await begin(b.orgId);
    await finishOk(bRun, b.orgId);
    expect(
      await fails(() =>
        q(a.userId, "select public.request_restore_plan($1,$2,null)", [bRun, safety]),
      ),
    ).toBe(true);
    // a stale safety snapshot
    await db.query(
      "update backup_runs set finished_at = now() - interval '2 hours' where id = $1",
      [safety],
    );
    expect(
      await fails(() =>
        q(a.userId, "select public.request_restore_plan($1,$2,null)", [good, safety]),
      ),
    ).toBe(true);
    await db.query("update backup_runs set finished_at = now() where id = $1", [safety]);
    // an unverified backup
    await db.query("update backup_runs set verify_ok = false where id = $1", [good]);
    expect(
      await fails(() =>
        q(a.userId, "select public.request_restore_plan($1,$2,null)", [good, safety]),
      ),
    ).toBe(true);
    await db.query("update backup_runs set verify_ok = true where id = $1", [good]);

    const id = (
      await q<{ p: string }>(a.userId, "select public.request_restore_plan($1,$2,'test') as p", [
        good,
        safety,
      ])
    )[0].p;
    expect(
      (await q(a.userId, "select status from backup_restores where id = $1", [id]))[0].status,
    ).toBe("PLANNED");
    expect((await rows("select count(*)::int n from customers"))[0].n).toBe(before);
    expect(
      (
        await rows(
          "select 1 from audit_logs where metadata->>'event' = 'RESTORE_PLANNED' and entity_id = $1",
          [id],
        )
      ).length,
    ).toBe(1);
    expect((await q(b.userId, "select * from backup_restores")).length).toBe(0);
    await q(a.userId, "select public.close_restore_plan($1, true)", [id]);
    expect(
      (await q(a.userId, "select status from backup_restores where id = $1", [id]))[0].status,
    ).toBe("CANCELLED");
    expect(await fails(() => q(a.userId, "select public.close_restore_plan($1, true)", [id]))).toBe(
      true,
    );
  });

  it("settings changes and downloads are audited, and another agency's run cannot be downloaded", async () => {
    expect(
      (await rows("select 1 from audit_logs where metadata->>'event' = 'BACKUP_SETTINGS_CHANGED'"))
        .length,
    ).toBeGreaterThan(0);
    const run = (
      await rows<{ id: string }>(
        "select id from backup_runs where organization_id = $1 and status = 'OK' limit 1",
        [a.orgId],
      )
    )[0].id;
    const info = (
      await q<{ i: { storageKey: string } }>(
        a.userId,
        "select public.backup_run_for_download($1) as i",
        [run],
      )
    )[0].i;
    expect(info.storageKey).toContain(a.orgId);
    expect(
      (await rows("select 1 from audit_logs where metadata->>'event' = 'BACKUP_DOWNLOADED'"))
        .length,
    ).toBe(1);
    expect(await fails(() => q(b.userId, "select public.backup_run_for_download($1)", [run]))).toBe(
      true,
    );
  });
});
