import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * LIVE tests against a real Supabase project (the one in .env.local). They create throwaway users and agencies named
 * "LIVE-TEST ...", with @example.invalid emails (so no email is ever sent), and delete everything afterwards.
 *
 *   RUN_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/live
 *
 * Skipped unless RUN_LIVE=1, so `npm test` never touches a real project.
 */
const LIVE = process.env.RUN_LIVE === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DB = process.env.DATABASE_URL!;

const uid = () => crypto.randomUUID();
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const email = (n: string) => `live-${n}-${run}@example.invalid`;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
async function rpc<T = any>(
  c: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}
async function denied(p: PromiseLike<{ error: unknown; data?: unknown }>) {
  const r = await p;
  return Boolean(r.error);
}

describe.skipIf(!LIVE)(
  "live Supabase: auth, RLS, RPCs, storage (throwaway data, cleaned up)",
  () => {
    let admin: SupabaseClient;
    let anon: SupabaseClient;
    let a: SupabaseClient, b: SupabaseClient, c: SupabaseClient;
    const userIds: string[] = [];
    const orgIds: string[] = [];
    let orgA = "",
      orgB = "";
    let customerA = "",
      quoteA = "",
      bookingA = "";
    let paymentA = "";

    async function makeUser(name: string) {
      const { data, error } = await admin.auth.admin.createUser({
        email: email(name),
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: `LIVE-TEST ${name}` },
      });
      if (error) throw new Error(`createUser ${name}: ${error.message}`);
      userIds.push(data.user.id);
      const client = createClient(URL_, PUB, opts);
      const { error: e2 } = await client.auth.signInWithPassword({
        email: email(name),
        password: PASSWORD,
      });
      if (e2) throw new Error(`sign in ${name}: ${e2.message}`);
      return { client, id: data.user.id };
    }

    beforeAll(async () => {
      admin = createClient(URL_, SERVICE, opts);
      anon = createClient(URL_, PUB, opts);
      a = (await makeUser("a")).client;
      b = (await makeUser("b")).client;
    }, 90_000);

    afterAll(async () => {
      // Remove everything this run (and any earlier failed run) created. Files go through the Storage API, because
      // Supabase forbids deleting storage rows with SQL.
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
        for (const id of [...new Set([...orgs, ...orgIds])]) {
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
          (/^live-[a-z]+-[0-9a-f]{8}@example.invalid$/.test(u.email ?? "") &&
            Date.now() - Date.parse(u.created_at) > 30 * 60 * 1000)
        )
          await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }, 90_000);

    it("anonymous visitors can read nothing and call nothing", async () => {
      for (const t of [
        "organizations",
        "leads",
        "customers",
        "bookings",
        "payments",
        "subscriptions",
        "documents",
        "audit_logs",
        "portal_links",
      ]) {
        const r = await anon.from(t).select("*").limit(1);
        expect(r.error ? [] : r.data, t).toEqual([]);
      }
      expect(await denied(anon.rpc("create_organization", { org_name: "LIVE-TEST anon" }))).toBe(
        true,
      );
      expect(await denied(anon.rpc("run_automation"))).toBe(true);
      expect(await denied(anon.rpc("portal_view", { p_hash: sha("x") }))).toBe(true);
      expect(
        await denied(
          anon.rpc("apply_razorpay_event", {
            p_org: uid(),
            p_event_id: "e",
            p_event_type: "x",
            p_order_id: null,
            p_payment_id: null,
            p_amount_paise: 1,
            p_currency: "INR",
          }),
        ),
      ).toBe(true);
    });

    it("a new user creates an agency and becomes its owner on a Pro trial", async () => {
      orgA = await rpc<string>(a, "create_organization", { org_name: "LIVE-TEST Agency A" });
      orgIds.push(orgA);
      const plan = await rpc(a, "org_limits");
      expect(plan).toMatchObject({ planKey: "PRO", status: "TRIALING", inForce: true });
      const me = await a.from("organization_members").select("role").single();
      expect(me.data?.role).toBe("OWNER");
      expect(await denied(a.rpc("create_organization", { org_name: "LIVE-TEST second" }))).toBe(
        true,
      ); // one org per user
      const sources = await a.from("lead_sources").select("name");
      expect(sources.data?.length).toBeGreaterThanOrEqual(5);
    });

    it("runs the sales-to-booking flow: customer, lead, quotation, approval, conversion", async () => {
      const cust = await a
        .from("customers")
        .insert({
          name: "LIVE-TEST Asha",
          email: "asha@example.invalid",
          whatsapp: "+91 98765 43210",
        })
        .select("id")
        .single();
      expect(cust.error).toBeNull();
      customerA = cust.data!.id;
      const lead = await a
        .from("leads")
        .insert({
          title: "LIVE-TEST Dubai",
          destination: "Dubai",
          customer_id: customerA,
          status: "NEW",
        })
        .select("id")
        .single();
      expect(lead.error).toBeNull();

      quoteA = await rpc<string>(a, "create_quotation", {
        p_customer: customerA,
        p_title: "LIVE-TEST Dubai trip",
      });
      const doc = await rpc(a, "quotation_document", { p_id: quoteA, p_private: false });
      await rpc(a, "save_quotation", {
        p_id: quoteA,
        p_expected_version: doc.version,
        p_data: {
          title: "LIVE-TEST Dubai trip",
          itineraryId: null,
          options: [
            {
              id: doc.options[0].id,
              name: "A",
              taxRate: 5,
              items: [
                {
                  id: uid(),
                  type: "HOTEL",
                  description: "Atlantis 4N",
                  quantity: 1,
                  unitPrice: 80000,
                },
                {
                  id: uid(),
                  type: "TRANSPORT",
                  description: "Transfers",
                  quantity: 2,
                  unitPrice: 1500,
                },
              ],
            },
          ],
        },
      });
      await rpc(a, "set_quotation_status", { p_id: quoteA, p_status: "SENT" });
      await rpc(a, "set_quotation_status", { p_id: quoteA, p_status: "APPROVED" });
      bookingA = await rpc<string>(a, "convert_quotation_to_booking", { p_quotation: quoteA });
      const bk = await a
        .from("bookings")
        .select("booking_number, status, total_amount, balance_amount")
        .eq("id", bookingA)
        .single();
      expect(bk.data).toMatchObject({ status: "PAYMENT_PENDING" });
      expect(Number(bk.data!.total_amount)).toBe(87150);
      expect(bk.data!.booking_number).toMatch(/^B-\d{4}-0001$/);
      expect(await denied(a.rpc("convert_quotation_to_booking", { p_quotation: quoteA }))).toBe(
        true,
      ); // only once
      const tasks = await a.from("tasks").select("id").eq("related_id", bookingA);
      expect(tasks.data).toHaveLength(3);
    });

    it("records payments, enforces the balance, and issues an invoice and receipt", async () => {
      await a.from("payment_schedules").insert([
        {
          booking_id: bookingA,
          label: "Deposit",
          due_date: new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10),
          amount: 20000,
        },
        {
          booking_id: bookingA,
          label: "Final",
          due_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
          amount: 67150,
        },
      ]);
      paymentA = await rpc<string>(a, "record_payment", {
        p_booking: bookingA,
        p_amount: 20000,
        p_method: "UPI",
        p_reference: `LIVE-${run}`,
      });
      const p = await a
        .from("payments")
        .select("status, receipt_number")
        .eq("id", paymentA)
        .single();
      expect(p.data).toMatchObject({ status: "CAPTURED" });
      expect(p.data!.receipt_number).toMatch(/^RC-\d{4}-0001$/);
      expect(
        await denied(
          a.rpc("record_payment", { p_booking: bookingA, p_amount: 999999, p_method: "CASH" }),
        ),
      ).toBe(true);
      expect(
        await denied(
          a
            .from("payments")
            .insert({ booking_id: bookingA, amount: 1, currency: "INR", method: "CASH" }),
        ),
      ).toBe(true);
      expect(
        await denied(a.from("bookings").update({ paid_amount: 87150 }).eq("id", bookingA).select()),
      ).toBe(true);
      const bk = await a
        .from("bookings")
        .select("paid_amount, balance_amount")
        .eq("id", bookingA)
        .single();
      expect(Number(bk.data!.paid_amount)).toBe(20000);
      expect(Number(bk.data!.balance_amount)).toBe(67150);
      const sched = await a
        .from("payment_schedule_status")
        .select("label, schedule_status")
        .order("due_date");
      expect(sched.data?.map((s) => s.schedule_status)).toEqual(["PAID", "UPCOMING"]);
      const inv = await rpc<string>(a, "issue_invoice", { p_booking: bookingA });
      const row = await a
        .from("invoices")
        .select("invoice_number, total_amount")
        .eq("id", inv)
        .single();
      expect(row.data!.invoice_number).toMatch(/^INV-/);
    });

    it("builds reports from the live data, and writes an audit trail", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const r = await rpc(a, "report_summary", { p_from: from, p_to: today });
      expect(r.pipeline.leadsCreated).toBe(1);
      expect(r.bookings.value).toEqual([{ currency: "INR", count: 1, value: 87150 }]);
      expect(r.collections.collected).toEqual([{ currency: "INR", amount: 20000 }]);
      const audit = await a
        .from("audit_logs")
        .select("action, entity_type")
        .order("created_at", { ascending: false });
      expect(audit.data!.length).toBeGreaterThanOrEqual(3);
      expect(audit.data!.some((x) => x.action === "PAYMENT")).toBe(true);
      expect(await denied(a.from("audit_logs").delete().neq("id", uid()).select())).toBe(true);
    });

    it("a second agency sees nothing of the first, and can't act on its records", async () => {
      orgB = await rpc<string>(b, "create_organization", { org_name: "LIVE-TEST Agency B" });
      orgIds.push(orgB);
      for (const t of [
        "customers",
        "leads",
        "quotations",
        "bookings",
        "payments",
        "invoices",
        "tasks",
        "audit_logs",
        "payment_schedules",
      ]) {
        const r = await b.from(t).select("id");
        expect(r.data ?? [], t).toEqual([]);
      }
      expect(
        await denied(
          b.rpc("record_payment", { p_booking: bookingA, p_amount: 1, p_method: "CASH" }),
        ),
      ).toBe(true);
      expect(await denied(b.rpc("issue_invoice", { p_booking: bookingA }))).toBe(true);
      expect(await denied(b.rpc("convert_quotation_to_booking", { p_quotation: quoteA }))).toBe(
        true,
      );
      expect(
        await denied(
          b.rpc("create_portal_link", { p_booking: bookingA, p_hash: sha("b"), p_days: 7 }),
        ),
      ).toBe(true);
      // forging the organization on insert is refused
      expect(await denied(b.from("customers").insert({ name: "x", organization_id: orgA }))).toBe(
        true,
      );
      // cross-tenant foreign key (a lead pointing at A's customer)
      expect(await denied(b.from("leads").insert({ title: "cross", customer_id: customerA }))).toBe(
        true,
      );
      const rb = await rpc(b, "report_summary", { p_from: "2020-01-01", p_to: "2021-01-01" });
      expect(rb.bookings.created).toBe(0);
      const stillMine = await a.from("customers").select("id");
      expect(stillMine.data).toHaveLength(1); // B couldn't touch A's data
    });

    it("stores documents privately and serves them only through short-lived signed links", async () => {
      const path = `${orgA}/${uid()}.pdf`;
      const bytes = new Blob(["%PDF-1.4 live test"], { type: "application/pdf" });
      const up = await admin.storage
        .from("documents")
        .upload(path, bytes, { contentType: "application/pdf" });
      expect(up.error).toBeNull();
      const meta = await a
        .from("documents")
        .insert({
          category: "OTHER",
          name: "live.pdf",
          storage_path: path,
          mime_type: "application/pdf",
          size_bytes: 20,
          sha256: "a".repeat(64),
          booking_id: bookingA,
        })
        .select("id")
        .single();
      expect(meta.error).toBeNull();

      const signed = await admin.storage.from("documents").createSignedUrl(path, 60);
      expect((await fetch(signed.data!.signedUrl)).status).toBe(200);
      expect(
        (await fetch(`${URL_}/storage/v1/object/public/documents/${path}`)).status,
      ).toBeGreaterThanOrEqual(400);
      // browsers (anon or signed-in) can't download, list or upload directly
      expect(await denied(anon.storage.from("documents").download(path))).toBe(true);
      expect(await denied(a.storage.from("documents").download(path))).toBe(true);
      const list = await a.storage.from("documents").list(orgA);
      expect(list.data ?? []).toEqual([]);
      expect(await denied(a.storage.from("documents").upload(`${orgA}/${uid()}.pdf`, bytes))).toBe(
        true,
      );
      expect(await b.from("documents").select("id")).toMatchObject({ data: [] });
    });

    it("customer portal: hashed link, narrow data, service-only access, revocation", async () => {
      const token = randomBytes(32).toString("base64url");
      const linkId = await rpc<string>(a, "create_portal_link", {
        p_booking: bookingA,
        p_hash: sha(token),
        p_days: 7,
      });
      expect(await denied(a.rpc("portal_view", { p_hash: sha(token) }))).toBe(true); // staff can't call the customer-side function
      expect(await denied(a.from("portal_links").select("token_hash"))).toBe(true);
      const view = await rpc(admin, "portal_view", { p_hash: sha(token) });
      expect(view.booking).toMatchObject({ status: "PAYMENT_PENDING", currency: "INR" });
      const text = JSON.stringify(view).toLowerCase();
      for (const secret of [
        "supplier",
        "passport",
        "unit_price",
        "asha@example.invalid",
        "cost",
        "profit",
      ])
        expect(text).not.toContain(secret);
      expect(await rpc(admin, "portal_view", { p_hash: sha("wrong") })).toBeNull();
      await rpc(a, "revoke_portal_link", { p_id: linkId });
      expect(await rpc(admin, "portal_view", { p_hash: sha(token) })).toBeNull();
    });

    it("webhooks settle only the addressed organization (service role only)", async () => {
      const p = await rpc<{ payment_id: string }[]>(a, "prepare_online_payment", {
        p_booking: bookingA,
        p_amount: 1000,
      });
      const order = `order_live${run}`;
      await rpc(a, "attach_razorpay_order", { p_payment: p[0].payment_id, p_order: order });
      const fire = (org: string, evt: string) =>
        rpc<string>(admin, "apply_razorpay_event", {
          p_org: org,
          p_event_id: `${evt}-${run}`,
          p_event_type: "payment.captured",
          p_order_id: order,
          p_payment_id: `pay_live_${run}`,
          p_amount_paise: 100000,
          p_currency: "INR",
        });
      expect(await fire(orgB, "evtb")).toBe("unknown_order");
      expect(await fire(orgA, "evta")).toBe("captured");
      expect(await fire(orgA, "evta")).toBe("duplicate");
      const bk = await a.from("bookings").select("paid_amount").eq("id", bookingA).single();
      expect(Number(bk.data!.paid_amount)).toBe(21000);
      expect(
        await denied(
          a.rpc("apply_razorpay_event", {
            p_org: orgA,
            p_event_id: "z",
            p_event_type: "payment.captured",
            p_order_id: order,
            p_payment_id: "p",
            p_amount_paise: 1,
            p_currency: "INR",
          }),
        ),
      ).toBe(true);
    });

    it("team invitation: only the invited, verified email can join, once", async () => {
      const invited = email("c");
      await rpc(a, "create_invite", { p_email: invited, p_role: "SALES_EXECUTIVE" });
      expect(
        await denied(a.rpc("create_invite", { p_email: "x@example.invalid", p_role: "OWNER" })),
      ).toBe(true);
      const cUser = await makeUser("c");
      c = cUser.client;
      const mine = await rpc<{ org_name: string; role: string }[]>(c, "my_invite");
      expect(mine[0]).toMatchObject({ org_name: "LIVE-TEST Agency A", role: "SALES_EXECUTIVE" });
      expect(await rpc<string>(c, "accept_invite")).toBe(orgA);
      const customers = await c.from("customers").select("id");
      expect(customers.data).toHaveLength(1); // now sees the agency's data, as an executive
      expect(await denied(c.rpc("accept_invite"))).toBe(true);
      expect(
        await denied(c.rpc("create_invite", { p_email: "y@example.invalid", p_role: "VIEWER" })),
      ).toBe(true); // executives can't invite
      expect(
        await denied(
          c.rpc("record_payment", { p_booking: bookingA, p_amount: 1, p_method: "CASH" }),
        ),
      ).toBe(true); // no payments.create
    });

    it("plan limits and billing state are enforced by the database", async () => {
      expect(
        await denied(
          a
            .from("subscriptions")
            .update({ status: "ACTIVE", plan_key: "PRO" })
            .eq("organization_id", orgA)
            .select(),
        ),
      ).toBe(true);
      expect(
        await denied(a.from("plans").update({ price_paise: 0 }).eq("key", "PRO").select()),
      ).toBe(true);
      expect(await denied(a.rpc("prepare_subscription", { p_plan: "STARTER" }))).toBe(true); // no Razorpay plan id yet
      expect(await denied(c.rpc("prepare_subscription", { p_plan: "STARTER" }))).toBe(true); // not an owner
      const u = await rpc(a, "org_usage");
      expect(u).toMatchObject({ seats: 2, bookingsThisMonth: 1 });
    });
  },
);
