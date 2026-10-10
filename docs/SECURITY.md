# Security notes (Phase 1 baseline)

## Headers (next.config.ts)

CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy,
and HSTS (production only).

## CSP

- `script-src` / `style-src` include `'unsafe-inline'` because Next.js injects inline
  bootstrap scripts and styles. Planned hardening: nonce-based CSP via `proxy.ts`
  (see Next.js "content-security-policy" guide) once pages are dynamic. `'unsafe-eval'` is dev-only.
- External domains: the Supabase project URL (`connect-src`, `img-src`, websockets) is added
  automatically from `NEXT_PUBLIC_SUPABASE_URL`. Fonts are self-hosted by `next/font`.
- Later phases must add: Razorpay checkout (script/frame), Sentry ingest (connect-src).

## Secrets

- Only `NEXT_PUBLIC_*` values reach the browser. Server secrets are read via
  `lib/env.server.ts` (`server-only`); importing it in client code fails the build.
- `.env*` is git-ignored except `.env.example`.

## Auth/proxy

`proxy.ts` (Next 16's replacement for middleware.ts) only refreshes the Supabase session.
It is not an authorization layer; routes and Postgres RLS enforce access (Phase 2).

## Logging

`lib/utils/logger.ts` redacts keys matching password/secret/token/authorization/api key/
cookie/passport/signature/card. `lib/utils/errors.ts` returns only user-safe messages.

## Document import and AI (Phase 5)

- **Upload route** `POST /api/itineraries/import`: Origin check, session + `itineraries.create`, rate limit
  (10/min/user, in-memory until Upstash is configured), 4 MB cap (Vercel body limit), extension + MIME +
  magic-byte validation, display-only sanitized filename, extraction in memory with a 25 s timeout.
  The original file is never stored; only the parsed draft (and extracted text until converted) is kept.
- **Untrusted content**: document text is data only. The rule parser drops instruction-like lines; the AI call
  wraps the text in `<document>` tags with a system prompt that forbids following it, uses JSON output only,
  has no tools, and every response is validated by Zod. Any failure falls back to the rule parser.
- **Data minimization**: before the AI step, emails, phone numbers and passport-like IDs are replaced with
  placeholders and text is capped at 60k characters. The AI step is skipped entirely if `OPENAI_API_KEY` is unset.
- **Human review**: imported itineraries are created as drafts with `needs_review = true`. A database trigger blocks
  publishing until a user confirms via `mark_itinerary_reviewed()` (records who/when).
- **Cost control**: each AI call is logged in `ai_requests` (no prompt or output stored); 100 successful calls per
  organization per 24 h until plan-based limits arrive.
- Known limit: DOCX/XLSX are zip files; the 4 MB cap and parse timeout bound, but do not fully rule out,
  decompression-bomb style inputs. Moving extraction to a background worker is a hardening follow-up.

## Quotations and PDF (Phase 6)

- Costs/profit are protected in the database (separate RLS-gated table), not just hidden in the UI; the PDF route requests the
  non-private document, so costs cannot reach it, and its input type has no cost fields.
- `GET /api/quotations/[id]/pdf`: session + `quotes.view`, 20/min rate limit, `private, no-store`, UUID-validated id, RLS-scoped data.
- Standard PDF fonts are used; amounts print with the currency code (no remote font fetching).
- Not yet implemented: audit-log entries for PDF downloads and price changes (price changes are already versioned with the user id).

## Bookings, passports and documents (Phase 7)

- **Passport data** is stored apart from general passenger data and protected by RLS (`passengers.view_sensitive`:
  owner, admin, operations, sales manager). Lists show a masked value; "Reveal" fetches the full number on demand, auto-hides after
  30 s, and is written to the audit log (the number itself is never logged).
- **Documents**: upload route checks origin, session, permission, rate limit, size (4 MB), extension, MIME and magic bytes; objects
  are stored under `<org-id>/<random-uuid>.<ext>` (client filenames never reach storage). Downloads are authorised by RLS, logged,
  and served by a 60-second signed URL. Failed metadata inserts delete the uploaded object.
- **Vouchers** contain guest names, supplier and confirmation reference only; no prices, costs or passport data.
- **Audit**: conversion, status changes, passport view/update/delete, document upload/download and voucher downloads are recorded.
- Known gaps: service-role key is required for document storage (keep it server-only); virus scanning is not available;
  supplier payables/costs on bookings arrive with the payments phase.

## Payments (Phase 8)

- Clients can only read `payments`, `invoices` and receipts. All writes go through SECURITY DEFINER functions that check `payments.create`, lock the booking row and validate the amount against the booking balance (overpayment is rejected in the database).
- `bookings.paid_amount` is derived (sum of CAPTURED payments) and only written by `sync_booking_paid()`.
- Online payments: the server creates the PENDING row and the Razorpay order for the amount the database approved. The browser receives only the public key id and order id. A payment becomes CAPTURED **only** via `/api/webhooks/razorpay`; the checkout "success" callback is never trusted.
- Webhook: public route, trusted only after an HMAC-SHA256 check of the raw body (constant-time compare), 64 KB body cap, per-IP rate limit. `apply_razorpay_event()` is executable by `service_role` only, de-duplicates by `X-Razorpay-Event-Id`, and refuses to capture when the amount or currency differs from the stored payment (logged as `amount_mismatch`). Errors return 500 so Razorpay retries; the ledger insert rolls back with the failed transaction.
- The webhook ledger stores event id, type and outcome only, not payloads (they contain customer contact details).
- CSP allows only `checkout.razorpay.com` (script/frame) and `api.razorpay.com` / `lumberjack.razorpay.com` (connect).
- Invoices are immutable snapshots (bill-to, lines, total); changes mean void + reissue. Receipt and invoice downloads are audited.

## Communications (Phase 9)

- Clients can only read `communications`. Writes go through `queue_communication` / `finish_communication` / `cancel_communication`, which check `communications.send`. The recipient address is copied from the customer record inside the database; the browser never supplies it. Template variables are validated (strings only, 500 chars, 20 keys, snake_case names).
- `customers.do_not_contact` blocks queueing for people and automation alike.
- Templates substitute only an allow-list of variables; unknown placeholders render blank, values are stripped of control characters, email HTML is escaped, subjects are collapsed to one line (no header injection), and display names are sanitised.
- Automation (`run_automation`, service_role only, called by `/api/cron/automation` with a constant-time `CRON_SECRET` check) only **drafts** messages, de-duplicated per rule and instalment. A person reviews and sends each draft.
- WhatsApp uses click-to-chat links (`wa.me`): no API tokens exist anywhere. Delivery to WhatsApp can't be confirmed; "Sent" means the link was opened.

## Customer portal (Phase 10)

- Links hold a random 256-bit token; only its SHA-256 is stored. Staff see the URL once at creation. Links expire (max 180 days), can be revoked, and are scoped to one booking.
- Portal functions are executable by `service_role` only and return a fixed projection: no supplier names/costs, profit, passport data, internal notes or other bookings. A test asserts the payload contains none of those.
- Routes under `/portal` send `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`, and all lookups are rate limited per IP (and per token for payments).
- Documents are visible only when staff flag them shared; passport/visa documents can never be flagged (database constraint). Downloads use 60-second signed URLs and are audited.
- Customer payments reuse the Phase 8 pipeline (amount validated in the database, captured only by the signed webhook). Customer requests become tasks, limited to 5 per link per day.

## AI assistant (Phase 11)

- The assistant has **no tools and no write path**. It receives one record the caller can already open (loaded through the caller's own RLS session, so other organizations are unreachable), and returns plain text that a person reads. It cannot send, change or delete anything.
- Prompt injection: record text is wrapped in `<crm_data>` and declared as data; attempts to forge the closing tag are stripped; the worst outcome of a successful injection is odd text shown to the staff member who asked.
- Data minimisation: free text is redacted (emails, phone numbers, ID-like numbers). Never sent: contact details, passport data, supplier names or costs, quotation profit, payment references. Money is included only for users with `payments.view`.
- Output is shown as text (never HTML), control characters are stripped and length is capped; the UI labels it as AI-generated and unverified.
- AI itinerary drafts are saved as imports in REVIEW, so the Phase 5 review gate applies (cannot publish until a person confirms).
- Quotas: 40 successful requests per user and 100 per organization per rolling 24 hours (`ai_requests_last_day_user`, `ai_requests_last_day`), plus 10 requests/minute per user. Prompts and outputs are never stored; only feature, model and token counts.
- Requires `ai.use`. Without `OPENAI_API_KEY` the page says AI isn't set up and the rest of the CRM is unaffected.

## Reports (Phase 12)

- One read-only SQL function, `report_summary`, runs as the **caller** (security invoker), so RLS applies to every row. It requires `reports.view`; each section also requires the permission of its underlying data (`leads.view`, `quotes.view`, `bookings.view`, `payments.view`) and is omitted otherwise.
- No supplier costs, quotation profit, passport data or contact details appear in reports or exports. Money is grouped by currency and never summed across currencies. Ranges are capped at ~2 years.
- CSV export (`/api/reports/export`): same permissions plus the underlying view permission, 5,000-row cap, 10/min rate limit, audited as EXPORT, cells that start with `= + - @` are neutralised against spreadsheet formula injection, and the exported columns are an allow-list.

## Plans and billing (Phase 13)

- Plans are read-only reference data; subscriptions are read-only to clients (the Razorpay subscription id is not even selectable). Changes happen only through owner-only functions (`billing.manage`) or `apply_subscription_event` (service role only).
- Limits (seats, bookings per month, document storage) are enforced by database triggers on the growing tables, so they apply to every code path; AI daily caps come from the same plan. Error code `P0020`. Existing data is never deleted or hidden when a plan lapses.
- Access is computed on read: an ended trial, an expired subscription or a cancelled one past its paid period falls back to the Free plan, so nothing depends on a cron job. Past-due keeps access while Razorpay retries.
- Checkout: the Razorpay plan id comes from the database, the organization from the session; only an https URL is returned to the browser. A plan becomes active **only** from a signature-verified `subscription.*` webhook, de-duplicated by event id, that names the stored subscription id and a plan we recognise. An unknown plan never grants access.
- Billing events share the existing signed webhook endpoint with customer payments.

## Visa module (slice 1)

- Same tenant model as everything else: `organization_id` on every visa table, composite foreign keys, RLS. The schema-wide invariant tests cover the new tables automatically.
- Applications and enquiries cannot be inserted or have their status/assignees changed by the browser. Workflow goes through SECURITY DEFINER functions that check a `visa.*` permission, lock the row, enforce the transition map (e.g. `DOCUMENT_REVIEW` cannot jump to `DELIVERED`; `READY_FOR_SUBMISSION` needs every required document approved), and write the timeline and audit log. The UI copy of the transition map is checked against the SQL by a unit test.
- **Supplier/government cost is in its own table** (`visa_product_costs`) readable only with `visa.supplier.view`. Selling price is returned by `visa_unit_price()`, which reads cost server-side and never reveals it. Pricing columns change only through `update_visa_pricing()`, which requires a reason and appends to `visa_price_history`.
- **Passports** live in `visa_traveller_identity` (needs `visa.document.view`); lists show them masked (`A12***67`); the duplicate finder returns only application number, traveller name and status, never the number. Passport numbers are kept out of the audit log and timeline.
- **Files** use the existing private bucket and 60-second signed URLs. `documents` gained `visa_application_id`; its RLS now lets `visa.document.view/upload` roles reach files linked to a visa application while every other sensitive-document rule is unchanged (tested). The upload route takes the application and filing category from the checklist line in the database, not from the browser. Previews use a signed URL in a frame (CSP `frame-src` allows same-origin and the storage host only); every view/download is audited.
- Applications are soft-deleted (`deleted_at`), only while new or cancelled; documents and audit rows are retained.

## Visa module (slice 2)

- **Price is server-side.** `visa_calc_price` reads fees and cost inside the database and returns only the selling price; a discount can never exceed the subtotal. The result is stored as a snapshot by `price_visa_application` (clients cannot update those columns), so later fee changes never rewrite an old quote. A discount needs `visa.discount` and a reason; the price locks once a quotation exists.
- **Quotation and payments reuse the existing systems.** `create_visa_quotation` needs `visa.edit`, `visa.price.view` and `quotes.create`. Conversion to a booking links it to the application through a trigger; no payment, invoice or receipt code was changed.
- **Supplier cost** in `visa_supplier_submissions` is readable only with `visa.supplier.view`; a submitter without `visa.supplier.edit` cannot store a cost.
- **Final visas** (`visa_results`) need `visa.document.view` to read; the file goes through the same upload route, private bucket and signed URLs. The route finds the application from the traveller in the database and calls `record_visa_result`, which checks the file belongs to that application.
- **Delivery** is recorded with a method and confirmation; a trigger refuses `DELIVERED` without it, so the rule holds even if the status is set another way.
- **Messages** to customers are drafted by `queue_visa_communication` (address copied from the customer record, `do_not_contact` honoured, only `VISA_*` or `GENERAL` templates) and sent from the Messages tab by a person, as elsewhere. Template variables are an allow-list.
- **Work queue** is a security-invoker function, so people only see what their permissions and RLS allow; another agency sees zeros.

## Visa module (slice 3)

- **Reports and alerts run as the caller** (security invoker). Reports need `visa.report.view`; revenue needs `visa.price.view`; profit and supplier performance need `visa.supplier.view`. Profit counts only applications with a recorded cost, so a missing cost never reads as full margin. Alerts never contain passport numbers.
- **CSV export** (`/api/visa/export`) is limited to applications, enquiries and (with `visa.supplier.view`) supplier submissions. No passport data or contact details are included; cells starting with `= + - @` are neutralised; each export is rate-limited and audited.
- **CSV import** is a two-step flow: check (writes nothing, row-by-row result) then confirm. Rows that already exist are skipped, never overwritten. It needs `visa.price.edit`; government and supplier fees additionally need `visa.supplier.edit`. Files are limited to 300 KB and 500 rows, columns are an allow-list, and every imported product records its source, creator and a price-history entry. Imported text is only ever stored as data.

## Logos and the app shell (027)

- Logo uploads are identified by their bytes (PNG, JPEG, WebP, SVG), limited to 2 MB, 32-6000 px, and always **re-encoded to a fresh PNG on the server** (sharp), so original bytes, metadata and markup are never stored or served. SVG is accepted only as plain vector artwork: scripts, event handlers, links, `<image>`/`<use>`/`<style>`, DOCTYPE/entities and any external reference cause a refusal rather than a "clean-up". Only people with `settings.manage` can change it.
- The dashboard and search run as the caller (RLS applies). Search escapes wildcards and is length-limited. Dashboard range parameters are validated and fall back to a safe default.

## GST invoices

- **Tax is calculated only in the database** (`recalc_invoice`); the browser sends descriptions, quantities, prices, discounts and tax-code choices, never totals. Tests prove client-supplied totals are ignored.
- **No tax data is assumed.** Rates and SAC codes are entered by the agency and must be verified by someone with `invoicing.manage` before they can be used under a GSTIN; changing a rate, SAC or treatment clears the verification, and issue re-checks every line. GSTINs are validated for shape, state and check character, in the database and in the app.
- **Issued invoices cannot change.** A trigger refuses any update to an issued invoice or its lines (even from a superuser session); corrections are credit notes with their own numbers and exact proportional tax (no paise created or lost). The issued invoice carries a snapshot of the supplier details and tax codes used.
- **Roles:** drafts and issuing need `payments.create`; the profile, tax codes, signature and credit notes need `invoicing.manage`. Other agencies see nothing (RLS), and invoice PDFs are rendered only for rows the caller can read.

## Package photos

- Uploads are checked by file signature (JPEG, PNG, WebP only), limited to 5 MB and 8000 px, then **cropped and re-encoded as a new JPEG with all metadata removed** (GPS and device data never survive). The uploader must confirm they have the right to use the photo.
- Files are stored privately under the agency's folder; the database rejects any path outside that format. Photos reach the browser only through an authenticated route that checks row security first, and PDFs embed them server-side. There are no public or hotlinked URLs, and anonymous requests get 401.
- Destructive buttons now meet colour-contrast requirements (found by the accessibility scan).

## Notifications, staff and job orders

- **Private by construction.** A notification row belongs to one user; row security shows only your own, and nobody can insert, edit or delete them from a browser. Text carries record numbers and generic titles only (no passport data, customer contact details or document contents). Opening one goes to an ordinary page that applies the reader's own permissions again, so a link never grants access.
- **Reliable but harmless.** Events are de-duplicated by key, the person who caused an event is not notified of it, and a failure while notifying is caught and logged (`notification_deliveries`) so it can never roll back the business action. Email is opt-in per type, goes only through the configured provider, contains the headline and a link, and failures are recorded.
- **Job orders** are visible only to the assignee, the creator, the assigning manager, and people with `jobs.assign` or `jobs.manage`. Status moves follow a fixed map (completion needs notes, cancelling and reassigning need a reason), reassigning needs `jobs.assign`, inactive staff cannot be assigned, and owners or administrators can be assigned work only by someone with `jobs.manage`. Every change appends to the job's history and the audit log, and "overdue" is derived from the deadline, never stored.
- **Staff details** (employee code, designation, department, phone, manager) are editable only with `users.manage`. The directory used by pickers excludes phone numbers and emails, and workload figures are shown only to people who manage work.
- **Not covered here:** job attachments are not offered (the documents table would need new access rules); use comments and the related record's documents for now.

## Two-step verification, sessions and monitoring (v1.2.0-rc.4)

- **Authenticator-app codes (TOTP)** can be turned on by anyone under _Profile > Account security_. Once an account has a verified authenticator, the **database itself** treats a password-only session as signed out: row security helpers (`current_org_id`, `has_permission`, `is_super_admin`) return nothing unless the session token carries `aal2`. A stolen password therefore cannot be used against the API directly, not only through the website. Only a person's own profile and notifications stay readable at the first step so the sign-in screens can work.
- **Agency policy:** an owner/admin can require two-step verification for all owners and admins (`set_require_admin_mfa`). It cannot be switched on unless the person turning it on has it on their own account, and administrators cannot remove their authenticator while it is required. Until an administrator enrols, the app shows only the set-up page.
- **Recent password check:** changing tax details, verifying tax codes, issuing credit notes, changing or removing team members, changing authenticator or agency policy, and exporting data require a sign-in within the last 15 minutes (60 for exports); otherwise the person is asked for their password and returned where they were. Return addresses are same-site paths only.
- **Sessions:** inactive sessions end after 8 hours (`SESSION_IDLE_MINUTES`, 5 min to 24 h); background polling does not keep a session alive. _Sign out other devices_ and _Sign out everywhere_ are in Account security.
- **Monitoring:** failed sign-ins, rate-limit blocks, wrong codes, permission denials (rate limited so they cannot flood the table), authenticator changes and session revocations are written to `security_events` (addresses shortened to /24 or /48, 180-day retention, pruned by the daily cron). Five failed sign-ins for an address in 15 minutes, any authenticator removal and any global sign-out notify people who manage users. Owners/admins see a summary and the latest events under _Settings > Security_.
- **Checked by tests:** every function a signed-in user can call must check who they are or be on a reviewed allow-list; internal functions cannot be called by browsers; a state-changing API route must authenticate, verify a signature or secret, or be a token-bearing portal route; the public payment route checks the request origin; a secret scan (`npm run scan:secrets`, also in CI) blocks credential-shaped text in tracked files.
- **Not covered:** recovery codes for lost authenticators (an administrator can remove a factor in the Supabase dashboard); SMS codes; per-device session lists; hardware-key (WebAuthn) support. Dependency audit currently reports only moderate findings (mammoth via argparse, used for trusted uploaded .docx parsing on the server).

## Custom roles, branches, record scope and time zones (v1.3.0-rc.1)

- **One permission check for everything.** `has_permission()` now reads the person's custom role when they have one, otherwise their system role, and returns false for deactivated staff and for password-only sessions of accounts with two-step verification. Every row security policy already calls it, so custom roles need no policy changes. The app asks the database for the permission list (`my_permissions()`); the browser never decides.
- **No escalation.** Creating or editing a role, and putting someone on one, needs `users.manage` plus a recent password confirmation. The base role must rank below the editor, a role can only contain permissions the editor holds, people can only be changed if they rank below the editor, nobody changes their own role, and a role in use cannot be deleted. Every change is written to the audit log.
- **Record scope** (`own`, `assigned`, `branch`, `all`) is enforced by restrictive row security policies on leads, customers, bookings, quotations, invoices and tasks. A restrictive policy can only narrow access; the default is `all`, so existing roles behave as before. Scope applies to reads and therefore to updates and deletes, which must read the row first.
- **Branches** and staff **open-job limits** are managed through definer functions; limits are enforced when work is assigned.
- **Time zones:** instants are stored in UTC. Reports and the dashboard count days in the agency zone (the summary functions set the session zone for the transaction). Flights, stays and appointments keep the zone of the place where they happen. Display uses IANA zones through Intl, so daylight saving is automatic; unit tests cover London, New York, India (no DST) and a Dubai flight viewed from India.
- **Not covered yet:** PDF documents still print calendar dates in `en-IN` format; working hours are not stored (they must never replace authorization); report exports are unchanged apart from day boundaries.

## Subscriptions and platform administration (v1.3.0-rc.2)

- **Paid access follows the signed webhook only.** `apply_subscription_event` is callable only by the server's service role, de-duplicates by provider event id, and stores each provider payment once (a unique provider payment id), so replays and re-ordered events cannot double-count money. A browser success page changes nothing.
- **One transition table.** `subscription_transition_ok()` decides every status change in a trigger, whichever code path (webhook, sweep, platform administrator) makes it; impossible jumps are refused and the webhook records them as `invalid_transition` instead of retrying forever. Every change writes an append-only `subscription_events` row, which can only disappear together with its agency.
- **Failed renewals:** `PAST_DUE` keeps working while the gateway retries, then `GRACE_PERIOD` (still working), then `SUSPENDED`: everything is readable and downloadable, nothing new can be created (restrictive insert policies), and a successful payment restores full access at once. Nothing is deleted at any step. Retry window and grace days are platform settings. The daily cron runs `run_billing_sweeps()` and sends reminders (7, 3 and 1 day before renewal; 3 and 1 before a trial ends; payment failed; grace; suspended) to people holding `billing.manage`.
- **Quotas in the database:** active staff (deactivated staff do not count), branches, bookings, storage and monthly report exports (`use_allowance`). A downgrade never deletes anything; it only stops new records beyond the new limit, and the preview lists what exceeds the new plan.
- **Platform administrators** (`profiles.is_super_admin`, set only by SQL) use `/admin` (404 for everyone else) and definer functions that re-check the flag, with password re-confirmation for edits and refunds. A refund is made at the gateway first and recorded only if that succeeds. Agency owners can neither read other agencies nor edit plans.
- **Receipts** are payment receipts, not GST tax invoices; the operator's accountant must confirm tax invoicing before they are described otherwise. No card data is ever stored.
- **Not tested against the live gateway:** checkout, plan change and refund calls need real Razorpay keys and plan ids; everything around them (webhook, history, states) is tested without them.
