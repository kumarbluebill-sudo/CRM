import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";
import { computeOption, priceFromCost } from "@/lib/quotation/pricing";

const uid = () => crypto.randomUUID();

type Item = {
  id: string;
  type: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number | null;
};
const item = (o: Partial<Item> = {}): Item => ({
  id: uid(),
  type: "HOTEL",
  description: "Atlantis 3N",
  quantity: 1,
  unitPrice: 1000,
  ...o,
});
const option = (items: Item[], o: Record<string, unknown> = {}) => ({
  id: uid(),
  name: "Option A",
  discountType: "NONE",
  discountValue: 0,
  taxRate: 0,
  items,
  ...o,
});

describe("quotations (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let exec: string, manager: string, accountant: string, viewer: string;
  let customerA: string, customerB: string;
  let q: string;

  const member = async (org: string, email: string, role: string) => {
    const id = await createUser(db, email);
    await db.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)",
      [org, id, role],
    );
    return id;
  };
  const doc = (user: string, id: string, priv = true) =>
    asUser(
      db,
      user,
      async (d) =>
        (await d.query<{ d: any }>("select public.quotation_document($1, $2) as d", [id, priv]))
          .rows[0].d,
    );
  const save = (user: string, id: string, data: object, version: number, snapshot = false) =>
    asUser(db, user, (d) =>
      d.query<{ save_quotation: number }>("select public.save_quotation($1, $2::jsonb, $3, $4)", [
        id,
        JSON.stringify(data),
        version,
        snapshot,
      ]),
    );
  const create = (user: string, customer: string, title = "Dubai trip") =>
    asUser(
      db,
      user,
      async (d) =>
        (
          await d.query<{ create_quotation: string }>("select public.create_quotation($1, $2)", [
            customer,
            title,
          ])
        ).rows[0].create_quotation,
    );
  const status = (user: string, id: string, s: string) =>
    asUser(db, user, (d) => d.query("select public.set_quotation_status($1, $2)", [id, s]));
  const header = (options: unknown[], extra: object = {}) => ({
    title: "Dubai trip",
    options,
    ...extra,
  });

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    manager = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    accountant = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    customerA = await asUser(
      db,
      a.userId,
      async (d) =>
        (
          await d.query<{ id: string }>(
            "insert into customers (name) values ('Cust A') returning id",
          )
        ).rows[0].id,
    );
    customerB = await asUser(
      db,
      b.userId,
      async (d) =>
        (
          await d.query<{ id: string }>(
            "insert into customers (name) values ('Cust B') returning id",
          )
        ).rows[0].id,
    );
    q = await create(a.userId, customerA);
  });
  afterAll(async () => db.close());

  describe("creation and numbering", () => {
    it("creates a numbered quotation with a default option, per-organization sequence", async () => {
      const d = await doc(a.userId, q);
      expect(d.number).toMatch(/^Q-\d{4}-0001$/);
      expect(d.status).toBe("DRAFT");
      expect(d.options).toHaveLength(1);
      expect(d.selectedOptionId).toBe(d.options[0].id);
      const second = await create(a.userId, customerA, "Second");
      expect((await doc(a.userId, second)).number).toMatch(/-0002$/);
      const bq = await create(b.userId, customerB, "B first");
      expect((await doc(b.userId, bq)).number).toMatch(/-0001$/);
    });

    it("rejects another tenant's customer and viewers", async () => {
      expect(await fails(() => create(a.userId, customerB))).toBe(true);
      expect(await fails(() => create(viewer, customerA))).toBe(true);
    });

    it("cannot be inserted directly or have number/status/totals written by clients", async () => {
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() =>
            d.query(
              "insert into quotations (quotation_number, customer_id, title) values ('X-1', $1, 'hack')",
              [customerA],
            ),
          ),
        ),
      ).toBe(true);
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() => d.query("update quotations set status = 'APPROVED' where id = $1", [q])),
        ),
      ).toBe(true);
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() => d.query("update quotations set quotation_number = 'Q-0' where id = $1", [q])),
        ),
      ).toBe(true);
      expect(
        await asUser(db, a.userId, (d) =>
          fails(() =>
            d.query("update quotation_options set total = 1 where quotation_id = $1", [q]),
          ),
        ),
      ).toBe(true);
    });
  });

  describe("pricing", () => {
    it("computes totals in the database and matches the TypeScript math", async () => {
      const cases: [Item[], string, number, number][] = [
        [
          [item({ quantity: 2, unitPrice: 1234.56 }), item({ quantity: 1.5, unitPrice: 99.99 })],
          "PERCENT",
          12.5,
          18,
        ],
        [[item({ quantity: 3, unitPrice: 333.33 })], "FIXED", 100, 5],
        [[item({ quantity: 0.33, unitPrice: 10.01 })], "NONE", 0, 12],
        [[item({ unitPrice: 50 })], "FIXED", 9999, 18], // discount capped at subtotal
      ];
      let version = 1;
      for (const [items, dt, dv, tax] of cases) {
        const d0 = await doc(a.userId, q);
        const opt = option(items, {
          id: d0.options[0].id,
          discountType: dt,
          discountValue: dv,
          taxRate: tax,
        });
        await save(a.userId, q, header([opt]), version++);
        const o = (await doc(a.userId, q)).options[0];
        const ts = computeOption(items, dt as "NONE", dv, tax);
        expect(Number(o.subtotal)).toBe(ts.subtotal);
        expect(Number(o.discountAmount)).toBe(ts.discount);
        expect(Number(o.taxAmount)).toBe(ts.tax);
        expect(Number(o.total)).toBe(ts.total);
      }
    });

    it("priceFromCost applies markup", () => {
      expect(priceFromCost(1000, 15)).toBe(1150);
      expect(priceFromCost(333.33, 10)).toBe(366.66);
    });

    it("rejects negative prices, zero quantity, bad discounts and unknown item types", async () => {
      const v = (await doc(a.userId, q)).version;
      const base = (await doc(a.userId, q)).options[0].id;
      for (const bad of [
        option([item({ unitPrice: -1 })], { id: base }),
        option([item({ quantity: 0 })], { id: base }),
        option([item({ type: "HACK" })], { id: base }),
        option([item()], { id: base, discountType: "PERCENT", discountValue: 150 }),
        option([item()], { id: base, taxRate: 101 }),
      ]) {
        expect(await fails(() => save(a.userId, q, header([bad]), v))).toBe(true);
      }
    });
  });

  describe("options A/B/C", () => {
    it("supports several options and keeps their order", async () => {
      const cur = await doc(a.userId, q);
      const A = option([item({ unitPrice: 1000 })], {
        id: cur.options[0].id,
        name: "Option A – Standard",
      });
      const B = option([item({ unitPrice: 2000 })], { name: "Option B – Premium" });
      const C = option([item({ unitPrice: 3000 })], { name: "Option C – Luxury", taxRate: 5 });
      await save(a.userId, q, { ...header([A, B, C]), selectedOptionId: B.id }, cur.version);
      const d = await doc(a.userId, q);
      expect(d.options.map((o: any) => o.name)).toEqual([
        "Option A – Standard",
        "Option B – Premium",
        "Option C – Luxury",
      ]);
      expect(d.options.map((o: any) => Number(o.total))).toEqual([1000, 2000, 3150]);
      expect(d.selectedOptionId).toBe(B.id);
    });

    it("limits options to 5", async () => {
      const cur = await doc(a.userId, q);
      const six = Array.from({ length: 6 }, (_, i) => option([item()], { name: `O${i}` }));
      expect(await fails(() => save(a.userId, q, header(six), cur.version))).toBe(true);
    });
  });

  describe("supplier cost protection", () => {
    let mgrQuote: string;
    let itemId: string;
    let optId: string;

    beforeAll(async () => {
      mgrQuote = await create(manager, customerA, "Costed");
      const cur = await doc(manager, mgrQuote);
      optId = cur.options[0].id;
      itemId = uid();
      await save(
        manager,
        mgrQuote,
        header([option([item({ id: itemId, unitPrice: 1500, unitCost: 1000 })], { id: optId })]),
        cur.version,
      );
    });

    it("manager sees cost and profit; exec and viewer see neither (document level)", async () => {
      const m = await doc(manager, mgrQuote);
      expect(m.canSeeCost).toBe(true);
      expect(Number(m.options[0].items[0].unitCost)).toBe(1000);
      expect(Number(m.options[0].profit)).toBe(500);
      for (const u of [exec, viewer]) {
        const d = await doc(u, mgrQuote);
        expect(d.canSeeCost).toBe(false);
        expect(d.options[0].items[0].unitCost).toBeNull();
        expect(d.options[0].profit).toBeNull();
        expect(JSON.stringify(d)).not.toContain('1000.00"}');
      }
    });

    it("accountant sees cost and profit but cannot edit", async () => {
      const d = await doc(accountant, mgrQuote);
      expect(Number(d.options[0].profit)).toBe(500);
      expect(
        await fails(() =>
          save(accountant, mgrQuote, header([option([item()], { id: optId })]), d.version),
        ),
      ).toBe(true);
    });

    it("cost rows are invisible to exec at the table level too", async () => {
      const r = await asUser(db, exec, (d) => d.query("select * from quotation_item_costs"));
      expect(r.rows).toHaveLength(0);
      const w = await asUser(db, exec, (d) =>
        fails(() =>
          d.query("insert into quotation_item_costs (item_id, unit_cost) values ($1, 1)", [itemId]),
        ),
      );
      expect(w).toBe(true);
    });

    it("an exec editing the quotation preserves costs they cannot see", async () => {
      const cur = await doc(exec, mgrQuote);
      const edited = option(
        [{ ...cur.options[0].items[0], unitPrice: 1800, unitCost: undefined }],
        { id: optId },
      );
      await save(exec, mgrQuote, header([edited]), cur.version);
      const m = await doc(manager, mgrQuote);
      expect(Number(m.options[0].items[0].unitPrice)).toBe(1800);
      expect(Number(m.options[0].items[0].unitCost)).toBe(1000); // untouched
      expect(Number(m.options[0].profit)).toBe(800);
    });

    it("exec cannot plant a cost by sending unitCost in the payload", async () => {
      const cur = await doc(exec, mgrQuote);
      const newItem = item({ unitPrice: 10, unitCost: 5 });
      await save(
        exec,
        mgrQuote,
        header([option([...cur.options[0].items, newItem], { id: optId })]),
        cur.version,
      );
      const rows = await db.query("select 1 from quotation_item_costs where item_id = $1", [
        newItem.id,
      ]);
      expect(rows.rows).toHaveLength(0);
    });

    it("profit is withheld when any line has no cost", async () => {
      const m = await doc(manager, mgrQuote);
      expect(m.options[0].profit).toBeNull(); // the exec-added line has no cost
    });

    it("version snapshots never contain costs or profit", async () => {
      const cur = await doc(manager, mgrQuote);
      await save(
        manager,
        mgrQuote,
        header([
          option(
            cur.options[0].items.map((i: any) => ({ ...i, unitCost: i.unitCost ?? 1 })),
            { id: optId },
          ),
        ]),
        cur.version,
        true,
      );
      const v = await db.query<{ snapshot: any }>(
        "select snapshot from quotation_versions where quotation_id = $1",
        [mgrQuote],
      );
      expect(v.rows.length).toBeGreaterThan(0);
      for (const row of v.rows) {
        const s = JSON.stringify(row.snapshot);
        expect(s).not.toMatch(/"unitCost":\s*[0-9]/);
        expect(s).not.toMatch(/"profit":\s*[0-9]/);
        expect(row.snapshot.canSeeCost).toBe(false);
      }
    });

    it("non-private document requests never include cost, even for permitted users", async () => {
      const d = await doc(manager, mgrQuote, false);
      expect(d.canSeeCost).toBe(false);
      expect(d.options[0].items[0].unitCost).toBeNull();
    });

    it("cost removal by a permitted user deletes the cost", async () => {
      const cur = await doc(manager, mgrQuote);
      await save(
        manager,
        mgrQuote,
        header([
          option(
            cur.options[0].items.map((i: any) => ({ ...i, unitCost: null })),
            { id: optId },
          ),
        ]),
        cur.version,
      );
      expect(
        (await db.query("select 1 from quotation_item_costs where item_id = $1", [itemId])).rows,
      ).toHaveLength(0);
    });
  });

  describe("tenant isolation", () => {
    it("tenant B cannot read, save, change status of or delete tenant A's quotation", async () => {
      expect(await doc(b.userId, q)).toBeNull();
      expect(await fails(() => save(b.userId, q, header([option([item()])]), 99))).toBe(true);
      expect(await fails(() => status(b.userId, q, "SENT"))).toBe(true);
      await asUser(db, b.userId, (d) => d.query("delete from quotations where id = $1", [q]));
      expect((await db.query("select 1 from quotations where id = $1", [q])).rows).toHaveLength(1);
      expect(
        (await asUser(db, b.userId, (d) => d.query("select 1 from quotation_items"))).rows.length,
      ).toBeLessThanOrEqual(1);
    });

    it("cannot inject another quotation's option or item ids", async () => {
      const bq = await create(b.userId, customerB, "B quote");
      const bd = await doc(b.userId, bq);
      const cur = await doc(a.userId, q);
      expect(
        await fails(() =>
          save(a.userId, q, header([option([item()], { id: bd.options[0].id })]), cur.version),
        ),
      ).toBe(true);
      // same-tenant cross-quotation id reuse is rejected too
      const q2 = await create(a.userId, customerA, "Another");
      const d2 = await doc(a.userId, q2);
      const qv = (await doc(a.userId, q)).version;
      expect(
        await fails(() =>
          save(a.userId, q, header([option([item()], { id: d2.options[0].id })]), qv),
        ),
      ).toBe(true);
    });

    it("cannot link another tenant's lead or itinerary", async () => {
      const cur = await doc(a.userId, q);
      const lead = await asUser(
        db,
        b.userId,
        async (d) =>
          (
            await d.query<{ id: string }>(
              "insert into leads (title) values ('B lead') returning id",
            )
          ).rows[0].id,
      );
      expect(
        await fails(() =>
          save(
            a.userId,
            q,
            header([option([item()], { id: cur.options[0].id })], { leadId: lead }),
            cur.version,
          ),
        ),
      ).toBe(true);
    });
  });

  describe("status workflow, locking and concurrency", () => {
    let wq: string;
    beforeAll(async () => {
      wq = await create(exec, customerA, "Workflow");
      const cur = await doc(exec, wq);
      await save(
        exec,
        wq,
        header([option([item({ unitPrice: 5000 })], { id: cur.options[0].id })]),
        cur.version,
      );
    });

    it("rejects a stale version", async () => {
      expect(await fails(() => save(exec, wq, header([option([item()])]), 1))).toBe(true);
    });

    it("cannot send an empty quotation", async () => {
      const empty = await create(exec, customerA, "Empty");
      expect(await fails(() => status(exec, empty, "SENT"))).toBe(true);
    });

    it("viewer cannot send; exec can; sending snapshots, sets dates and locks editing", async () => {
      expect(await fails(() => status(viewer, wq, "SENT"))).toBe(true);
      await status(exec, wq, "SENT");
      const d = await doc(exec, wq);
      expect(d.status).toBe("SENT");
      expect(d.sentAt).not.toBeNull();
      expect(d.validUntil).not.toBeNull();
      const snaps = await db.query<{ label: string }>(
        "select label from quotation_versions where quotation_id = $1 and label = 'Sent to customer'",
        [wq],
      );
      expect(snaps.rows).toHaveLength(1);
      expect(
        await fails(() =>
          save(exec, wq, header([option([item()], { id: d.options[0].id })]), d.version),
        ),
      ).toBe(true);
    });

    it("enforces valid transitions", async () => {
      expect(await fails(() => status(exec, wq, "DRAFT"))).toBe(true);
      expect(await fails(() => status(exec, wq, "CONVERTED"))).toBe(true);
      await status(exec, wq, "NEGOTIATION");
      const d = await doc(exec, wq);
      await save(
        exec,
        wq,
        header([option([item({ unitPrice: 4500 })], { id: d.options[0].id })]),
        d.version,
      ); // editable again
      await status(exec, wq, "SENT");
      await status(manager, wq, "APPROVED");
      const after = await doc(manager, wq);
      expect(after.status).toBe("APPROVED");
      expect(after.approvedAt).not.toBeNull();
      expect(await fails(() => status(manager, wq, "REJECTED"))).toBe(true);
    });

    it("price changes are snapshotted with who changed them", async () => {
      const rows = await db.query<{ label: string; created_by: string }>(
        "select label, created_by from quotation_versions where quotation_id = $1 and label = 'Price changed'",
        [wq],
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(rows.rows[0].created_by).toBe(exec);
    });

    it("approving with several options requires a selection", async () => {
      const mq = await create(exec, customerA, "Multi");
      const cur = await doc(exec, mq);
      const A = option([item()], { id: cur.options[0].id });
      const B = option([item({ unitPrice: 2000 })]);
      await save(exec, mq, header([A, B]), cur.version); // no selectedOptionId
      await status(exec, mq, "SENT");
      expect(await fails(() => status(exec, mq, "APPROVED"))).toBe(true);
    });
  });

  describe("versions and templates", () => {
    it("versions are append-only and tenant-scoped", async () => {
      await asUser(db, exec, async (d) => {
        await d.query("update quotation_versions set label = 'x'");
        await d.query("delete from quotation_versions");
      });
      const n = await db.query<{ n: number }>("select count(*)::int n from quotation_versions");
      expect(n.rows[0].n).toBeGreaterThan(0);
      expect(
        (
          await asUser(db, b.userId, (d) =>
            d.query("select 1 from quotation_versions where quotation_id = $1", [q]),
          )
        ).rows,
      ).toHaveLength(0);
    });

    it("templates fill terms on creation and are tenant-scoped", async () => {
      const tid = await asUser(
        db,
        manager,
        async (d) =>
          (
            await d.query<{ id: string }>(
              "insert into quotation_templates (name, terms, payment_terms) values ('Std', 'Standard terms', '50% advance') returning id",
            )
          ).rows[0].id,
      );
      const qid = await asUser(
        db,
        exec,
        async (d) =>
          (
            await d.query<{ create_quotation: string }>(
              "select public.create_quotation($1, 'From template', null, null, $2)",
              [customerA, tid],
            )
          ).rows[0].create_quotation,
      );
      const d = await doc(exec, qid);
      expect(d.terms).toBe("Standard terms");
      expect(d.paymentTerms).toBe("50% advance");
      expect(
        (await asUser(db, b.userId, (x) => x.query("select 1 from quotation_templates"))).rows,
      ).toHaveLength(0);
      expect(
        await asUser(db, viewer, (x) =>
          fails(() => x.query("insert into quotation_templates (name) values ('nope')")),
        ),
      ).toBe(true);
    });
  });
});
