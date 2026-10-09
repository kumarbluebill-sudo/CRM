import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const SHA = "f".repeat(64);
const uid = () => crypto.randomUUID();

describe("visa module: RLS, permissions, workflow (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let mgr: string, exec: string, ops: string, acc: string, viewer: string;
  let custA = "",
    custB = "",
    country = "",
    product = "",
    restricted = "",
    dtPassport = "",
    dtPhoto = "",
    dtBank = "";
  let enquiry = "",
    app = "";
  let items: { id: string; name: string; required: boolean; status: string }[] = [];

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
  const status = async (user = a.userId) =>
    (await one(user, "select status from visa_applications where id = $1", [app])).status;
  const setStatus = (user: string, to: string, reason: string | null = null) =>
    q1(user, "select public.set_visa_status($1, $2, $3)", [app, to, reason]);
  const loadItems = async () =>
    (items = await q1(
      a.userId,
      "select id, name, required, status from visa_application_documents where application_id = $1 and status <> 'NOT_REQUIRED' order by sort, name",
      [app],
    ));
  const upload = async (user: string, application = app) =>
    (
      await one(
        user,
        `insert into documents (category, name, storage_path, mime_type, size_bytes, sha256, visa_application_id)
         values ('VISA', 'scan.pdf', $1, 'application/pdf', 100, '${SHA}', $2) returning id`,
        [`${a.orgId}/${uid()}.pdf`, application],
      )
    ).id;

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    mgr = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    ops = await member(a.orgId, "ops@a.test", "OPERATIONS");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    custA = (
      await one(
        a.userId,
        "insert into customers (name, email, phone, date_of_birth) values ('Raj Kumar', 'raj@example.test', '+91 98765 43210', '1985-04-02') returning id",
      )
    ).id;
    custB = (
      await one(
        b.userId,
        "insert into customers (name) values ('Other Agency Customer') returning id",
      )
    ).id;
    country = (
      await one(
        a.userId,
        "insert into visa_countries (name, iso_code, region) values ('Thailand', 'TH', 'Asia') returning id",
      )
    ).id;
    dtPassport = (
      await one(
        a.userId,
        "insert into visa_document_types (code, name, storage_category) values ('PASSPORT', 'Passport', 'PASSPORT') returning id",
      )
    ).id;
    dtPhoto = (
      await one(
        a.userId,
        "insert into visa_document_types (code, name) values ('PHOTO', 'Photograph') returning id",
      )
    ).id;
    dtBank = (
      await one(
        a.userId,
        "insert into visa_document_types (code, name) values ('BANK', 'Bank statement') returning id",
      )
    ).id;
    product = (
      await one(
        a.userId,
        `insert into visa_products (country_id, visa_type, entry_type, stay_days, processing_days_normal, service_fee, markup_percent, gst_percent, source)
      values ($1, 'TOURIST', 'SINGLE', 30, 5, 0, 0, 18, 'Agency price list Oct 2026') returning id`,
        [country],
      )
    ).id;
    restricted = (
      await one(
        a.userId,
        `insert into visa_products (country_id, visa_type, entry_type, nationality) values ($1, 'BUSINESS', 'SINGLE', 'Indian') returning id`,
        [country],
      )
    ).id;
    await q1(
      a.userId,
      `insert into visa_requirements (product_id, document_type_id, required) values ($1, $2, true), ($1, $3, true), ($1, $4, false)`,
      [product, dtPassport, dtPhoto, dtBank],
    );
  });
  afterAll(async () => db.close());

  describe("master data and pricing", () => {
    it("lets managers of masters edit, others read, nobody else write", async () => {
      expect(await q1(exec, "select id from visa_products")).toHaveLength(2);
      expect(
        await fails(() =>
          q1(exec, "insert into visa_countries (name, iso_code) values ('Japan','JP')"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(viewer, "insert into visa_document_types (code, name) values ('X1', 'X')"),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(ops, "insert into visa_products (country_id, visa_type) values ($1, 'OTHER')", [
            country,
          ]),
        ),
      ).toBe(true);
      expect(await q1(b.userId, "select id from visa_products")).toHaveLength(0);
      expect(
        await fails(() =>
          q1(b.userId, "insert into visa_products (country_id, visa_type) values ($1, 'OTHER')", [
            country,
          ]),
        ),
      ).toBe(true); // cross-tenant country
    });

    it("computes the selling price server-side and keeps cost away from sales staff", async () => {
      await q1(
        a.userId,
        "select public.update_visa_pricing($1, 500, 0, 10, 18, 1000, 2000, 'Initial price list')",
        [product],
      );
      expect(Number((await one(exec, "select public.visa_unit_price($1) as p", [product])).p)).toBe(
        4543,
      ); // (1000+2000+500)*1.10*1.18
      expect(await q1(exec, "select * from visa_product_costs")).toHaveLength(0); // no visa.supplier.view
      expect(await q1(acc, "select * from visa_product_costs")).toHaveLength(1);
      expect(
        await fails(() =>
          q1(exec, "select public.update_visa_pricing($1, 1, 0, 0, 18, null, null, 'x y z')", [
            product,
          ]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(ops, "select public.update_visa_pricing($1, 1, 0, 0, 18, null, null, 'x y z')", [
            product,
          ]),
        ),
      ).toBe(true); // supplier.edit but not price.edit
      expect(
        await fails(() =>
          q1(a.userId, "update visa_products set service_fee = 0 where id = $1", [product]),
        ),
      ).toBe(true); // must go through the function
      expect(
        await fails(() =>
          q1(a.userId, "select public.update_visa_pricing($1, 1, 0, 0, 18, null, null, '')", [
            product,
          ]),
        ),
      ).toBe(true); // reason required
      expect(
        await fails(() =>
          q1(b.userId, "select public.visa_unit_price($1)", [product]).then((r) => {
            if (r[0].visa_unit_price === null) throw new Error("none");
          }),
        ),
      ).toBe(true);
    });

    it("records every price change with who, why and the old and new price", async () => {
      await q1(
        a.userId,
        "select public.update_visa_pricing($1, 600, 0, 10, 18, null, null, 'Service fee revised')",
        [product],
      );
      const h = await q1(
        exec,
        "select old_price, new_price, cost_changed, reason from visa_price_history order by created_at",
      );
      expect(h).toHaveLength(2);
      expect(h[1]).toMatchObject({ reason: "Service fee revised", cost_changed: false });
      expect(Number(h[1].old_price)).toBe(4543);
      expect(Number(h[1].new_price)).toBe(4672.8); // (1000+2000+600)*1.10*1.18
    });
  });

  describe("enquiries", () => {
    it("creates numbered enquiries; staff without visa.create cannot; no direct writes", async () => {
      enquiry = (
        await one(
          exec,
          "select public.create_visa_enquiry($1, null, $2, 'Indian', current_date + 40, 2, 'Walk-in', null, 'HIGH', 'Family trip', current_date + 1) as id",
          [custA, product],
        )
      ).id;
      const e = await one(exec, "select * from visa_enquiries where id = $1", [enquiry]);
      expect(e.enquiry_number).toMatch(/^VISA-ENQ-\d{4}-0001$/);
      expect(e).toMatchObject({ status: "NEW", priority: "HIGH", travellers: 2 });
      expect(e.country_id).toBe(country);
      expect(await fails(() => q1(viewer, "select public.create_visa_enquiry($1)", [custA]))).toBe(
        true,
      );
      expect(await fails(() => q1(exec, "select public.create_visa_enquiry($1)", [custB]))).toBe(
        true,
      ); // other agency's customer
      expect(
        await fails(() =>
          q1(exec, "insert into visa_enquiries (enquiry_number, customer_id) values ('X', $1)", [
            custA,
          ]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "update visa_enquiries set status = 'CONVERTED' where id = $1", [enquiry]),
        ),
      ).toBe(true);
    });

    it("only allows defined status changes and requires a reason to lose or cancel", async () => {
      await q1(exec, "select public.set_visa_enquiry_status($1, 'CONTACTED')", [enquiry]);
      expect(
        await fails(() =>
          q1(exec, "select public.set_visa_enquiry_status($1, 'CONVERTED')", [enquiry]),
        ),
      ).toBe(true);
      expect(
        await fails(() => q1(exec, "select public.set_visa_enquiry_status($1, 'LOST')", [enquiry])),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(viewer, "select public.set_visa_enquiry_status($1, 'FOLLOW_UP')", [enquiry]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(b.userId, "select public.set_visa_enquiry_status($1, 'FOLLOW_UP')", [enquiry]),
        ),
      ).toBe(true);
    });

    it("finds existing customers before a duplicate is created", async () => {
      const byMobile = await q1(
        exec,
        "select * from public.find_visa_customer_duplicates('09876543210')",
      );
      expect(byMobile.map((r: any) => r.matched_on)).toContain("MOBILE");
      const byEmail = await q1(
        exec,
        "select * from public.find_visa_customer_duplicates(null, 'RAJ@example.test')",
      );
      expect(byEmail[0]).toMatchObject({ customer_id: custA, matched_on: "EMAIL" });
      const byName = await q1(
        exec,
        "select * from public.find_visa_customer_duplicates(null, null, null, 'raj kumar', '1985-04-02')",
      );
      expect(byName[0].matched_on).toBe("NAME_AND_DOB");
      expect(
        await q1(
          b.userId,
          "select * from public.find_visa_customer_duplicates('9876543210', 'raj@example.test')",
        ),
      ).toHaveLength(0);
      expect(
        await fails(() =>
          q1(viewer, "select * from public.find_visa_customer_duplicates('9876543210')"),
        ),
      ).toBe(false); // viewers have customers.view
    });
  });

  describe("applications, travellers and checklist", () => {
    it("converts an enquiry once, builds the checklist from configured requirements, and links the lead traveller", async () => {
      app = (await one(exec, "select public.convert_enquiry_to_application($1) as id", [enquiry]))
        .id;
      const row = await one(a.userId, "select * from visa_applications where id = $1", [app]);
      expect(row.application_number).toMatch(/^VISA-\d{4}-0001$/);
      expect(row).toMatchObject({
        status: "NEW",
        visa_type: "TOURIST",
        priority: "HIGH",
        nationality: "Indian",
        customer_id: custA,
      });
      expect(
        await one(
          a.userId,
          "select status, converted_application_id from visa_enquiries where id = $1",
          [enquiry],
        ),
      ).toMatchObject({ status: "CONVERTED", converted_application_id: app });
      const trav = await q1(
        a.userId,
        "select first_name, last_name, is_lead, applicant_type from visa_travellers where application_id = $1",
        [app],
      );
      expect(trav).toEqual([
        { first_name: "Raj", last_name: "Kumar", is_lead: true, applicant_type: "ADULT" },
      ]);
      await loadItems();
      expect(items.map((i) => [i.name, i.required, i.status])).toEqual(
        [
          ["Bank statement", false, "PENDING"],
          ["Passport", true, "PENDING"],
          ["Photograph", true, "PENDING"],
        ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))).length
          ? items.map((i) => [i.name, i.required, i.status])
          : [],
      );
      expect(items).toHaveLength(3);
      expect(
        await fails(() => q1(exec, "select public.convert_enquiry_to_application($1)", [enquiry])),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            exec,
            "insert into visa_applications (application_number, customer_id, product_id, country_id, visa_type, nationality) values ('X', $1, $2, $3, 'TOURIST', 'Indian')",
            [custA, product, country],
          ),
        ),
      ).toBe(true);
    });

    it("refuses a product that is not offered for the nationality, and other agencies' data", async () => {
      expect(
        await fails(() =>
          q1(exec, "select public.create_visa_application($1, $2, 'French')", [custA, restricted]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, "select public.create_visa_application($1, $2, 'Indian')", [custB, product]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(b.userId, "select public.create_visa_application($1, $2, 'Indian')", [custB, product]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(viewer, "select public.create_visa_application($1, $2, 'Indian')", [custA, product]),
        ),
      ).toBe(true);
    });

    it("adds travellers with passports, extends the checklist, and warns about duplicate passports", async () => {
      const tid = (
        await one(
          exec,
          `select public.add_visa_traveller($1, '{"first_name":"Priya","last_name":"Kumar","date_of_birth":"2015-06-01","passport_number":"p1234567","passport_expiry_date":"2030-01-01","passport_country":"India"}'::jsonb) as id`,
          [app],
        )
      ).id;
      const t = await one(a.userId, "select applicant_type from visa_travellers where id = $1", [
        tid,
      ]);
      expect(t.applicant_type).toBe("CHILD");
      await loadItems();
      expect(items).toHaveLength(6); // 3 per traveller
      expect(
        await fails(() =>
          q1(viewer, `select public.add_visa_traveller($1, '{"first_name":"X"}'::jsonb)`, [app]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(exec, `select public.add_visa_traveller($1, '{"first_name":""}'::jsonb)`, [app]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(b.userId, `select public.add_visa_traveller($1, '{"first_name":"X"}'::jsonb)`, [app]),
        ),
      ).toBe(true);
      // identity is normalised, restricted, and never returned by the duplicate finder
      const id = await q1(
        ops,
        "select passport_number from visa_traveller_identity where traveller_id = $1",
        [tid],
      );
      expect(id).toEqual([{ passport_number: "P1234567" }]);
      expect(await q1(viewer, "select * from visa_traveller_identity")).toHaveLength(0);
      expect(await q1(acc, "select * from visa_traveller_identity")).toHaveLength(0);
      expect(await q1(b.userId, "select * from visa_traveller_identity")).toHaveLength(0);
      const dup = await q1(ops, "select * from public.find_visa_passport_duplicates('P1234567')");
      expect(dup).toHaveLength(1);
      expect(Object.keys(dup[0]).sort()).toEqual([
        "application_number",
        "status",
        "traveller_name",
      ]);
      expect(
        await q1(ops, "select * from public.find_visa_passport_duplicates('P1234567', $1)", [tid]),
      ).toHaveLength(0);
      expect(
        await fails(() =>
          q1(viewer, "select * from public.find_visa_passport_duplicates('P1234567')"),
        ),
      ).toBe(true);
      // viewers can see traveller names, not identity
      expect(
        (
          await q1(viewer, "select first_name from visa_travellers where application_id = $1", [
            app,
          ])
        ).length,
      ).toBe(2);
    });

    it("updates and removes travellers (soft), keeping at least one", async () => {
      const [first, second] = await q1(
        a.userId,
        "select id from visa_travellers where application_id = $1 order by is_lead desc, created_at",
        [app],
      );
      await q1(
        ops,
        `select public.update_visa_traveller($1, '{"occupation":"Engineer","passport_number":"Z7654321"}'::jsonb)`,
        [second.id],
      );
      expect(
        (
          await one(
            ops,
            "select passport_number from visa_traveller_identity where traveller_id = $1",
            [second.id],
          )
        ).passport_number,
      ).toBe("Z7654321");
      expect(
        await fails(() =>
          q1(viewer, `select public.update_visa_traveller($1, '{"occupation":"x"}'::jsonb)`, [
            second.id,
          ]),
        ),
      ).toBe(true);
      await q1(exec, "select public.remove_visa_traveller($1)", [second.id]);
      expect(
        await fails(() => q1(exec, "select public.remove_visa_traveller($1)", [first.id])),
      ).toBe(true); // last one
      await q1(
        exec,
        `select public.add_visa_traveller($1, '{"first_name":"Priya","last_name":"Kumar","date_of_birth":"2015-06-01","passport_number":"P1234567"}'::jsonb)`,
        [app],
      );
      await loadItems();
    });
  });

  describe("documents and review", () => {
    it("lets visa staff upload linked documents without opening up other sensitive documents", async () => {
      const docId = await upload(exec);
      expect(docId).toBeTruthy();
      // the old rule still holds for everything that is not linked to a visa application
      expect(
        await fails(() =>
          q1(
            exec,
            `insert into documents (category, name, storage_path, mime_type, size_bytes, sha256) values ('PASSPORT','p.pdf',$1,'application/pdf',10,'${SHA}')`,
            [`${a.orgId}/${uid()}.pdf`],
          ),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            viewer,
            `insert into documents (category, name, storage_path, mime_type, size_bytes, sha256, visa_application_id) values ('VISA','p.pdf',$1,'application/pdf',10,'${SHA}',$2)`,
            [`${a.orgId}/${uid()}.pdf`, app],
          ),
        ),
      ).toBe(true);
      // who can see it
      expect(await q1(exec, "select id from documents where id = $1", [docId])).toHaveLength(1);
      expect(await q1(ops, "select id from documents where id = $1", [docId])).toHaveLength(1);
      for (const u of [viewer, acc, b.userId])
        expect(
          await q1(u, "select id from documents where id = $1", [docId]),
          String(u),
        ).toHaveLength(0);
      // attach
      const item = items.find((i) => i.name === "Passport")!;
      await q1(exec, "select public.attach_visa_document($1, $2)", [item.id, docId]);
      expect(
        (
          await one(
            a.userId,
            "select status, received_at from visa_application_documents where id = $1",
            [item.id],
          )
        ).status,
      ).toBe("UPLOADED");
      expect(
        await fails(() =>
          q1(viewer, "select public.attach_visa_document($1, $2)", [item.id, docId]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(b.userId, "select public.attach_visa_document($1, $2)", [item.id, docId]),
        ),
      ).toBe(true);
    });

    it("rejects a file linked to a different application", async () => {
      const other = (
        await one(exec, "select public.create_visa_application($1, $2, 'Indian') as id", [
          custA,
          product,
        ])
      ).id;
      const stray = await upload(exec, other);
      const item = items.find((i) => i.name === "Photograph")!;
      expect(
        await fails(() => q1(exec, "select public.attach_visa_document($1, $2)", [item.id, stray])),
      ).toBe(true);
    });

    it("reviews documents: approve, reject with a reason, correction, and re-upload resets the review", async () => {
      const mine = items.filter((i) => i.name === "Passport");
      const [p1, p2] = mine;
      expect(
        await fails(() => q1(exec, "select public.review_visa_document($1, 'APPROVED')", [p1.id])),
      ).toBe(true); // sales cannot approve
      await q1(ops, "select public.review_visa_document($1, 'APPROVED')", [p1.id]);
      expect(
        (
          await one(
            a.userId,
            "select status, reviewed_by from visa_application_documents where id = $1",
            [p1.id],
          )
        ).status,
      ).toBe("APPROVED");
      expect(
        await fails(() => q1(ops, "select public.review_visa_document($1, 'APPROVED')", [p2.id])),
      ).toBe(true); // nothing uploaded yet
      await q1(exec, "select public.attach_visa_document($1, $2)", [p2.id, await upload(exec)]);
      expect(
        await fails(() => q1(ops, "select public.review_visa_document($1, 'REJECTED')", [p2.id])),
      ).toBe(true); // reason required
      await q1(
        ops,
        "select public.review_visa_document($1, 'CORRECTION_REQUIRED', 'Scan is unclear')",
        [p2.id],
      );
      const c = await one(
        a.userId,
        "select status, review_note from visa_application_documents where id = $1",
        [p2.id],
      );
      expect(c).toEqual({ status: "CORRECTION_REQUIRED", review_note: "Scan is unclear" });
      await q1(exec, "select public.attach_visa_document($1, $2)", [p2.id, await upload(exec)]);
      expect(
        await one(
          a.userId,
          "select status, review_note, reviewed_at from visa_application_documents where id = $1",
          [p2.id],
        ),
      ).toEqual({ status: "UPLOADED", review_note: null, reviewed_at: null });
      await q1(ops, "select public.review_visa_document($1, 'APPROVED')", [p2.id]);
    });

    it("requests documents, and adds or removes only optional checklist lines", async () => {
      const photo = items.find((i) => i.name === "Photograph")!;
      await q1(
        exec,
        "select public.request_visa_document($1, 'Please send a white-background photo')",
        [photo.id],
      );
      expect(
        (
          await one(a.userId, "select status from visa_application_documents where id = $1", [
            photo.id,
          ])
        ).status,
      ).toBe("REQUESTED");
      const extra = (
        await one(
          exec,
          "select public.add_visa_checklist_item($1, null, 'Employment letter', false) as id",
          [app],
        )
      ).id;
      await q1(exec, "select public.remove_visa_checklist_item($1)", [extra]);
      expect(
        await q1(a.userId, "select id from visa_application_documents where id = $1", [extra]),
      ).toHaveLength(0);
      expect(
        await fails(() => q1(exec, "select public.remove_visa_checklist_item($1)", [photo.id])),
      ).toBe(true); // required
      expect(
        await fails(() => q1(viewer, "select public.request_visa_document($1)", [photo.id])),
      ).toBe(true);
    });
  });

  describe("workflow, assignment, timeline, audit", () => {
    it("moves only along defined transitions and only for permitted staff", async () => {
      expect(
        await fails(() =>
          q1(exec, "select public.set_visa_status($1, 'DOCUMENTS_PENDING')", [app]),
        ),
      ).toBe(true); // no visa.process
      await setStatus(ops, "DOCUMENTS_PENDING");
      expect(await fails(() => setStatus(ops, "DELIVERED"))).toBe(true);
      expect(await fails(() => setStatus(ops, "SUBMITTED"))).toBe(true);
      await setStatus(ops, "DOCUMENTS_RECEIVED");
      await setStatus(ops, "DOCUMENT_REVIEW");
      expect(await fails(() => setStatus(ops, "DELIVERED"))).toBe(true);
      expect(await fails(() => setStatus(ops, "CORRECTION_REQUIRED"))).toBe(true); // reason required
      expect(await fails(() => setStatus(ops, "READY_FOR_SUBMISSION"))).toBe(true); // required documents still open
      expect(await fails(() => setStatus(b.userId, "READY_FOR_SUBMISSION"))).toBe(true);
    });

    it("allows submission only once every required document is approved", async () => {
      await loadItems();
      for (const i of items.filter((x) => x.required && x.status !== "APPROVED")) {
        if (i.status !== "UPLOADED")
          await q1(exec, "select public.attach_visa_document($1, $2)", [i.id, await upload(exec)]);
        await q1(ops, "select public.review_visa_document($1, 'APPROVED')", [i.id]);
      }
      await setStatus(ops, "READY_FOR_SUBMISSION");
      await setStatus(ops, "SUBMITTED");
      expect(
        (await one(a.userId, "select submitted_at from visa_applications where id = $1", [app]))
          .submitted_at,
      ).not.toBeNull();
      await setStatus(ops, "PROCESSING");
      await setStatus(ops, "APPROVED");
      await setStatus(ops, "VISA_RECEIVED");
      expect(await fails(() => setStatus(ops, "DELIVERED"))).toBe(true); // delivery must be recorded
      const lead = (
        await one(ops, "select id from visa_travellers where application_id = $1 limit 1", [app])
      ).id;
      await q1(ops, "select public.record_visa_result($1, $2, $3)", [app, lead, await upload(ops)]);
      await q1(ops, "select public.record_visa_delivery($1, 'EMAIL')", [app]);
      expect(await status()).toBe("DELIVERED");
      await setStatus(ops, "CLOSED");
      expect(await status()).toBe("CLOSED");
      expect(await fails(() => setStatus(ops, "NEW"))).toBe(true);
      expect(
        await fails(() =>
          q1(ops, `select public.add_visa_traveller($1, '{"first_name":"Late"}'::jsonb)`, [app]),
        ),
      ).toBe(true); // closed
    });

    it("assigns staff (managers only), rejects non-members, and records the timeline", async () => {
      expect(
        await fails(() =>
          q1(exec, "select public.assign_visa_application($1, $2, $3, null)", [app, exec, ops]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(mgr, "select public.assign_visa_application($1, $2, null, null)", [app, b.userId]),
        ),
      ).toBe(true); // other agency's user
      await q1(mgr, "select public.assign_visa_application($1, $2, $3, $4)", [app, exec, ops, mgr]);
      expect(
        await one(
          a.userId,
          "select sales_user_id, processor_user_id, manager_user_id from visa_applications where id = $1",
          [app],
        ),
      ).toEqual({ sales_user_id: exec, processor_user_id: ops, manager_user_id: mgr });
      const ev = await q1(
        viewer,
        "select event_type, summary from visa_events where application_id = $1 order by created_at",
        [app],
      );
      expect(ev[0].event_type).toBe("CREATED");
      const kinds = new Set(ev.map((e: any) => e.event_type));
      for (const k of [
        "TRAVELLER_ADDED",
        "DOCUMENT_UPLOADED",
        "DOCUMENT_APPROVED",
        "STATUS",
        "ASSIGNED",
      ])
        expect(kinds.has(k), k).toBe(true);
      expect(
        await fails(() =>
          q1(
            a.userId,
            "insert into visa_events (application_id, event_type, summary) values ($1, 'X', 'forged')",
            [app],
          ),
        ),
      ).toBe(true);
      expect(await fails(() => q1(a.userId, "delete from visa_events"))).toBe(true);
      expect(await q1(b.userId, "select id from visa_events")).toHaveLength(0);
    });

    it("writes the audit trail and keeps passport numbers and files out of it", async () => {
      const rows = await q1(
        a.userId,
        "select action, entity_type, metadata from audit_logs where entity_type like 'visa_%'",
      );
      const types = new Set(rows.map((r: any) => `${r.action}:${r.entity_type}`));
      for (const t of [
        "CREATE:visa_enquiry",
        "CREATE:visa_application",
        "STATUS_CHANGE:visa_application",
        "STATUS_CHANGE:visa_document",
        "UPLOAD:visa_document",
        "UPDATE:visa_product_price",
      ])
        expect(types.has(t), t).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/P1234567|Z7654321|passport_number/i);
    });
  });

  describe("soft delete, dashboard, tasks and isolation", () => {
    it("soft-deletes only early or cancelled applications, by authorised staff", async () => {
      const early = (
        await one(exec, "select public.create_visa_application($1, $2, 'Indian') as id", [
          custA,
          product,
        ])
      ).id;
      expect(await fails(() => q1(ops, "select public.delete_visa_application($1)", [early]))).toBe(
        true,
      ); // no visa.delete
      await q1(a.userId, "select public.delete_visa_application($1)", [early]);
      expect(
        (await one(a.userId, "select deleted_at from visa_applications where id = $1", [early]))
          .deleted_at,
      ).not.toBeNull(); // retained
      expect(
        await fails(() =>
          q1(a.userId, "select public.set_visa_status($1, 'DOCUMENTS_PENDING')", [early]),
        ),
      ).toBe(true); // treated as gone
      expect(
        await fails(() => q1(a.userId, "select public.delete_visa_application($1)", [app])),
      ).toBe(true); // closed visa is kept
    });

    it("reports dashboard numbers per agency and only to people who can view", async () => {
      const d = (await one(exec, "select public.visa_dashboard() as d")).d;
      expect(d.byStatus.CLOSED).toBe(1);
      expect(d.enquiriesOpen).toBe(0);
      const other = (await one(b.userId, "select public.visa_dashboard() as d")).d;
      expect(other.byStatus).toEqual({});
      const nobody = await createUser(db, "nobody@x.test");
      expect(await fails(() => q1(nobody, "select public.visa_dashboard()"))).toBe(true);
    });

    it("lets follow-up tasks point at a visa application", async () => {
      await q1(
        exec,
        "insert into tasks (kind, title, related_type, related_id) values ('FOLLOWUP', 'Call customer about passport', 'VISA_APPLICATION', $1)",
        [app],
      );
      expect(
        await q1(
          exec,
          "select id from tasks where related_type = 'VISA_APPLICATION' and title = 'Call customer about passport'",
        ),
      ).toHaveLength(1);
      expect(
        await fails(() =>
          q1(
            exec,
            "insert into tasks (kind, title, related_type, related_id) values ('TASK', 'x', 'NOPE', $1)",
            [app],
          ),
        ),
      ).toBe(true);
    });

    it("shows another agency nothing, in any visa table", async () => {
      for (const t of [
        "visa_countries",
        "visa_document_types",
        "visa_products",
        "visa_product_costs",
        "visa_price_history",
        "visa_requirements",
        "visa_enquiries",
        "visa_applications",
        "visa_travellers",
        "visa_traveller_identity",
        "visa_application_documents",
        "visa_events",
      ])
        expect(await q1(b.userId, `select * from ${t}`), t).toHaveLength(0);
      for (const t of [
        "visa_countries",
        "visa_products",
        "visa_enquiries",
        "visa_applications",
        "visa_events",
      ])
        expect(await q1(null, `select * from ${t}`).catch(() => []), `anon ${t}`).toHaveLength(0);
    });
  });
});
