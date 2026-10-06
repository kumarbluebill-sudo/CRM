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
