#!/usr/bin/env node
/**
 * Captures the REAL screens used in the Help center into public/guide-img/, with numbered markers drawn over the page
 * (inserted into the DOM just before each capture and removed again, so nothing is edited afterwards).
 *
 *   npm run build && npx next start -p 3000                      # in one terminal (add BACKUP_LOCAL_DIR and
 *                                                                #   BACKUP_ENCRYPTION_KEY to show a finished backup)
 *   node --env-file=.env.local scripts/capture-help-screenshots.mjs
 *
 * It creates a throwaway agency ("Sunrise Travels (help demo)") with a few sample records in the Supabase project from
 * .env.local, signs in as its owner, captures every screen listed in SHOTS, then deletes the agency and the user.
 * It fails if a marker target cannot be found, so the numbers quoted in the guides stay true when the UI changes.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUB =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !SERVICE || !PUB || !process.env.DATABASE_URL) {
  console.error("Run with --env-file=.env.local (Supabase URL, keys and DATABASE_URL are needed).");
  process.exit(2);
}
const out = path.resolve("public/guide-img");
mkdirSync(out, { recursive: true });

const ORG_NAME = "Sunrise Travels (help demo)";
const run = randomBytes(4).toString("hex");
const EMAIL = `help-demo-${run}@example.invalid`;
const PASSWORD = `Help-${randomBytes(9).toString("base64url")}-9aZ`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const uid = () => crypto.randomUUID();

/**
 * Every screen to capture: file name, page, numbered markers (the numbers are quoted in content/help/*.md captions) and
 * an optional taller window. A marker is [number, (page) => locator]; the run fails if any cannot be found on screen.
 */
const T =
  (t, exact = false) =>
  (p) =>
    p.getByText(t, { exact }).filter({ visible: true }).first();
const css = (sel) => (p) => p.locator(sel).first();
const nth = (sel, n) => (p) => p.locator(sel).nth(n);
const SHOTS = [
  {
    file: "dashboard",
    path: "/dashboard",
    marks: [
      [1, css("aside")],
      [2, css("form[role=search]")],
      [3, css("header button[aria-label='Quick actions']")],
      [4, css("header [aria-label*='otification']")],
      [5, css("header a[aria-label='Help center']")],
      [6, css("header a[aria-label='Your profile']")],
    ],
  },
  {
    file: "leads",
    path: "/leads",
    marks: [
      [1, css("main input[placeholder^='Search']")],
      [2, css("main select")],
      [3, T("Board", true)],
      [4, T("New lead")],
      [5, T("Follow up", true)],
    ],
  },
  {
    file: "itineraries",
    path: "/itineraries",
    marks: [
      [1, css("main input[placeholder^='Search']")],
      [2, T("Templates", true)],
      [3, T("Import", true)],
      [4, T("New itinerary")],
      [5, T("Coorg weekend", true)],
    ],
  },
  {
    file: "quotations",
    path: "/quotations",
    marks: [
      [1, css("main input[placeholder^='Search']")],
      [2, css("main select")],
      [3, T("Templates", true)],
      [4, T("New quotation")],
      [5, T("Converted", true)],
    ],
  },
  {
    file: "bookings",
    path: "/bookings",
    marks: [
      [1, css("main input[placeholder^='Search']")],
      [2, css("main select")],
      [3, T("Approved quotations", true)],
      [4, T("Payment pending", true)],
    ],
  },
  {
    file: "invoices",
    path: "/payments/invoices",
    marks: [
      [1, T("Invoicing and GST settings", true)],
      [2, T("No invoices yet.", true)],
    ],
  },
  {
    file: "visa",
    path: "/visa",
    marks: [
      [1, T("My open applications", true)],
      [2, T("Documents to review", true)],
      [3, T("New enquiry", true)],
      [4, T("New application", true)],
      [5, T("Applications by status", true)],
    ],
  },
  {
    file: "reports",
    path: "/reports",
    marks: [
      [1, css("main button:has-text('Apply')")],
      [2, T("Last 30 days", true)],
      [3, T("Download CSV:", true)],
      [4, T("Sales pipeline", true)],
    ],
  },
  {
    file: "roles",
    path: "/settings/roles",
    marks: [
      [1, css("main input[placeholder='Search staff']")],
      [2, nth("main select", 0)],
      [3, nth("main select", 1)],
      [4, css("main input[placeholder='No limit']")],
      [5, T("Which records can they see?")],
      [6, T("What can they do?")],
    ],
  },
  {
    file: "regional",
    path: "/settings/regional",
    marks: [
      [1, css("main [role=combobox], main input[placeholder='Type to search…']")],
      [2, nth("main select", 0)],
      [3, nth("main select", 1)],
      [4, T("Branches", true)],
    ],
  },
  {
    file: "billing",
    path: "/settings/billing",
    height: 1500,
    marks: [
      [1, T("Active staff accounts", true)],
      [2, css("section[aria-label=Plans]")],
      [3, T("Payment history", true)],
    ],
  },
  {
    file: "backups",
    path: "/settings/backups",
    before: async (page) => {
      const b = page.getByRole("button", { name: "Back up now" });
      if (await b.isEnabled()) {
        await b.click();
        await page.getByText("Backup completed and verified.").first().waitFor({ timeout: 60000 });
        await page.reload({ waitUntil: "networkidle" });
      }
    },
    marks: [
      [1, css("main button:has-text('Back up now')")],
      [2, T("Schedule and retention", true)],
      [3, T("History", true)],
    ],
  },
  {
    file: "security",
    path: "/settings/security",
    marks: [
      [1, T("Failed sign-ins", true)],
      [2, T("Blocked by rate limit", true)],
      [3, T("Permission denials", true)],
      [4, T("Data exports", true)],
    ],
  },
  {
    file: "notifications",
    path: "/notifications",
    marks: [
      [1, T("Unread", true)],
      [2, T("Mark all as read", true)],
      [3, T("Notification preferences", true)],
      [4, T("By email", true)],
    ],
  },
  {
    file: "communications",
    path: "/communications",
    marks: [
      [1, T("Queued", true)],
      [2, T("Templates and automation", true)],
      [3, T("No messages yet.", true)],
    ],
  },
];

