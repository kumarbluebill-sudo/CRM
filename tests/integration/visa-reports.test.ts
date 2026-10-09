import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

describe("visa reports, alerts and master-data import (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let mgr: string, exec: string, ops: string, acc: string, viewer: string;
  let customer = "",
    product = "";
  const apps: string[] = [];

  const member = async (org: string, email: string, role: string) => {
    const id = await createUser(db, email);
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)",
      [org, id, role],
    );
    return id;
  };
  const q1 = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const one = async (user: string, sql: string, params: unknown[] = []) =>
    (await q1<any>(user, sql, params))[0];
  const range = "current_date - 30, current_date + 1";
  const report = async (user: string) =>
    (await one(user, `select public.visa_report_summary(${range}) as r`)).r;

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    mgr = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    ops = await member(a.orgId, "ops@a.test", "OPERATIONS");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    customer = (
      await one(
        a.userId,
        "insert into customers (name, email) values ('Raj Kumar', 'raj@example.test') returning id",
      )
    ).id;
    const country = (
      await one(
        a.userId,
        "insert into visa_countries (name, iso_code) values ('Thailand', 'TH') returning id",
      )
    ).id;
    product = (
      await one(
        a.userId,
        `insert into visa_products (country_id, visa_type, entry_type, processing_days_normal)
         values ($1, 'TOURIST', 'SINGLE', 5) returning id`,
        [country],
      )
    ).id;
    await q1(
      a.userId,
      "select public.update_visa_pricing($1, 500, 0, 0, 18, 1000, 2000, 'Initial price list')",
      [product],
    );
    for (let i = 0; i < 3; i++) {
      const id = (
        await one(
          a.userId,
          "select public.create_visa_application($1, $2, 'Indian', null, 1, null, 'NORMAL', null, $3) as id",
          [customer, product, ops],
        )
      ).id;
      await q1(a.userId, "select public.price_visa_application($1)", [id]);
      apps.push(id);
    }
  });
  afterAll(async () => db.close());

  describe("report summary", () => {
    it("counts applications, outcomes and revenue, and keeps cost sections for supplier-viewers", async () => {
      // 0: approved, 1: rejected (driven through the workflow so the timeline holds the outcome)
      await db.query("update visa_applications set status = 'SUBMITTED' where id = any($1)", [
        [apps[0], apps[1]],
      ]);
      await q1(ops, "select public.set_visa_status($1, 'PROCESSING')", [apps[0]]);
      await q1(ops, "select public.set_visa_status($1, 'APPROVED')", [apps[0]]);
      await q1(ops, "select public.set_visa_status($1, 'REJECTED', 'Incomplete')", [apps[1]]);
      await db.query("update visa_applications set status = 'SUBMITTED' where id = $1", [apps[2]]);
      await q1(ops, "select public.record_supplier_submission($1, null, 'S1', 1500)", [apps[2]]);

      const r = await report(mgr);
      expect(r.applications).toMatchObject({ created: 3, approved: 1, rejected: 1 });
      expect(r.applications.byCountry[0]).toMatchObject({ country: "Thailand", count: 3 });
      expect(r.applications.byStaff[0]).toMatchObject({ userId: ops, count: 3 });
      expect(r.revenue[0]).toMatchObject({ currency: "INR", count: 3 });
      expect(r.profit).toBeUndefined(); // manager has no visa.supplier.view
      expect(r.suppliers).toBeUndefined();

      const full = await report(acc);
      expect(Number(full.profit[0].cost)).toBe(1500);
      expect(full.profit[0].applications).toBe(1); // only applications with a recorded cost
      expect(full.suppliers[0]).toMatchObject({ supplier: "No supplier", submissions: 1 });
    });

    it("is limited to people with visa.report.view, sane ranges and their own agency", async () => {
      for (const u of [exec, viewer]) {
        expect(await fails(() => q1(u, `select public.visa_report_summary(${range})`))).toBe(true);
      }
      expect(
        await fails(() =>
          q1(mgr, "select public.visa_report_summary(current_date, current_date - 1)"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(mgr, "select public.visa_report_summary(current_date - 900, current_date)"),
        ),
      ).toBe(true);
      const other = await one(b.userId, `select public.visa_report_summary(${range}) as r`);
      expect(other.r.applications.created).toBe(0);
    });
  });

  describe("alerts", () => {
    it("flags urgent travel, overdue work and passports without exposing the number", async () => {
      const x = apps[2];
      await db.query(
        "update visa_applications set expected_completion = current_date - 2 where id = $1",
        [x],
      );
      const early = (
        await one(
          a.userId,
          "select public.create_visa_application($1, $2, 'Indian', current_date + 3, 1) as id",
          [customer, product],
        )
      ).id;
      const t = (
        await one(a.userId, "select id from visa_travellers where application_id = $1", [early])
      ).id;
      await q1(
        a.userId,
        `select public.update_visa_traveller($1, '{"passport_number":"ZX1234567","passport_expiry_date":"2026-12-01"}'::jsonb)`,
        [t],
      );
      const alerts = (await one(ops, "select public.visa_alerts() as a")).a as any[];
      const kinds = alerts.filter((al) => al.applicationId === early).map((al) => al.kind);
      expect(kinds).toContain("TRAVEL");
      expect(kinds).toContain("PASSPORT");
      expect(alerts.some((al) => al.applicationId === x && al.kind === "OVERDUE")).toBe(true);
      expect(JSON.stringify(alerts)).not.toContain("ZX1234567");
      expect(alerts[0].severity).toBe("URGENT");
      expect((await one(b.userId, "select public.visa_alerts() as a")).a).toEqual([]);
      const nobody = await createUser(db, "nobody@x.test");
      expect(await fails(() => q1(nobody, "select public.visa_alerts()"))).toBe(true);
    });
  });

  describe("master-data import", () => {
    const rows = (o: object[]) => JSON.stringify(o);
    it("previews without writing, then imports only valid rows and never overwrites", async () => {
      const csv = [
        { name: "Japan", iso_code: "jp", region: "Asia" },
        { name: "Japan again", iso_code: "JP" },
        { name: "Thailand", iso_code: "TH" },
        { name: "X", iso_code: "XYZ" },
      ];
      const prev = (
        await one(
          a.userId,
          "select public.import_visa_master('countries', $1::jsonb, false) as r",
          [rows(csv)],
        )
      ).r;
      expect(prev.map((p: any) => p.status)).toEqual([
        "VALID",
        "DUPLICATE",
        "DUPLICATE",
        "INVALID",
      ]);
      expect(
        await q1(a.userId, "select id from visa_countries where iso_code = 'JP'"),
      ).toHaveLength(0);
      const done = (
        await one(a.userId, "select public.import_visa_master('countries', $1::jsonb, true) as r", [
          rows(csv),
        ])
      ).r;
      expect(done.map((p: any) => p.status)).toEqual([
        "IMPORTED",
        "DUPLICATE",
        "DUPLICATE",
        "INVALID",
      ]);
      expect(
        await q1(a.userId, "select id from visa_countries where iso_code = 'JP'"),
      ).toHaveLength(1);
      expect(
        (await one(a.userId, "select name from visa_countries where iso_code = 'TH'")).name,
      ).toBe("Thailand");
    });

    it("imports products with a recorded source, price history and protected costs", async () => {
      const csv = [
        {
          country_iso: "JP",
          visa_type: "tourist",
          entry_type: "single",
          processing_days_normal: "7",
          service_fee: "800",
          government_fee: "1500",
          supplier_fee: "300",
          gst_percent: "18",
          source: "Supplier sheet Oct 2026",
        },
        { country_iso: "JP", visa_type: "TOURIST", entry_type: "SINGLE" },
        { country_iso: "ZZ", visa_type: "TOURIST" },
        { country_iso: "JP", visa_type: "BUSINESS", service_fee: "abc" },
      ];
      const done = (
        await one(a.userId, "select public.import_visa_master('products', $1::jsonb, true) as r", [
          rows(csv),
        ])
      ).r;
      expect(done.map((p: any) => p.status)).toEqual([
        "IMPORTED",
        "DUPLICATE",
        "INVALID",
        "INVALID",
      ]);
      const p = await one(
        a.userId,
        "select id, source, created_by from visa_products where source like 'Supplier sheet%'",
      );
      expect(p.created_by).toBe(a.userId);
      expect(Number((await one(exec, "select public.visa_unit_price($1) as p", [p.id])).p)).toBe(
        3068,
      ); // (800+1500+300)*1.18
      expect(
        await q1(exec, "select * from visa_product_costs where product_id = $1", [p.id]),
      ).toHaveLength(0);
      expect(
        await q1(a.userId, "select id from visa_price_history where product_id = $1", [p.id]),
      ).toHaveLength(1);
    });

    it("refuses people who may not edit prices, cost imports without supplier-edit, and other agencies' data", async () => {
      const row = rows([{ name: "Italy", iso_code: "IT" }]);
      for (const u of [exec, viewer, ops, acc])
        expect(
          await fails(() =>
            q1(u, "select public.import_visa_master('countries', $1::jsonb, true)", [row]),
          ),
        ).toBe(true);
      // another agency cannot see this agency's countries, so the row is rejected
      const foreign = (
        await one(b.userId, "select public.import_visa_master('products', $1::jsonb, true) as r", [
          rows([{ country_iso: "TH", visa_type: "WORK" }]),
        ])
      ).r;
      expect(foreign[0].status).toBe("INVALID");
      expect(
        await fails(() =>
          q1(a.userId, "select public.import_visa_master('countries', '[]'::jsonb, false)"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(a.userId, "select public.import_visa_master('other', '[{}]'::jsonb, false)"),
        ),
      ).toBe(true);
    });
  });
});
