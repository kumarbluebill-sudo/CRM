import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn } from "./session";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const run = randomBytes(4).toString("hex");
const PASSWORD = `Live-${randomBytes(9).toString("base64url")}-9aZ`;
const mail = (n: string) => `live-job${n}-${run}@example.invalid`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const userIds: string[] = [];
let orgId = "";
let jobUrl = "";
const consoleErrors: string[] = [];

test.describe.configure({ mode: "serial" });

async function makeUser(name: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: mail(name),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `LIVE-TEST ${name}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  return data.user.id;
}

test.beforeAll(async () => {
  await makeUser("owner");
  const owner = createClient(URL_, PUB, opts);
  await owner.auth.signInWithPassword({ email: mail("owner"), password: PASSWORD });
  const { data: org, error } = await owner.rpc("create_organization", {
    org_name: "LIVE-TEST Jobs Agency",
  });
  if (error) throw error;
  orgId = String(org);
  const staffId = await makeUser("staff");
  const otherId = await makeUser("other");
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    await db.query(
      "insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'OPERATIONS'), ($1, $3, 'SALES_EXECUTIVE')",
      [orgId, staffId, otherId],
    );
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    const orgs = (
      await db.query(
        `select distinct o.id from public.organizations o
         left join public.organization_members m on m.organization_id = o.id
        where o.name like 'LIVE-TEST %' and (m.user_id = any($1::uuid[]) or not exists (select 1 from public.organization_members x where x.organization_id = o.id)
          or o.created_at < now() - interval '30 minutes')`,
        [userIds],
      )
    ).rows.map((r) => r.id);
    for (const id of orgs) await db.query("delete from public.organizations where id = $1", [id]);
  } finally {
    await db.end();
  }
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const u of data?.users ?? [])
    if (
      userIds.includes(u.id) ||
      (/^live-[a-z0-9-]+-[0-9a-f]{8}@example\.invalid$/.test(u.email ?? "") &&
        Date.now() - Date.parse(u.created_at) > 30 * 60 * 1000)
    )
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
});

async function login(browser: Browser, who: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${who} ${page.url()} ${m.text()}`);
  });
  await signIn(page, mail(who), PASSWORD);
  return page;
}

test("an administrator records staff designations and creates a job for a named staff member", async ({
  browser,
}) => {
  const owner = await login(browser, "owner");
  await owner.goto("/settings/staff");
  const row = owner.locator("details", { hasText: "Edit details for LIVE-TEST staff" });
  await row.getByText("Edit details for LIVE-TEST staff").click();
  await row.getByLabel("Employee code").fill("E-204");
  await row.getByLabel("Designation").fill("Visa Processing Officer");
  await row.getByLabel("Department").fill("Visa desk");
  await row.getByRole("button", { name: "Save details" }).click();
  await expect(owner.getByText("Staff details saved.").last()).toBeVisible({ timeout: 15_000 });
  // duplicate employee codes are refused
  const other = owner.locator("details", { hasText: "Edit details for LIVE-TEST other" });
  await other.getByText("Edit details for LIVE-TEST other").click();
  await other.getByLabel("Employee code").fill("e-204");
  await other.getByRole("button", { name: "Save details" }).click();
  await expect(owner.getByText(/already used/i)).toBeVisible({ timeout: 15_000 });

  await owner.goto("/jobs/new");
  await owner.getByLabel(/^Job title/).fill("Collect passport scans for the Bali group");
  await owner
    .getByLabel("Assign to")
    .selectOption({ label: "LIVE-TEST staff · Visa Processing Officer · Visa desk (0 open)" });
  await owner.getByLabel("Priority").selectOption("HIGH");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await owner.getByLabel("Deadline").fill(tomorrow);
  await owner.getByRole("button", { name: "Create job order" }).click();
  await expect(owner).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  jobUrl = owner.url();
  await expect(owner.getByRole("heading", { level: 1 })).toHaveText(
    "Collect passport scans for the Bali group",
  );
  await expect(
    owner.getByText("LIVE-TEST staff · Visa Processing Officer · Visa desk"),
  ).toBeVisible();
  await expect(owner.getByText(/^JO-\d{4}-\d{4}/)).toBeVisible();
  await owner.context().close();
});