async function seed() {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Priya Sharma" },
  });
  if (error) throw error;
  const userId = data.user.id;
  const c = createClient(URL_, PUB, opts);
  await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const org = await c.rpc("create_organization", { org_name: ORG_NAME });
  if (org.error) throw org.error;
  const customers = [];
  for (const [name, email, phone] of [
    ["Neha Rao", "neha@example.invalid", "+91 90000 22222"],
    ["Arjun Mehta", "arjun@example.invalid", "+91 98000 11111"],
    ["Kavya Iyer", "kavya@example.invalid", "+91 97000 33333"],
  ]) {
    const r = await c
      .from("customers")
      .insert({ name, email, phone, state: "Karnataka" })
      .select("id")
      .single();
    if (r.error) throw r.error;
    customers.push(r.data.id);
  }
  const leads = [
    ["Bali honeymoon", "Bali", "NEW"],
    ["Kerala family trip", "Kerala", "QUOTE_SENT"],
    ["Dubai long weekend", "Dubai", "FOLLOW_UP"],
  ];
  for (const [i, [title, destination, status]] of leads.entries()) {
    const r = await c
      .from("leads")
      .insert({ title, destination, status, customer_id: customers[i] });
    if (r.error) console.warn("lead:", r.error.message);
  }
  const it = await c
    .from("itineraries")
    .insert({ title: "Coorg weekend", destination: "Coorg", status: "PUBLISHED" });
  if (it.error) console.warn("itinerary:", it.error.message);
  const q = await c.rpc("create_quotation", { p_customer: customers[2], p_title: "Coorg stay" });
  if (!q.error) {
    const qid = q.data;
    const doc = (await c.rpc("quotation_document", { p_id: qid, p_private: false })).data;
    await c.rpc("save_quotation", {
      p_id: qid,
      p_expected_version: doc.version,
      p_data: {
        title: "Coorg stay",
        itineraryId: null,
        options: [
          {
            id: doc.options[0].id,
            name: "A",
            taxRate: 0,
            items: [
              {
                id: uid(),
                type: "HOTEL",
                description: "Resort stay",
                quantity: 2,
                unitPrice: 5000,
              },
            ],
          },
        ],
      },
    });
    await c.rpc("set_quotation_status", { p_id: qid, p_status: "SENT" });
    await c.rpc("set_quotation_status", { p_id: qid, p_status: "APPROVED" });
    const b = await c.rpc("convert_quotation_to_booking", { p_quotation: qid });
    if (b.error) console.warn("booking:", b.error.message);
  } else console.warn("quotation:", q.error.message);
  return { userId, orgId: String(org.data) };
}

