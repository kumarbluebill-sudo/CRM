import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildArchive, sealArchive, verifyArchive, type ArchiveSource } from "@/lib/backup/archive";
import { LocalTarget } from "@/lib/backup/target";

/**
 * LIVE backup tests against the real Supabase project in .env.local: the service-role export functions, per-agency
 * isolation, encryption, a stored-and-read-back copy, permissions and the audit trail. Throwaway "LIVE-TEST" data only.
 * Run with RUN_LIVE=1.
 */
const LIVE = process.env.RUN_LIVE === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DB = process.env.DATABASE_URL!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const email = (n: string) => `live-bk${n}-${run}@example.invalid`;

describe.skipIf(!LIVE)("live Supabase: backups (throwaway data)", () => {
  let admin: SupabaseClient;
  const users: Record<string, { id: string; client: SupabaseClient }> = {};
  let orgA = "";
  let orgB = "";
  let dir = "";
  const key = randomBytes(32);

  async function makeUser(name: string) {
    const { data, error } = await admin.auth.admin.createUser({
      email: email(name),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `LIVE-TEST ${name}` },
    });
    if (error) throw new Error(error.message);
    const client = createClient(URL_, PUB, opts);
    const { error: e2 } = await client.auth.signInWithPassword({
      email: email(name),
      password: PASSWORD,
    });
    if (e2) throw new Error(e2.message);
    users[name] = { id: data.user.id, client };
  }
  const source = (org: string): ArchiveSource => ({
    async tables() {
      const { data, error } = await admin.rpc("backup_table_list");
      if (error) throw new Error(error.message);
      return data as string[];
    },
    async rows(table, offset, limit) {
      const { data, error } = await admin.rpc("backup_export_rows", {
        p_table: table,
        p_org: org,
        p_offset: offset,
        p_limit: limit,
      });
      if (error) throw new Error(`${table}: ${error.message}`);
      return data as Record<string, unknown>[];
    },
  });

  beforeAll(async () => {
    admin = createClient(URL_, SERVICE, opts);
    dir = await mkdtemp(path.join(os.tmpdir(), "crm-live-bk-"));
    await makeUser("a");
    await makeUser("b");
    orgA = String(
      (await users.a.client.rpc("create_organization", { org_name: "LIVE-TEST backup A" })).data,
    );
    orgB = String(
      (await users.b.client.rpc("create_organization", { org_name: "LIVE-TEST backup B" })).data,
    );
    for (const n of ["Asha Live", "Bhaskar Live"])
      await users.a.client.from("customers").insert({ name: n });
    await users.b.client.from("customers").insert({ name: "Other agency secret" });
  }, 120_000);

  afterAll(async () => {
    const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    try {
      await db.connect();
      for (const o of [orgA, orgB])
        if (o) await db.query("delete from public.organizations where id = $1", [o]);
    } finally {
      await db.end().catch(() => {});
    }
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id).catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true });
  }, 60_000);

  it("the export functions are service-role only", async () => {
    for (const fn of [
      ["backup_table_list", {}],
      ["backup_export_rows", { p_table: "customers", p_org: orgA, p_offset: 0, p_limit: 5 }],
      ["backup_begin", { p_org: orgA, p_kind: "MANUAL", p_by: null }],
    ] as const)
      expect((await users.a.client.rpc(fn[0], fn[1])).error, fn[0]).not.toBeNull();
  });

  it("backs up one agency only, stores it encrypted, and the copy read back from the destination verifies", async () => {
    const target = new LocalTarget(dir);
    const begin = await admin.rpc("backup_begin", {
      p_org: orgA,
      p_kind: "MANUAL",
      p_by: users.a.id,
    });
    expect(begin.error).toBeNull();
    const runId = String(begin.data);
    const built = await buildArchive(source(orgA), orgA);
    const sealed = sealArchive(built.gz, key, orgA);
    const objectKey = `org/${orgA}/2026/${runId}.crmbk`;
    await target.put(objectKey, sealed);
    const parsed = verifyArchive(await target.get(objectKey), key, orgA, {
      rowCounts: built.rowCounts,
    });
    expect(parsed.tables.customers.map((c) => c.name).sort()).toEqual([
      "Asha Live",
      "Bhaskar Live",
    ]);
    expect(JSON.stringify(parsed.tables)).not.toContain("Other agency secret");
    expect(sealed.toString("utf8")).not.toContain("Asha Live");
    for (const t of [
      "subscriptions",
      "organization_payment_settings",
      "portal_links",
      "backup_runs",
    ])
      expect(parsed.tables[t], t).toBeUndefined();
    for (const p of parsed.tables.profiles) expect(p.is_super_admin).toBe(false);
    const fin = await admin.rpc("backup_finish", {
      p_run: runId,
      p_ok: true,
      p_size: sealed.length,
      p_sha: "c".repeat(64),
      p_counts: built.rowCounts,
      p_key: objectKey,
      p_dest: "local",
      p_verified: true,
      p_error: null,
    });
    expect(fin.error).toBeNull();
    // a copy opened with another agency's id is refused
    expect(() => verifyArchive(sealed, key, orgB, {})).toThrow();
  }, 120_000);

  it("only the agency's own backup managers see runs, settings and restore plans", async () => {
    expect((await users.a.client.from("backup_runs").select("id, status")).data).toHaveLength(1);
    expect((await users.b.client.from("backup_runs").select("id")).data).toHaveLength(0);
    expect(
      (
        await users.b.client.rpc("save_backup_settings", {
          p_enabled: true,
          p_frequency: "DAILY",
          p_retention_days: 30,
          p_keep_min: 3,
        })
      ).error,
    ).toBeNull(); // B is the owner of its own agency
    expect((await users.a.client.from("backup_settings").select("organization_id")).data).toEqual([
      { organization_id: orgA },
    ]);
    expect((await users.b.client.from("backup_settings").select("organization_id")).data).toEqual([
      { organization_id: orgB },
    ]);
    // nobody can write the tables directly
    expect(
      (await users.a.client.from("backup_runs").insert({ organization_id: orgA, kind: "MANUAL" }))
        .error,
    ).not.toBeNull();
    const dl = await users.b.client.rpc("backup_run_for_download", {
      p_id: (await users.a.client.from("backup_runs").select("id").single()).data!.id,
    });
    expect(dl.error).not.toBeNull();
    // the owner can fetch their own run (this writes an audit row, so it must run outside a read-only transaction)
    const own = await users.a.client.rpc("backup_run_for_download", {
      p_id: (await users.a.client.from("backup_runs").select("id").single()).data!.id,
    });
    expect(own.error).toBeNull();
    expect(own.data.storageKey).toContain(orgA);
  });

  it("a restore plan needs a fresh verified safety snapshot and changes nothing", async () => {
    const good = (await users.a.client.from("backup_runs").select("id").single()).data!.id;
    await admin
      .from("backup_runs")
      .update({ verify_ok: true, verified_at: new Date().toISOString() })
      .eq("id", good);
    // no safety snapshot -> refused
    expect(
      (
        await users.a.client.rpc("request_restore_plan", {
          p_run: good,
          p_safety: good,
          p_note: null,
        })
      ).error,
    ).not.toBeNull();
    const s = await admin.rpc("backup_begin", {
      p_org: orgA,
      p_kind: "PRE_RESTORE",
      p_by: users.a.id,
    });
    await admin.rpc("backup_finish", {
      p_run: String(s.data),
      p_ok: true,
      p_size: 1,
      p_sha: "d".repeat(64),
      p_counts: {},
      p_key: "org/x/y.crmbk",
      p_dest: "local",
      p_verified: true,
      p_error: null,
    });
    const before = (
      await admin
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgA)
    ).count;
    const plan = await users.a.client.rpc("request_restore_plan", {
      p_run: good,
      p_safety: String(s.data),
      p_note: "live test",
    });
    expect(plan.error).toBeNull();
    expect(
      (
        await admin
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgA)
      ).count,
    ).toBe(before);
    expect((await users.a.client.from("backup_restores").select("status")).data).toEqual([
      { status: "PLANNED" },
    ]);
    expect(
      (
        await admin
          .from("audit_logs")
          .select("id")
          .eq("organization_id", orgA)
          .eq("metadata->>event", "RESTORE_PLANNED")
      ).data,
    ).toHaveLength(1);
  });

  it("a failed run notifies the owner and is recorded", async () => {
    const r = await admin.rpc("backup_begin", { p_org: orgA, p_kind: "SCHEDULED", p_by: null });
    await admin.rpc("backup_finish", {
      p_run: String(r.data),
      p_ok: false,
      p_size: null,
      p_sha: null,
      p_counts: null,
      p_key: null,
      p_dest: null,
      p_verified: false,
      p_error: "live test failure",
    });
    const n = await users.a.client
      .from("notifications")
      .select("title, entity_type")
      .eq("title", "A backup failed");
    expect(n.data).toEqual([{ title: "A backup failed", entity_type: "BACKUP" }]);
  });
});
