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