async function cleanup(userId) {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    await db.query("delete from public.organizations where name = $1", [ORG_NAME]);
  } finally {
    await db.end();
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}

/** Draws numbered discs next to each target, from measured positions, and returns a function that removes them. */
async function annotate(page, marks) {
  const boxes = [];
  for (const [n, make] of marks) {
    const loc = make(page);
    await loc.waitFor({ state: "visible", timeout: 8000 }).catch(() => {
      throw new Error(`marker ${n}: target not found on ${page.url()}`);
    });
    const box = await loc.boundingBox();
    if (!box) throw new Error(`marker ${n}: target has no box on ${page.url()}`);
    const vp = page.viewportSize();
    if (box.y + box.height > vp.height || box.x + box.width > vp.width)
      throw new Error(`marker ${n}: target is outside the visible screen on ${page.url()}`);
    boxes.push([n, box]);
  }
  await page.evaluate((items) => {
    const layer = document.createElement("div");
    layer.id = "help-annotations";
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    for (const [n, b] of items) {
      const ring = document.createElement("div");
      ring.style.cssText = `position:fixed;left:${b.x - 3}px;top:${b.y - 3}px;width:${b.width + 6}px;height:${b.height + 6}px;border:2px solid #dc2626;border-radius:8px`;
      const dot = document.createElement("div");
      dot.textContent = String(n);
      dot.style.cssText = `position:fixed;left:${Math.max(2, b.x - 12)}px;top:${Math.max(2, b.y - 12)}px;width:22px;height:22px;border-radius:50%;background:#dc2626;color:#fff;font:700 12px/22px system-ui,sans-serif;text-align:center`;
      layer.append(ring, dot);
    }
    document.body.append(layer);
  }, boxes);
}

async function main() {
  await cleanup(null); // a previous aborted run
  const { userId } = await seed();
  const browser = await chromium.launch();
  let failed = false;
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });
    const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
    for (const s of SHOTS) {
      if (only && !only.includes(s.file)) continue;
      try {
        await page.setViewportSize({ width: 1280, height: s.height ?? 800 });
        await page.goto(`${BASE}${s.path}`, { waitUntil: "networkidle" });
        await page.addStyleTag({
          content:
            "*{transition:none!important;animation:none!important;caret-color:transparent!important}",
        });
        if (s.before) await s.before(page);
        await page.mouse.move(0, 0);
        if (!process.env.RAW) await annotate(page, s.marks);
        await page.screenshot({ path: path.join(out, `${s.file}.png`), animations: "disabled" });
        await page.evaluate(() => document.getElementById("help-annotations")?.remove());
        console.log(`ok   ${s.file}.png`);
      } catch (e) {
        failed = true;
        console.error(`FAIL ${s.file}: ${e.message}`);
        if (process.env.DEBUG_DUMP) {
          console.error(
            (
              await page
                .locator("main")
                .innerText()
                .catch(() => "")
            ).slice(0, 500),
          );
          console.error(
            "headers:",
            await page
              .locator("th")
              .allInnerTexts()
              .catch(() => []),
          );
          console.error(
            "links:",
            (
              await page
                .getByRole("link")
                .allInnerTexts()
                .catch(() => [])
            ).slice(0, 40),
          );
        }
      }
    }
  } finally {
    await browser.close();
    await cleanup(userId);
  }
  if (failed) process.exit(1);
}
await main();
