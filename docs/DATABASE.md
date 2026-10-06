# Database setup (Supabase)

Migrations live in `database/migrations` and must be applied in numeric order.

## Apply (dev project)

Option A, Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push        # after copying/linking migrations into supabase/migrations
```

Option B, dashboard: open **SQL Editor** and run `001`..`005` in order.

## Supabase Auth settings required

- Authentication > Providers > Email: enable, **Confirm email = on**.
- Authentication > URL Configuration: Site URL = `NEXT_PUBLIC_APP_URL`; add
  `<APP_URL>/auth/callback` to Redirect URLs.

## Verify tenant isolation

With a **dev/test** project and these env vars exported in your shell
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`):

```bash
npm test
```

`tests/integration/tenant-isolation.test.ts` creates two agencies and asserts that A cannot
read, modify or join B, cannot escalate privileges, and that anonymous clients see nothing.
The tests are skipped when the variables are absent.

## Model

- One user belongs to exactly one organization (Phase 2 rule; `organization_members.user_id` unique).
- Roles/permissions are global reference data; the `SUPER_ADMIN` role is platform-only and cannot be a member role.
- Organizations are created only through `create_organization()` (security definer), which makes the caller OWNER.
- Org status and plan, and `profiles.is_super_admin`, are not writable by clients (column privileges).

## Local verification (no Supabase needed)

`tests/integration/rls-local.test.ts` applies every migration to an embedded Postgres (PGlite)
with a stubbed `auth` schema and runs the tenant-isolation / RBAC suite as the `authenticated`
role. It runs with plain `npm test`. The Supabase-backed suite (`tenant-isolation.test.ts`)
additionally checks the real project once credentials are exported.

## Phase 3 tables

`lead_sources`, `leads`, `lead_activities`, `lead_notes` (006); `customers`, `customer_contacts`,
`customer_preferences` (007); `tasks` (015, adds `tasks.view` / `tasks.manage`).

- `organization_id` defaults to `current_org_id()`; the app never sends it. RLS `WITH CHECK` rejects any other value.
- Composite foreign keys `(id, organization_id)` stop a row referencing another tenant's customer, source or assignee.
- `lead_activities` and `lead_notes` are append-only for API users.
- `public.apply_tenant_policies()` is the shared policy generator used by later phases.
- Removing a member who is still assigned leads/tasks is blocked by FK; reassign first.

## Phase 4: itineraries (008)

Tables: `itineraries`, `itinerary_days`, `itinerary_items`, `itinerary_versions` (append-only), plus
`itineraries.view/create/update/delete` permissions.

- The builder edits the whole itinerary in the browser and saves it with `save_itinerary()`: one
  transaction, optimistic concurrency (`version`), server-side Zod validation first, DB constraints second.
- `save_itinerary`, `duplicate_itinerary` and `itinerary_document` are SECURITY INVOKER, so every read/write
  goes through RLS as the caller.
- Publishing or "Save version" writes a snapshot to `itinerary_versions`; restoring loads a snapshot into the
  editor, and saving creates a new version.
- Images are `https://` URLs only for now (CSP `img-src` allows https). Uploads to private storage come later.

## Phase 5 tables (008a, 018)

`itinerary_imports` (parsed draft + confidence, review state), `itineraries.needs_review/import_id/reviewed_*`,
`ai_requests` (usage log). Trigger `itineraries_review_gate` blocks publishing unreviewed imports.

## Phase 6: quotations (009)

Tables: `quotations`, `quotation_options` (A/B/C…), `quotation_items`, `quotation_item_costs`, `quotation_versions`,
`quotation_templates`, `organization_counters`; `organization_branding.logo_data` + hex-colour checks.

- **Supplier cost is a separate table.** `quotation_item_costs` is readable/writable only with `quotes.view_cost`.
  `save_quotation` leaves costs untouched for everyone else, so a sales executive editing a quote never wipes or sees them.
  Profit needs `quotes.view_cost` + `quotes.view_profit`, and is withheld unless every line has a cost.
- **Totals are computed by triggers** (`recalc_quotation_option`); clients cannot write totals, status, number or approval fields
  (column privileges). `lib/quotation/pricing.ts` mirrors the maths and is tested for parity with SQL.
- **Status** changes only through `set_quotation_status()` (definer, checks `quotes.send` / `quotes.update`, valid transitions).
  Sent/approved quotations are locked; "Negotiation" re-opens them. `CONVERTED` is reserved for the booking phase.
- **Versions** are snapshots without costs/profit, taken on send, approve, any price change and "Save version".
- **Numbering** `Q-YYYY-NNNN` per organization via `next_org_number()` (row-locked counter).
- Logo is stored as a validated PNG/JPEG data URI (<= 300 KB). The PDF never fetches remote URLs.

## Phase 7: bookings and operations (009a, 011, 012, 014)