test("the assignee is notified, can open the job from the bell, accept it and complete it", async ({
  browser,
}) => {
  const staff = await login(browser, "staff");
  const bell = staff.getByRole("button", { name: /Notifications, 1 unread/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(staff.getByRole("menuitem", { name: /New job assigned: JO-/ })).toBeVisible();
  await staff.getByRole("menuitem", { name: /New job assigned: JO-/ }).click();
  await expect(staff).toHaveURL(jobUrl);
  await staff.reload();
  await expect(staff.getByRole("button", { name: "Notifications" })).toBeVisible(); // marked read: no count any more

  await staff.getByRole("button", { name: "Accept this job" }).click();
  await expect(staff.getByText("Job accepted.").last()).toBeVisible({ timeout: 15_000 });
  await staff.getByLabel("Change status").selectOption("IN_PROGRESS");
  await staff.getByRole("button", { name: "Update status" }).click();
  await expect(staff.getByText("Status updated.").last()).toBeVisible({ timeout: 15_000 });
  await staff.getByLabel("Add a comment").fill("Called the group leader; scans arrive tonight.");
  await staff.getByRole("button", { name: "Add comment" }).click();
  await expect(staff.getByText("Comment added.").last()).toBeVisible({ timeout: 15_000 });
  // completing needs notes
  await staff.getByLabel("Change status").selectOption("COMPLETED");
  await staff.getByRole("button", { name: "Update status" }).click();
  await expect(staff.getByLabel(/Completion notes/)).toBeVisible();
  await staff.getByLabel(/Completion notes/).fill("All 12 passport scans received and filed.");
  await staff.getByRole("button", { name: "Update status" }).click();
  await expect(staff.getByText("Status updated.").last()).toBeVisible({ timeout: 15_000 });
  await expect(staff.getByText("All 12 passport scans received and filed.").first()).toBeVisible();
  await expect(staff.getByText("Called the group leader")).toBeVisible();
  // staff cannot reassign or edit: those controls are not offered
  await expect(staff.getByRole("button", { name: "Reassign" })).toHaveCount(0);
  await staff.context().close();
});

test("the assigning manager hears about completion, sees workload, and notification preferences save", async ({
  browser,
}) => {
  const owner = await login(browser, "owner");
  await owner.getByRole("button", { name: /Notifications, \d+ unread/ }).click();
  await expect(owner.getByRole("menuitem", { name: /Job completed: JO-/ })).toBeVisible();
  await owner.keyboard.press("Escape");

  await owner.goto("/jobs");
  await expect(
    owner.getByRole("table", { name: /Open, overdue and completed jobs/ }),
  ).toContainText("LIVE-TEST staff");
  await expect(owner.getByRole("list", { name: "Job orders" })).toContainText(
    "Collect passport scans",
  );
  await owner.goto("/jobs?status=COMPLETED&priority=HIGH");
  await expect(owner.getByRole("list", { name: "Job orders" })).toContainText(
    "Collect passport scans",
  );
  await owner.goto("/jobs?status=NEW");
  await expect(owner.getByText("No jobs match")).toBeVisible();

  await owner.goto("/dashboard");
  await expect(owner.getByRole("region", { name: "Key metrics" })).toContainText(
    "Pending Job Orders",
  );

  await owner.goto("/notifications");
  await expect(owner.getByRole("list", { name: "Notification history" })).toContainText(
    "Job completed",
  );
  await owner.getByLabel("A job is assigned to me: send by email").check();
  await owner.getByLabel("A payment is received: show in the app").uncheck();
  await owner.getByRole("button", { name: "Save preferences" }).click();
  await expect(owner.getByText("Preferences saved.")).toBeVisible({ timeout: 15_000 });
  await owner.reload();
  await expect(owner.getByLabel("A job is assigned to me: send by email")).toBeChecked();
  await expect(owner.getByLabel("A payment is received: show in the app")).not.toBeChecked();
  await owner.getByRole("button", { name: "Mark all as read" }).click();
  await expect(owner.getByRole("button", { name: "Notifications", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await owner.context().close();
});

test("people not involved cannot open a job, and the notification feed needs a session", async ({
  browser,
  request,
}) => {
  const other = await login(browser, "other");
  await other.goto(jobUrl);
  await expect(other.getByText(/could not be found|not found/i).first()).toBeVisible();
  await expect(other.getByText("Collect passport scans")).toHaveCount(0); // nothing about the job leaks
  await other.goto("/jobs");
  await expect(other.getByText("No jobs match")).toBeVisible();
  await other.goto("/notifications");
  await expect(other.getByText("No notifications yet")).toBeVisible();
  await other.context().close();
  expect((await request.get("/api/notifications/summary")).status()).toBe(401);
});

test("the new pages are accessible and error-free", async ({ browser }) => {
  const owner = await login(browser, "owner");
  for (const path of [
    "/jobs",
    "/jobs/new",
    jobUrl.replace(/^https?:\/\/[^/]+/, ""),
    "/notifications",
    "/settings/staff",
  ]) {
    await owner.goto(path);
    await expect(owner.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const results = await new AxeBuilder({ page: owner }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(serious.map((v) => `${path} ${v.id}: ${v.nodes[0]?.html?.slice(0, 120)}`)).toEqual([]);
  }
  expect(consoleErrors.filter((e) => !/favicon|404|401/i.test(e))).toEqual([]);
});
