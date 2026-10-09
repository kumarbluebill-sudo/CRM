import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, fails, setupTenant } from "../helpers/db";

const uid = () => crypto.randomUUID();
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe("notifications, staff profiles and job orders (local Postgres)", () => {
  let db: PGlite;
  let a: { userId: string; orgId: string };
  let b: { userId: string; orgId: string };
  let mgr: string, exec: string, exec2: string, ops: string, acc: string, viewer: string;
  let customer = "";

  /** Superuser statements must not inherit the last API user (auth.uid() is a session setting). */
  const root = async <T = any>(sql: string, params: unknown[] = []) => {
    await db.exec("select set_config('request.jwt.claim.sub', '', false)");
    return db.query<T>(sql, params);
  };
  const member = async (org: string, email: string, role: string) => {
    const id = await createUser(db, email);
    await root(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)",
      [org, id, role],
    );
    return id;
  };
  const q1 = <T = any>(user: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (d) => (await d.query<T>(sql, params)).rows);
  const one = async (user: string, sql: string, params: unknown[] = []) =>
    (await q1<any>(user, sql, params))[0];
  const notes = (user: string, type?: string) =>
    q1<any>(
      user,
      `select * from notifications ${type ? "where type = $1" : ""} order by created_at`,
      type ? [type] : [],
    );
  const job = async (user: string, p: Record<string, unknown>) =>
    (
      await one(user, "select public.create_job_order($1::jsonb) as id", [
        JSON.stringify({ title: "Collect passports", ...p }),
      ])
    ).id as string;
  const status = async (id: string) =>
    (await one(a.userId, "select status from job_orders where id = $1", [id])).status;

  beforeAll(async () => {
    db = await createTestDb();
    a = await setupTenant(db, "a");
    b = await setupTenant(db, "b");
    mgr = await member(a.orgId, "mgr@a.test", "SALES_MANAGER");
    exec = await member(a.orgId, "exec@a.test", "SALES_EXECUTIVE");
    exec2 = await member(a.orgId, "exec2@a.test", "SALES_EXECUTIVE");
    ops = await member(a.orgId, "ops@a.test", "OPERATIONS");
    acc = await member(a.orgId, "acc@a.test", "ACCOUNTANT");
    viewer = await member(a.orgId, "view@a.test", "VIEWER");
    customer = (
      await one(
        a.userId,
        "insert into customers (name, email) values ('Asha Rao', 'asha@example.test') returning id",
      )
    ).id;
  });
  afterAll(async () => db.close());

  describe("notifications", () => {
    it("tells an assignee about a new enquiry, but not the person who made the assignment", async () => {
      await q1(mgr, "insert into leads (title, assigned_user_id) values ('Goa weekend', $1)", [
        exec,
      ]);
      const n = await notes(exec, "LEAD_ASSIGNED");
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({
        title: "New enquiry assigned",
        entity_type: "LEAD",
        read_at: null,
      });
      expect(await notes(mgr, "LEAD_ASSIGNED")).toHaveLength(0);
      await q1(exec, "insert into leads (title, assigned_user_id) values ('Self assigned', $1)", [
        exec,
      ]);
      expect(await notes(exec, "LEAD_ASSIGNED")).toHaveLength(1); // no self-notification
    });

    it("never repeats the same event", async () => {
      const lead = (await one(a.userId, "select id from leads where title = 'Goa weekend'")).id;
      await q1(mgr, "update leads set assigned_user_id = $2 where id = $1", [lead, exec2]);
      await q1(mgr, "update leads set assigned_user_id = $2 where id = $1", [lead, exec]);
      await q1(mgr, "update leads set assigned_user_id = $2 where id = $1", [lead, exec2]);
      expect(await notes(exec2, "LEAD_ASSIGNED")).toHaveLength(1);
      expect(await notes(exec, "LEAD_ASSIGNED")).toHaveLength(1);
    });

    it("keeps each person's notifications to themselves, with no direct writes", async () => {
      expect(await notes(viewer)).toHaveLength(0);
      expect(await notes(b.userId)).toHaveLength(0);
      const mine = (await notes(exec))[0];
      expect(await q1(exec2, "select * from notifications where id = $1", [mine.id])).toHaveLength(
        0,
      );
      expect(
        await fails(() =>
          q1(exec, "update notifications set read_at = null where id = $1", [mine.id]),
        ),
      ).toBe(true);
      expect(
        await fails(() => q1(exec, "delete from notifications where id = $1", [mine.id])),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(
            exec,
            "insert into notifications (user_id, type, title) values ($1, 'SECURITY', 'forged')",
            [exec],
          ),
        ),
      ).toBe(true);
      await q1(exec2, "select public.mark_notification_read($1)", [mine.id]); // someone else's: no effect
      expect((await notes(exec))[0].read_at).toBeNull();
      await q1(exec, "select public.mark_notification_read($1)", [mine.id]);
      expect((await notes(exec))[0].read_at).not.toBeNull();
    });

    it("marks all read, and counts only the caller's unread", async () => {
      const n = (await one(exec, "select public.mark_all_notifications_read() as n")).n;
      expect(n).toBeGreaterThanOrEqual(0);
      expect(await q1(exec, "select 1 from notifications where read_at is null")).toHaveLength(0);
      expect(await q1(exec2, "select 1 from notifications where read_at is null")).not.toHaveLength(
        0,
      ); // theirs untouched
    });

    it("notifies the right people about bookings, payments and invoices, without personal details", async () => {
      const qid = (
        await one(a.userId, "select public.create_quotation($1, 'Dubai stay', null, null) as id", [
          customer,
        ])
      ).id;
      const d = (await one(a.userId, "select public.quotation_document($1, false) as d", [qid])).d;
      await q1(a.userId, "select public.save_quotation($1, $2::jsonb, $3)", [
        qid,
        JSON.stringify({
          title: "Dubai stay",
          itineraryId: null,
          options: [
            {
              id: d.options[0].id,
              name: "A",
              taxRate: 0,
              items: [
                { id: uid(), type: "HOTEL", description: "Hotel", quantity: 1, unitPrice: 40000 },
              ],
            },
          ],
        }),
        d.version,
      ]);
      await q1(a.userId, "select public.set_quotation_status($1, 'SENT')", [qid]);
      await q1(a.userId, "select public.set_quotation_status($1, 'APPROVED')", [qid]);
      const bk = (await one(mgr, "select public.convert_quotation_to_booking($1) as id", [qid])).id;
      expect(await notes(ops, "BOOKING_CREATED")).toHaveLength(1);
      expect(await notes(a.userId, "BOOKING_CREATED")).toHaveLength(1);
      expect(await notes(mgr, "BOOKING_CREATED")).toHaveLength(0); // the actor
      expect(await notes(exec, "BOOKING_CREATED")).toHaveLength(0); // no bookings.update
      expect(await notes(viewer, "BOOKING_CREATED")).toHaveLength(0);

      await q1(acc, "select public.record_payment($1, 10000, 'UPI', 'UTR-N1')", [bk]);
      const pay = await notes(a.userId, "PAYMENT_RECEIVED");
      expect(pay).toHaveLength(1);
      expect(pay[0].entity_type).toBe("BOOKING");
      expect(JSON.stringify(pay)).not.toMatch(/Asha|asha@/); // no customer details
      expect(await notes(acc, "PAYMENT_RECEIVED")).toHaveLength(0);

      const inv = (await one(acc, "select public.issue_invoice($1) as id", [bk])).id;
      expect((await notes(a.userId, "INVOICE_ISSUED")).some((x: any) => x.entity_id === inv)).toBe(
        true,
      );
    });

    it("tells owners about team changes, and respects an in-app opt-out", async () => {
      const before = (await notes(a.userId, "SECURITY")).length;
      await member(a.orgId, "new@a.test", "VIEWER");
      expect((await notes(a.userId, "SECURITY")).length).toBe(before + 1);
      await q1(a.userId, "select public.set_notification_pref('SECURITY', false, false)");
      await member(a.orgId, "new2@a.test", "VIEWER");
      expect((await notes(a.userId, "SECURITY")).length).toBe(before + 1); // opted out
      await q1(a.userId, "select public.set_notification_pref('SECURITY', true, false)");
      expect(
        await fails(() => q1(a.userId, "select public.set_notification_pref('NOPE', true, true)")),
      ).toBe(true);
      expect(await q1(exec, "select * from notification_preferences")).toHaveLength(0);
      expect(await q1(a.userId, "select * from notification_preferences")).toHaveLength(1);
    });

    it("never lets a failed notification undo the business action, and logs the failure", async () => {
      const failing = uid(); // not a member: the insert violates a foreign key
      await root("select public.notify_user($1, $2, 'SECURITY', 'x', null, null, null, 'k1')", [
        a.orgId,
        failing,
      ]);
      const logged = await q1(
        a.userId,
        "select * from notification_deliveries where status = 'FAILED'",
      );
      expect(logged.length).toBeGreaterThan(0);
      expect(await q1(exec, "select * from notification_deliveries")).toHaveLength(0); // only settings managers read it
    });

    it("sweeps departures, overdue payments, jobs and visa documents once, however often it runs", async () => {
      const bk = (await one(a.userId, "select id from bookings limit 1")).id;
      await root(
        "update bookings set travel_start = current_date + 2, status = 'CONFIRMED' where id = $1",
        [bk],
      );
      await root(
        "insert into payment_schedules (organization_id, booking_id, label, due_date, amount) values ($1, $2, 'Old', current_date - 5, 30000)",
        [a.orgId, bk],
      );
      const j = await job(mgr, { assignedTo: exec, deadline: day(-1) });
      const first = (await root("select public.run_notification_sweeps() as n")).rows[0] as {
        n: number;
      };
      expect(Number(first.n)).toBeGreaterThan(0);
      expect((await notes(a.userId, "DEPARTURE_SOON")).length).toBe(1);
      expect((await notes(a.userId, "PAYMENT_OVERDUE")).length).toBe(1);
      expect((await notes(exec, "JOB_OVERDUE")).some((x: any) => x.entity_id === j)).toBe(true);
      expect((await notes(mgr, "JOB_OVERDUE")).some((x: any) => x.entity_id === j)).toBe(true);
      const second = (await root("select public.run_notification_sweeps() as n")).rows[0] as {
        n: number;
      };
      expect(Number(second.n)).toBe(0);
      expect(await fails(() => q1(a.userId, "select public.run_notification_sweeps()"))).toBe(true); // service role only
      expect(
        await fails(() => q1(a.userId, "select * from public.pending_notification_emails()")),
      ).toBe(true);
    });
  });

  describe("staff profiles", () => {
    it("lets only user managers edit them, and keeps codes unique", async () => {
      const p = (user: string, who: string, data: Record<string, unknown>) =>
        q1(user, "select public.save_staff_profile($1, $2::jsonb)", [who, JSON.stringify(data)]);
      await p(a.userId, exec, {
        employeeCode: "E-101",
        designation: "Travel Consultant",
        department: "Sales",
        phone: "+91 90000 11111",
        reportingManagerId: mgr,
      });
      expect(await fails(() => p(mgr, exec, { designation: "Boss" }))).toBe(true); // no users.manage
      expect(await fails(() => p(exec, exec, { designation: "Boss" }))).toBe(true);
      expect(await fails(() => p(a.userId, exec2, { employeeCode: "e-101" }))).toBe(true); // case-insensitive duplicate
      expect(await fails(() => p(a.userId, exec, { reportingManagerId: exec }))).toBe(true); // own manager
      expect(await fails(() => p(a.userId, exec, { reportingManagerId: b.userId }))).toBe(true); // other agency
      expect(await fails(() => p(a.userId, b.userId, { designation: "x" }))).toBe(true); // not a member of this agency
      expect(await fails(() => p(a.userId, exec, { phone: "call me" }))).toBe(true);
    });

    it("hides phone numbers from the directory and from other staff", async () => {
      expect(await q1(exec2, "select * from staff_profiles")).toHaveLength(0);
      expect(await q1(exec, "select phone from staff_profiles")).toHaveLength(1); // their own row
      expect(
        (await q1(exec2, "select * from staff_directory()")).every(
          (r: any) => r.phone === undefined,
        ),
      ).toBe(true);
      const dir = await q1(exec2, "select * from staff_directory()");
      const row = dir.find((r: any) => r.user_id === exec);
      expect(row).toMatchObject({
        designation: "Travel Consultant",
        department: "Sales",
        employee_code: "E-101",
        active: true,
      });
      expect(row.open_jobs).toBeNull(); // workload only for people who manage work
      expect(
        (await q1(mgr, "select * from staff_directory()")).find((r: any) => r.user_id === exec)
          .open_jobs,
      ).not.toBeNull();
      expect(await fails(() => q1(viewer, "select * from staff_directory()"))).toBe(true);
      expect(
        (await q1(b.userId, "select * from staff_directory()")).some(
          (r: any) => r.user_id === exec,
        ),
      ).toBe(false);
    });
  });

  describe("job orders", () => {
    let j = "";
    it("creates numbered jobs, tells the assignee, and enforces who can assign whom", async () => {
      j = await job(mgr, {
        assignedTo: exec,
        priority: "HIGH",
        deadline: day(5),
        relatedType: "BOOKING",
        relatedId: (await one(a.userId, "select id from bookings limit 1")).id,
        customerId: customer,
      });
      const row = await one(mgr, "select * from job_orders where id = $1", [j]);
      expect(row).toMatchObject({
        status: "ASSIGNED",
        priority: "HIGH",
        assigning_manager_id: mgr,
      });
      expect(row.job_number).toMatch(/^JO-\d{4}-\d{4}$/);
      expect((await notes(exec, "JOB_ASSIGNED")).some((n: any) => n.entity_id === j)).toBe(true);
      expect(await fails(() => job(exec, { assignedTo: exec2 }))).toBe(true); // no jobs.assign
      await job(exec, { assignedTo: exec }); // self-assigned
      expect(await fails(() => job(viewer, {}))).toBe(true);
      expect(await fails(() => job(ops, { assignedTo: a.userId }))).toBe(true); // owners are assigned work by job managers only
      await job(a.userId, { assignedTo: mgr });
      expect(await fails(() => job(mgr, { assignedTo: b.userId }))).toBe(true); // another agency
      expect(await fails(() => job(mgr, { title: "ab" }))).toBe(true);
      expect(await fails(() => job(mgr, { priority: "SUPER" }))).toBe(true);
      expect(await fails(() => job(mgr, { relatedType: "BOOKING", relatedId: uid() }))).toBe(true);
      expect(await fails(() => job(mgr, { relatedType: "BOOKING" }))).toBe(true);
      expect(await fails(() => job(mgr, { deadline: day(1), startDate: day(5) }))).toBe(true);
      expect(await fails(() => job(mgr, { customerId: uid() }))).toBe(true);
    });

    it("shows a job only to the people involved and to managers", async () => {
      expect(await q1(exec, "select id from job_orders where id = $1", [j])).toHaveLength(1);
      expect(await q1(mgr, "select id from job_orders where id = $1", [j])).toHaveLength(1);
      expect(await q1(a.userId, "select id from job_orders where id = $1", [j])).toHaveLength(1);
      expect(await q1(ops, "select id from job_orders where id = $1", [j])).toHaveLength(1); // jobs.assign
      expect(await q1(exec2, "select id from job_orders where id = $1", [j])).toHaveLength(0);
      expect(await q1(acc, "select id from job_orders where id = $1", [j])).toHaveLength(0);
      expect(await q1(viewer, "select id from job_orders")).toHaveLength(0);
      expect(await q1(b.userId, "select id from job_orders")).toHaveLength(0);
      expect(
        await q1(exec2, "select * from job_order_events where job_order_id = $1", [j]),
      ).toHaveLength(0);
      for (const sql of [
        "insert into job_orders (title, job_number) values ('x','x')",
        `update job_orders set title = 'hacked' where id = '${j}'`,
        `delete from job_orders where id = '${j}'`,
      ])
        expect(await fails(() => q1(mgr, sql))).toBe(true);
      expect(
        await fails(() =>
          q1(mgr, "insert into job_order_events (job_order_id, kind) values ($1, 'COMMENT')", [j]),
        ),
      ).toBe(true);
    });

    it("lets the assignee accept and work the job through allowed statuses only", async () => {
      expect(await fails(() => q1(exec2, "select public.accept_job_order($1)", [j]))).toBe(true);
      expect(await fails(() => q1(mgr, "select public.accept_job_order($1)", [j]))).toBe(true); // only the assignee accepts
      await q1(exec, "select public.accept_job_order($1)", [j]);
      expect(await status(j)).toBe("ACCEPTED");
      expect(await fails(() => q1(exec, "select public.accept_job_order($1)", [j]))).toBe(true);
      await q1(exec, "select public.set_job_status($1, 'IN_PROGRESS')", [j]);
      await q1(exec, "select public.set_job_status($1, 'WAITING_INFO', 'need passport scans')", [
        j,
      ]);
      await q1(exec, "select public.set_job_status($1, 'IN_PROGRESS')", [j]);
      expect(await fails(() => q1(exec, "select public.set_job_status($1, 'NEW')", [j]))).toBe(
        true,
      );
      expect(
        await fails(() => q1(exec, "select public.set_job_status($1, 'COMPLETED')", [j])),
      ).toBe(true); // notes required
      expect(
        await fails(() => q1(exec, "select public.set_job_status($1, 'CANCELLED', 'nope')", [j])),
      ).toBe(true); // assignee cannot cancel
      expect(await fails(() => q1(exec2, "select public.set_job_status($1, 'ON_HOLD')", [j]))).toBe(
        true,
      );
      expect(
        await fails(() => q1(viewer, "select public.set_job_status($1, 'ON_HOLD')", [j])),
      ).toBe(true);
    });

    it("takes comments from involved people only, and records history append-only", async () => {
      await q1(exec, "select public.add_job_comment($1, 'Called the customer')", [j]);
      await q1(mgr, "select public.add_job_comment($1, 'Thanks')", [j]);
      expect(await fails(() => q1(exec2, "select public.add_job_comment($1, 'hi')", [j]))).toBe(
        true,
      );
      expect(await fails(() => q1(exec, "select public.add_job_comment($1, '')", [j]))).toBe(true);
      const ev = await q1(
        exec,
        "select kind, from_status, to_status from job_order_events where job_order_id = $1 order by created_at",
        [j],
      );
      expect(ev.map((e: any) => e.kind)).toEqual(
        expect.arrayContaining(["CREATED", "ASSIGNED", "STATUS", "COMMENT"]),
      );
      expect(await fails(() => q1(exec, "update job_order_events set note = 'x'"))).toBe(true);
    });

    it("completes with notes, tells the assigning manager, and reopens only for managers", async () => {
      await q1(exec, "select public.set_job_status($1, 'COMPLETED', 'All passports collected')", [
        j,
      ]);
      const row = await one(
        mgr,
        "select status, completion_notes, completed_at from job_orders where id = $1",
        [j],
      );
      expect(row).toMatchObject({
        status: "COMPLETED",
        completion_notes: "All passports collected",
      });
      expect(row.completed_at).not.toBeNull();
      expect((await notes(mgr, "JOB_COMPLETED")).some((n: any) => n.entity_id === j)).toBe(true);
      expect(
        await fails(() => q1(exec, "select public.set_job_status($1, 'IN_PROGRESS')", [j])),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(ops, "select public.reassign_job_order($1, $2, 'finished')", [j, exec2]),
        ),
      ).toBe(true);
      await q1(mgr, "select public.set_job_status($1, 'IN_PROGRESS')", [j]);
      expect(
        (await one(mgr, "select completed_at from job_orders where id = $1", [j])).completed_at,
      ).toBeNull();
    });

    it("reassigns with a reason, notifies both people, and refuses unauthorised or invalid moves", async () => {
      expect(
        await fails(() => q1(exec, "select public.reassign_job_order($1, $2, 'swap')", [j, exec2])),
      ).toBe(true); // no jobs.assign
      expect(
        await fails(() => q1(ops, "select public.reassign_job_order($1, $2, '')", [j, exec2])),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(ops, "select public.reassign_job_order($1, $2, 'cover leave')", [j, b.userId]),
        ),
      ).toBe(true);
      expect(
        await fails(() =>
          q1(ops, "select public.reassign_job_order($1, $2, 'cover leave')", [j, a.userId]),
        ),
      ).toBe(true); // owner: managers only
      expect(
        await fails(() => q1(ops, "select public.reassign_job_order($1, $2, 'same')", [j, exec])),
      ).toBe(true);
      await q1(ops, "select public.reassign_job_order($1, $2, 'Exec on leave')", [j, exec2]);
      const row = await one(
        mgr,
        "select assigned_to, status, assigning_manager_id from job_orders where id = $1",
        [j],
      );
      expect(row).toMatchObject({
        assigned_to: exec2,
        status: "ASSIGNED",
        assigning_manager_id: ops,
      });
      expect((await notes(exec2, "JOB_ASSIGNED")).some((n: any) => n.entity_id === j)).toBe(true);
      expect(
        (await notes(exec, "JOB_ASSIGNED")).some((n: any) =>
          n.title.startsWith("Job reassigned away"),
        ),
      ).toBe(true);
      const ev = await one(
        mgr,
        "select note, meta from job_order_events where job_order_id = $1 and kind = 'REASSIGNED'",
        [j],
      );
      expect(ev.note).toBe("Exec on leave");
      expect(await q1(exec, "select id from job_orders where id = $1", [j])).toHaveLength(0); // the previous assignee no longer sees it
    });

    it("refuses inactive staff, and shows them as inactive in the directory", async () => {
      await q1(a.userId, "select public.save_staff_profile($1, $2::jsonb)", [
        exec2,
        JSON.stringify({ active: false }),
      ]);
      expect(await fails(() => job(mgr, { assignedTo: exec2 }))).toBe(true);
      expect(
        await fails(() => q1(ops, "select public.reassign_job_order($1, $2, 'try')", [j, exec2])),
      ).toBe(true);
      expect(
        (await q1(mgr, "select * from staff_directory()")).find((r: any) => r.user_id === exec2)
          .active,
      ).toBe(false);
      await q1(a.userId, "select public.save_staff_profile($1, $2::jsonb)", [
        exec2,
        JSON.stringify({ active: true }),
      ]);
    });

    it("derives overdue from the deadline and reports it on the dashboard", async () => {
      const late = await job(mgr, { assignedTo: ops, deadline: day(-3), title: "Late job" });
      const ok = await job(mgr, { assignedTo: ops, deadline: day(3), title: "On time job" });
      const v = await q1(mgr, "select id, is_overdue from job_orders_v where id = any($1)", [
        [late, ok],
      ]);
      expect(Object.fromEntries(v.map((r: any) => [r.id, r.is_overdue]))).toEqual({
        [late]: true,
        [ok]: false,
      });
      await q1(ops, "select public.accept_job_order($1)", [late]);
      await q1(ops, "select public.set_job_status($1, 'COMPLETED', 'Done late')", [late]);
      expect(
        (await one(mgr, "select is_overdue from job_orders_v where id = $1", [late])).is_overdue,
      ).toBe(false); // finished
      const d = (await one(mgr, "select public.jobs_dashboard() as d")).d;
      expect(d.pending + d.active + d.completed).toBeGreaterThan(0);
      expect(typeof d.overdue).toBe("number");
      const other = (await one(b.userId, "select public.jobs_dashboard() as d")).d;
      expect(other).toMatchObject({ pending: 0, active: 0, completed: 0, overdue: 0 });
      expect(await fails(() => q1(viewer, "select public.jobs_dashboard()"))).toBe(true);
    });

    it("lets managers cancel with a reason, and audits assignments and status changes", async () => {
      const x = await job(mgr, { assignedTo: exec, title: "Cancel me" });
      expect(
        await fails(() =>
          q1(exec, "select public.set_job_status($1, 'CANCELLED', 'not needed')", [x]),
        ),
      ).toBe(true);
      expect(await fails(() => q1(mgr, "select public.set_job_status($1, 'CANCELLED')", [x]))).toBe(
        true,
      );
      await q1(mgr, "select public.set_job_status($1, 'CANCELLED', 'Customer withdrew')", [x]);
      expect(await status(x)).toBe("CANCELLED");
      const audit = await q1(
        a.userId,
        "select action, entity_type from audit_logs where entity_type = 'job_order'",
      );
      expect(audit.length).toBeGreaterThan(5);
      expect(new Set(audit.map((r: any) => r.action))).toEqual(
        new Set(["CREATE", "STATUS_CHANGE", "UPDATE"]),
      );
    });

    it("lets creators and managers edit open jobs, not strangers or finished jobs", async () => {
      const x = await job(mgr, { assignedTo: exec, title: "Editable" });
      await q1(mgr, "select public.update_job_order($1, $2::jsonb)", [
        x,
        JSON.stringify({ title: "Edited title", priority: "URGENT", deadline: day(9) }),
      ]);
      expect(
        await one(mgr, "select title, priority from job_orders where id = $1", [x]),
      ).toMatchObject({ title: "Edited title", priority: "URGENT" });
      expect(
        await fails(() =>
          q1(exec, 'select public.update_job_order($1, \'{"title":"mine now"}\'::jsonb)', [x]),
        ),
      ).toBe(true);
      expect(
        await fails(() => q1(exec2, "select public.update_job_order($1, '{}'::jsonb)", [x])),
      ).toBe(true);
      await q1(mgr, "select public.set_job_status($1, 'CANCELLED', 'dropped')", [x]);
      expect(
        await fails(() => q1(mgr, "select public.update_job_order($1, '{}'::jsonb)", [x])),
      ).toBe(true);
    });
  });
});