- `009a_audit_logs`: append-only trail written only by `write_audit()` (secret-looking keys stripped); readable by `settings.manage`.
  (Numbered 009a so later migrations can call it; the spec's 017 slot is intentionally unused.)
- `011_suppliers`: suppliers, contacts, services with rates (purchase costs, so `suppliers.view` / `suppliers.manage`).
- `012_bookings`: bookings, status history, passengers, `passenger_identity` (passport data, `passengers.view_sensitive` only),
  booking items. Bookings are created only by `convert_quotation_to_booking()` (approved quotation, one booking per quotation,
  copies the selected option, adds the customer as lead passenger, creates 3 operations tasks, marks the quotation CONVERTED).
  Status changes only via `set_booking_status()` (valid transitions, cancellation reason required, history + audit).
  `paid_amount` is not client-writable; the payments phase will maintain it.
- `014_documents`: metadata only. Files live in the private `documents` bucket, which has no client policies: the server
  uses the service role after RLS has authorised the caller. Passport/visa documents need `passengers.view_sensitive`.
- Supabase setup: the bucket is created by the migration. Set `SUPABASE_SERVICE_ROLE_KEY` on the server (never in the browser).

## Phase 8: payments (016)

`payment_schedules` (instalments, sum capped at the booking total by trigger), `payments` (read-only to clients; manual and Razorpay), `invoices` (snapshots, one active per booking), `payment_webhook_events` (service role only), `payment_reminders` (idempotent follow-up tasks), view `payment_schedule_status` (security invoker; allocates paid money to instalments in due-date order). Functions: `record_payment`, `prepare_online_payment`, `attach_razorpay_order`, `discard_pending_payment`, `issue_invoice`, `void_invoice`, `create_payment_reminders`, `apply_razorpay_event` (service_role only).

Razorpay setup: set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (server only) and `SUPABASE_SERVICE_ROLE_KEY`; in the Razorpay dashboard add a webhook to `https://<your-domain>/api/webhooks/razorpay` for `payment.captured`, `payment.failed` and `order.paid`, using the same secret.

## Phase 9: communications (017)

`message_templates`, `automation_rules`, `communications` (outbox/log), `customers.do_not_contact`. Functions: `queue_communication`, `finish_communication`, `cancel_communication`, `run_automation` (service_role only). Permissions: `communications.view/send/manage`.

Env: `RESEND_API_KEY` and `EMAIL_FROM` (a Resend-verified sender) for email; `CRON_SECRET` (min 16 chars) for the daily job in `vercel.json`.

## Phase 10: customer portal (019)

`portal_links` (hashed tokens), `portal_requests`, `documents.portal_visible`. Staff functions: `create_portal_link`, `revoke_portal_link`, `set_document_portal_visible` (permission `portal.manage`). Customer-side functions, all service_role only: `portal_view`, `portal_document`, `portal_prepare_payment`, `portal_attach_order`, `portal_discard_payment`, `portal_submit_request`.

## Phase 11: AI assistant (020)

Permission `ai.use`; `ai_requests.feature` gains SUMMARIZE, DRAFT_MESSAGE, ASK; `itinerary_imports.file_type` gains `AI`; function `ai_requests_last_day_user()`. Optional env `OPENAI_MODEL` (default gpt-4o-mini).

## Phase 12: reports (021)

`report_summary(from, to)`, security invoker, returns jsonb sections `pipeline`, `quotations`, `bookings`, `collections`.

## Phase 13: subscriptions (022)

`plans` (FREE / STARTER / PRO; **placeholder prices and limits, set them before launch**), `subscriptions` (every organization starts on a 14-day Pro trial; existing organizations were backfilled), functions `effective_plan`, `org_limits`, `org_usage`, `prepare_subscription`, `attach_subscription`, `mark_cancel_requested`, `apply_subscription_event` (service role only), limit triggers on `organization_members`, `bookings` and `documents`. Permission `billing.manage` (owner).

Setup: create the plans in the Razorpay dashboard (Subscriptions → Plans), then `update plans set razorpay_plan_id = 'plan_...' where key = 'STARTER'` (and PRO). Add `subscription.activated`, `.charged`, `.pending`, `.halted`, `.cancelled`, `.completed` and `.resumed` to the webhook already pointed at `/api/webhooks/razorpay`.

## Phase 14: security hardening (023)

`organization_payment_settings` (encrypted Razorpay credentials, no client access), `organization_invites`, functions `payment_settings_status`, `payments_online_enabled`, `create_invite`, `revoke_invite`, `my_invite`, `accept_invite`, `portal_org`, `portal_payments_ready`; `apply_razorpay_event` now takes the organization (7 arguments). New env: `ENCRYPTION_KEY` (32 random bytes, base64). Full findings: `docs/SECURITY_AUDIT.md`.
