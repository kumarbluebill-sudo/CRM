import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * LIVE visa-module tests against the real Supabase project in .env.local. Throwaway users (@example.invalid, no email
 * is ever sent) and "LIVE-TEST" agencies are created and removed. Run with RUN_LIVE=1 (see tests/live/live-supabase).
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
const email = (n: string) => `live-v${n}-${run}@example.invalid`;
const uid = () => crypto.randomUUID();

async function rpc<T = any>(
  c: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}
const denied = async (p: PromiseLike<{ error: unknown }>) => Boolean((await p).error);

describe.skipIf(!LIVE)("live Supabase: visa module (throwaway data, cleaned up)", () => {
  let admin: SupabaseClient,
    a: SupabaseClient,
    b: SupabaseClient,
    ops: SupabaseClient,
    exec: SupabaseClient;
  const userIds: string[] = [];
  let orgA = "",
    customer = "",
    product = "",
    enquiry = "",
    app = "";
  let items: { id: string; name: string; required: boolean; status: string }[] = [];

  async function makeUser(name: string) {
    const { data, error } = await admin.auth.admin.createUser({
      email: email(name),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `LIVE-TEST ${name}` },
    });
    if (error) throw error;
    userIds.push(data.user.id);
    const c = createClient(URL_, PUB, opts);
    const { error: e2 } = await c.auth.signInWithPassword({
      email: email(name),
      password: PASSWORD,
    });
    if (e2) throw e2;
    return { c, id: data.user.id };
  }

  beforeAll(async () => {
    admin = createClient(URL_, SERVICE, opts);
    a = (await makeUser("a")).c;
    b = (await makeUser("b")).c;
    orgA = await rpc<string>(a, "create_organization", { org_name: "LIVE-TEST Visa Agency A" });
    await rpc(b, "create_organization", { org_name: "LIVE-TEST Visa Agency B" });
    // staff in agency A with different roles, added by the owner through the normal invitation flow
    const opsU = await makeUser("ops");
    const execU = await makeUser("exec");
    await rpc(a, "create_invite", { p_email: email("ops"), p_role: "OPERATIONS" });
    await rpc(a, "create_invite", { p_email: email("exec"), p_role: "SALES_EXECUTIVE" });
    await rpc(opsU.c, "accept_invite");
    await rpc(execU.c, "accept_invite");
    ops = opsU.c;
    exec = execU.c;
  }, 120_000);

  afterAll(async () => {
    const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    try {
      await db.connect();
      const orgs = (
        await db.query(
          `select distinct o.id from public.organizations o
         left join public.organization_members m on m.organization_id = o.id
        where o.name like 'LIVE-TEST %' and (m.user_id = any($1::uuid[]) or not exists (select 1 from public.organization_members x where x.organization_id = o.id)
          or o.created_at < now() - interval '30 minutes')`,
          [userIds],
        )
      ).rows.map((r) => r.id);
      for (const id of orgs) {
        const paths = (
          await db.query("select storage_path from public.documents where organization_id = $1", [
            id,
          ])
        ).rows.map((r) => r.storage_path);
        if (paths.length) await admin.storage.from("documents").remove(paths);
        await db.query("delete from public.organizations where id = $1", [id]);
      }
    } finally {
      await db.end().catch(() => {});
    }
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of data?.users ?? [])
      if (
        userIds.includes(u.id) ||
        (/^live-[a-z]+-[0-9a-f]{8}@example\.invalid$/.test(u.email ?? "") &&
          Date.now() - Date.parse(u.created_at) > 30 * 60 * 1000)
      )
        await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }, 120_000);

  it("is locked down for anonymous visitors and keeps visa functions away from them", async () => {
    const anon = createClient(URL_, PUB, opts);
    for (const t of [
      "visa_applications",
      "visa_enquiries",
      "visa_travellers",
      "visa_traveller_identity",
      "visa_application_documents",
      "visa_products",
      "visa_product_costs",
      "visa_events",
    ]) {
      const r = await anon.from(t).select("*").limit(1);
      expect(r.error ? [] : r.data, t).toEqual([]);
    }
    for (const fn of [
      "create_visa_application",
      "set_visa_status",
      "visa_dashboard",
      "review_visa_document",
    ])
      expect(await denied(anon.rpc(fn, {})), fn).toBe(true);
  });

  it("owner sets up master data; price is computed server-side and cost stays hidden from sales", async () => {
    const country = await a
      .from("visa_countries")
      .insert({ name: "Thailand", iso_code: "TH", region: "Asia" })
      .select("id")
      .single();
    expect(country.error).toBeNull();
    const passport = await a
      .from("visa_document_types")
      .insert({ code: "PASSPORT", name: "Passport", storage_category: "PASSPORT" })
      .select("id")
      .single();
    const photo = await a
      .from("visa_document_types")
      .insert({ code: "PHOTO", name: "Photograph" })
      .select("id")
      .single();
    const bank = await a
      .from("visa_document_types")
      .insert({ code: "BANK", name: "Bank statement" })
      .select("id")
      .single();
    const prod = await a
      .from("visa_products")
      .insert({
        country_id: country.data!.id,
        visa_type: "TOURIST",
        entry_type: "SINGLE",
        stay_days: 30,
        processing_days_normal: 5,
        source: "LIVE test price list",
      })
      .select("id")
      .single();
    expect(prod.error).toBeNull();
    product = prod.data!.id;
    await a.from("visa_requirements").insert([
      { product_id: product, document_type_id: passport.data!.id, required: true },
      { product_id: product, document_type_id: photo.data!.id, required: true },
      { product_id: product, document_type_id: bank.data!.id, required: false },
    ]);
    await rpc(a, "update_visa_pricing", {
      p_product: product,
      p_service_fee: 500,
      p_express_fee: 0,
      p_markup: 10,
      p_gst: 18,
      p_government_fee: 1000,
      p_supplier_fee: 2000,
      p_reason: "Initial price list",
    });
    expect(Number(await rpc(exec, "visa_unit_price", { p_product: product }))).toBe(4543);
    expect((await exec.from("visa_product_costs").select("*")).data).toEqual([]);
    expect((await ops.from("visa_product_costs").select("*")).data).toHaveLength(1); // operations see supplier cost
    expect(
      await denied(exec.from("visa_countries").insert({ name: "Japan", iso_code: "JP" })),
    ).toBe(true);
    expect(await denied(a.from("visa_products").update({ service_fee: 0 }).eq("id", product))).toBe(
      true,
    );
    expect(
      await denied(
        exec.rpc("update_visa_pricing", {
          p_product: product,
          p_service_fee: 1,
          p_express_fee: 0,
          p_markup: 0,
          p_gst: 18,
          p_reason: "nope nope",
        }),
      ),
    ).toBe(true);
    const hist = await exec.from("visa_price_history").select("new_price, reason");
    expect(hist.data).toHaveLength(1);
  });

  it("runs the front office flow: customer, duplicate check, enquiry, conversion, checklist", async () => {
    const c = await a
      .from("customers")
      .insert({
        name: "LIVE-TEST Raj Kumar",
        email: "raj@example.invalid",
        phone: "+91 98765 43210",
      })
      .select("id")
      .single();
    expect(c.error).toBeNull();
    customer = c.data!.id;
    const dup = await rpc<{ matched_on: string }[]>(exec, "find_visa_customer_duplicates", {
      p_mobile: "9876543210",
    });
    expect(dup.map((d) => d.matched_on)).toContain("MOBILE");
    enquiry = await rpc<string>(exec, "create_visa_enquiry", {
      p_customer: customer,
      p_product: product,
      p_nationality: "Indian",
      p_travel_date: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10),
      p_travellers: 2,
      p_priority: "HIGH",
    });
    expect(
      (
        await exec
          .from("visa_enquiries")
          .select("enquiry_number, status")
          .eq("id", enquiry)
          .single()
      ).data,
    ).toMatchObject({ status: "NEW" });
    expect(
      await denied(
        exec.from("visa_enquiries").insert({ enquiry_number: "X", customer_id: customer }),
      ),
    ).toBe(true);
    await rpc(exec, "set_visa_enquiry_status", { p_id: enquiry, p_status: "CONTACTED" });
    app = await rpc<string>(exec, "convert_enquiry_to_application", { p_enquiry: enquiry });
    const row = await a
      .from("visa_applications")
      .select("application_number, status, visa_type")
      .eq("id", app)
      .single();
    expect(row.data!.application_number).toMatch(/^VISA-\d{4}-0001$/);
    expect(row.data).toMatchObject({ status: "NEW", visa_type: "TOURIST" });
    expect(await denied(exec.rpc("convert_enquiry_to_application", { p_enquiry: enquiry }))).toBe(
      true,
    );
    const list = await a
      .from("visa_application_documents")
      .select("id, name, required, status")
      .eq("application_id", app);
    items = list.data as typeof items;
    expect(items.map((i) => i.name).sort()).toEqual(["Bank statement", "Passport", "Photograph"]);
  });

  it("travellers and passports: restricted to staff who may see them, duplicates flagged, never exposed to others", async () => {
    await rpc(exec, "add_visa_traveller", {
      p_application: app,
      p_data: {
        first_name: "Priya",
        last_name: "Kumar",
        date_of_birth: "2015-06-01",
        passport_number: "p1234567",
        passport_expiry_date: "2031-01-01",
      },
    });
    expect(
      (await a.from("visa_travellers").select("id").eq("application_id", app)).data,
    ).toHaveLength(2);
    expect((await ops.from("visa_traveller_identity").select("passport_number")).data).toEqual([
      { passport_number: "P1234567" },
    ]);
    expect((await b.from("visa_traveller_identity").select("*")).data).toEqual([]);
    const dup = await rpc<Record<string, unknown>[]>(ops, "find_visa_passport_duplicates", {
      p_passport: "P1234567",
    });
    expect(dup).toHaveLength(1);
    expect(Object.keys(dup[0]).sort()).toEqual(["application_number", "status", "traveller_name"]);
    expect(
      (await a.from("visa_application_documents").select("id").eq("application_id", app)).data,
    ).toHaveLength(6);
    items = (
      await a
        .from("visa_application_documents")
        .select("id, name, required, status")
        .eq("application_id", app)
    ).data as typeof items;
  });

  it("stores visa files privately, links them to the checklist, and keeps strangers out", async () => {
    const path = `${orgA}/${uid()}.pdf`;
    expect(
      (
        await admin.storage
          .from("documents")
          .upload(path, new Blob(["%PDF-1.4 live"], { type: "application/pdf" }), {
            contentType: "application/pdf",
          })
      ).error,
    ).toBeNull();
    const doc = await exec
      .from("documents")
      .insert({
        category: "PASSPORT",
        name: "passport.pdf",
        storage_path: path,
        mime_type: "application/pdf",
        size_bytes: 20,
        sha256: "a".repeat(64),
        visa_application_id: app,
      })
      .select("id")
      .single();
    expect(doc.error).toBeNull(); // sales can file visa documents without the general sensitive-document permission
    const passportItem = items.find((i) => i.name === "Passport")!;
    await rpc(exec, "attach_visa_document", { p_item: passportItem.id, p_document: doc.data!.id });
    expect(
      (
        await a
          .from("visa_application_documents")
          .select("status")
          .eq("id", passportItem.id)
          .single()
      ).data!.status,
    ).toBe("UPLOADED");
    // the old rule still applies to documents not tied to a visa application
    expect(
      await denied(
        exec.from("documents").insert({
          category: "PASSPORT",
          name: "x.pdf",
          storage_path: `${orgA}/${uid()}.pdf`,
          mime_type: "application/pdf",
          size_bytes: 20,
          sha256: "b".repeat(64),
        }),
      ),
    ).toBe(true);
    // visibility
    expect((await ops.from("documents").select("id").eq("id", doc.data!.id)).data).toHaveLength(1);
    expect((await b.from("documents").select("id").eq("id", doc.data!.id)).data).toEqual([]);
    // the file is reachable only through a signed link
    const signed = await admin.storage.from("documents").createSignedUrl(path, 60);
    expect((await fetch(signed.data!.signedUrl)).status).toBe(200);
    expect(
      (await fetch(`${URL_}/storage/v1/object/public/documents/${path}`)).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await denied(b.storage.from("documents").download(path))).toBe(true);
  });

  it("reviews documents with the right permissions, and walks the workflow to closure", async () => {
    const [passportItem, photoItem] = [
      items.find((i) => i.name === "Passport")!,
      items.find((i) => i.name === "Photograph")!,
    ];
    expect(
      await denied(
        exec.rpc("review_visa_document", { p_item: passportItem.id, p_decision: "APPROVED" }),
      ),
    ).toBe(true); // sales cannot approve
    expect(
      await denied(
        ops.rpc("review_visa_document", { p_item: photoItem.id, p_decision: "APPROVED" }),
      ),
    ).toBe(true); // nothing uploaded
    await rpc(ops, "review_visa_document", {
      p_item: passportItem.id,
      p_decision: "CORRECTION_REQUIRED",
      p_note: "Scan is unclear",
    });
    expect(
      (
        await a
          .from("visa_application_documents")
          .select("status, review_note")
          .eq("id", passportItem.id)
          .single()
      ).data,
    ).toEqual({ status: "CORRECTION_REQUIRED", review_note: "Scan is unclear" });
    expect(
      await denied(
        ops.rpc("review_visa_document", { p_item: passportItem.id, p_decision: "REJECTED" }),
      ),
    ).toBe(true); // reason required

    // approve every required line for both travellers (upload a file for each first)
    const required = (
      await a
        .from("visa_application_documents")
        .select("id, name, status")
        .eq("application_id", app)
        .eq("required", true)
    ).data!;
    for (const it of required) {
      const path = `${orgA}/${uid()}.pdf`;
      await admin.storage
        .from("documents")
        .upload(path, new Blob(["%PDF-1.4 x"], { type: "application/pdf" }), {
          contentType: "application/pdf",
        });
      const d = await exec
        .from("documents")
        .insert({
          category: "VISA",
          name: "scan.pdf",
          storage_path: path,
          mime_type: "application/pdf",
          size_bytes: 10,
          sha256: "c".repeat(64),
          visa_application_id: app,
        })
        .select("id")
        .single();
      await rpc(exec, "attach_visa_document", { p_item: it.id, p_document: d.data!.id });
      await rpc(ops, "review_visa_document", { p_item: it.id, p_decision: "APPROVED" });
    }
    const step = (to: string, reason?: string) =>
      rpc(ops, "set_visa_status", { p_id: app, p_status: to, p_reason: reason ?? null });
    expect(
      await denied(exec.rpc("set_visa_status", { p_id: app, p_status: "DOCUMENTS_PENDING" })),
    ).toBe(true);
    await step("DOCUMENTS_PENDING");
    await step("DOCUMENTS_RECEIVED");
    await step("DOCUMENT_REVIEW");
    expect(await denied(ops.rpc("set_visa_status", { p_id: app, p_status: "DELIVERED" }))).toBe(
      true,
    );
    await step("READY_FOR_SUBMISSION");
    await step("SUBMITTED");
    await step("PROCESSING");
    await step("APPROVED");
    await step("VISA_RECEIVED");
    expect(await denied(ops.rpc("set_visa_status", { p_id: app, p_status: "DELIVERED" }))).toBe(
      true,
    ); // delivery must be recorded first
    const finalDoc = await ops
      .from("documents")
      .insert({
        category: "VISA",
        name: "visa.pdf",
        storage_path: `${orgA}/${uid()}.pdf`,
        mime_type: "application/pdf",
        size_bytes: 10,
        sha256: "d".repeat(64),
        visa_application_id: app,
      })
      .select("id")
      .single();
    const leadTraveller = (
      await a
        .from("visa_travellers")
        .select("id")
        .eq("application_id", app)
        .eq("is_lead", true)
        .single()
    ).data!;
    await rpc(ops, "record_visa_result", {
      p_app: app,
      p_traveller: leadTraveller.id,
      p_document: finalDoc.data!.id,
    });
    await rpc(ops, "record_visa_delivery", { p_app: app, p_method: "EMAIL" });
    await step("CLOSED");
    expect(
      (
        await a
          .from("visa_applications")
          .select("status, submitted_at, closed_at")
          .eq("id", app)
          .single()
      ).data,
    ).toMatchObject({ status: "CLOSED" });
    expect(
      await denied(
        ops.rpc("add_visa_traveller", { p_application: app, p_data: { first_name: "Late" } }),
      ),
    ).toBe(true);
  });

  it("keeps a full timeline and audit trail, and shows another agency nothing", async () => {
    const events = (
      await a.from("visa_events").select("event_type").eq("application_id", app)
    ).data!.map((e) => e.event_type);
    for (const k of [
      "CREATED",
      "TRAVELLER_ADDED",
      "DOCUMENT_UPLOADED",
      "DOCUMENT_APPROVED",
      "STATUS",
    ])
      expect(events, k).toContain(k);
    expect(
      await denied(
        a.from("visa_events").insert({ application_id: app, event_type: "X", summary: "forged" }),
      ),
    ).toBe(true);
    const audit = (
      await a
        .from("audit_logs")
        .select("action, entity_type, metadata")
        .like("entity_type", "visa_%")
    ).data!;
    expect(audit.length).toBeGreaterThan(8);
    expect(JSON.stringify(audit)).not.toMatch(/P1234567|passport_number/i);
    for (const t of [
      "visa_applications",
      "visa_enquiries",
      "visa_travellers",
      "visa_application_documents",
      "visa_products",
      "visa_events",
      "visa_price_history",
    ])
      expect((await b.from(t).select("id")).data, t).toEqual([]);
    expect(await denied(b.rpc("set_visa_status", { p_id: app, p_status: "NEW" }))).toBe(true);
    expect(
      await denied(b.rpc("review_visa_document", { p_item: items[0].id, p_decision: "APPROVED" })),
    ).toBe(true);
    const dash = await rpc(a, "visa_dashboard");
    expect(dash.byStatus.CLOSED).toBe(1);
    expect((await rpc(b, "visa_dashboard")).byStatus).toEqual({});
  });

  it("prices, quotes and books a visa, then runs supplier, final visa, delivery and messaging", async () => {
    const app2 = await rpc<string>(a, "create_visa_application", {
      p_customer: customer,
      p_product: product,
      p_nationality: "Indian",
    });
    const calc = await rpc(exec, "price_visa_application", { p_app: app2 });
    expect(Number(calc.total)).toBeGreaterThan(0);
    expect(
      await denied(
        exec.rpc("price_visa_application", { p_app: app2, p_discount: 50, p_reason: "friend" }),
      ),
    ).toBe(true); // no visa.discount
    await rpc(a, "price_visa_application", {
      p_app: app2,
      p_discount: 50,
      p_reason: "Repeat client",
    });
    expect(await denied(b.rpc("price_visa_application", { p_app: app2 }))).toBe(true);
    expect(
      await denied(a.from("visa_applications").update({ total_price: 1 }).eq("id", app2)),
    ).toBe(true);

    const quotation = await rpc<string>(a, "create_visa_quotation", { p_app: app2 });
    const items = (await a.from("quotation_items").select("type").eq("quotation_id", quotation))
      .data!;
    expect(items.map((i) => i.type)).toEqual(["VISA"]);
    expect(await denied(a.rpc("price_visa_application", { p_app: app2 }))).toBe(true); // locked
    expect(await denied(b.rpc("create_visa_quotation", { p_app: app2 }))).toBe(true);

    const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    try {
      await db.query("update quotations set status = 'APPROVED' where id = $1", [quotation]);
      const booking = await rpc<string>(a, "convert_quotation_to_booking", {
        p_quotation: quotation,
      });
      expect(
        (await a.from("visa_applications").select("booking_id").eq("id", app2).single()).data,
      ).toEqual({
        booking_id: booking,
      });

      await db.query("update visa_applications set status = 'SUBMITTED' where id = $1", [app2]);
      expect(
        (await a.from("visa_applications").select("expected_completion").eq("id", app2).single())
          .data!.expected_completion,
      ).not.toBeNull();
      await rpc(ops, "record_supplier_submission", {
        p_app: app2,
        p_reference: "SUP-1",
        p_cost: 1200,
      });
      expect((await ops.from("visa_supplier_submissions").select("cost")).data).toHaveLength(1);
      expect((await exec.from("visa_supplier_submissions").select("cost")).data).toEqual([]);
      expect((await b.from("visa_supplier_submissions").select("cost")).data).toEqual([]);

      await db.query("update visa_applications set status = 'APPROVED' where id = $1", [app2]);
      const t = (await a.from("visa_travellers").select("id").eq("application_id", app2).single())
        .data!;
      const file = await ops
        .from("documents")
        .insert({
          category: "VISA",
          name: "final.pdf",
          storage_path: `${orgA}/${uid()}.pdf`,
          mime_type: "application/pdf",
          size_bytes: 10,
          sha256: "e".repeat(64),
          visa_application_id: app2,
        })
        .select("id")
        .single();
      await rpc(ops, "record_visa_result", {
        p_app: app2,
        p_traveller: t.id,
        p_document: file.data!.id,
        p_visa_number: "TH1234567",
      });
      expect((await b.from("visa_results").select("id")).data).toEqual([]);
      await db.query("update visa_applications set status = 'VISA_RECEIVED' where id = $1", [app2]);
      await rpc(ops, "record_visa_delivery", { p_app: app2, p_method: "EMAIL" });
      expect(
        (await a.from("visa_applications").select("status").eq("id", app2).single()).data,
      ).toEqual({
        status: "DELIVERED",
      });
    } finally {
      await db.end();
    }

    const msg = await rpc<string>(exec, "queue_visa_communication", {
      p_channel: "EMAIL",
      p_template: "VISA_STATUS_UPDATE",
      p_app: app2,
      p_vars: { customer_name: "Raj" },
    });
    expect(msg).toBeTruthy();
    expect(
      await denied(
        b.rpc("queue_visa_communication", {
          p_channel: "EMAIL",
          p_template: "GENERAL",
          p_app: app2,
        }),
      ),
    ).toBe(true);
    const queue = await rpc(ops, "visa_work_queue", { p_mine: false });
    expect(queue.counts).toHaveProperty("overdue");
    expect(
      Object.values((await rpc(b, "visa_work_queue", { p_mine: false })).counts).every(
        (n) => n === 0,
      ),
    ).toBe(true);
  });
});
