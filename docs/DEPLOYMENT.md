# Deployment guide

Production target: **Vercel** (app) + **Supabase** (Postgres, Auth, Storage) + **Upstash** (rate limits) + **Resend** (email) +
**Razorpay** (payments and subscriptions) + optional **OpenAI** and **Sentry**.

Nothing here has been run against live accounts by the people who wrote the code. Treat the first deployment as a
staging exercise and work through the smoke tests before inviting real customers.

## 1. Environments

Use **separate Supabase projects** (and separate Razorpay test/live keys) for each of:

| Environment | Branch | Purpose |
|-------------|--------|---------|
| Development | local | `npm run dev`, your own Supabase project or none (the app runs without Supabase configured) |
| Staging / Preview | `develop` (Vercel preview) | Razorpay **test** keys, a separate Supabase project, fake data |
| Production | `main` | Razorpay live keys, the production Supabase project |

Never point a preview deployment at the production database.

## 2. Supabase

1. Create the project (pick the region closest to your users; for India choose Mumbai). Save the database password.
2. **Authentication → Providers → Email**: enable **Confirm email** (team invitations trust the verified address) and set
   the minimum password length to 12.
3. **Authentication → URL Configuration**: Site URL = your production origin; add `https://<domain>/auth/callback` to the
   redirect allow-list (and the preview URL for staging).
4. **Authentication → SMTP**: use Resend's SMTP so verification and reset emails come from your domain, not Supabase's
   shared sender (which is rate limited and may land in spam).
5. Apply the schema (section 3). Migration 014 creates the private `documents` bucket; confirm in **Storage** that it is
   not public and has no policies.
6. Enable **Point-in-Time Recovery** (paid plans) or at least daily backups, and note the retention.
7. Copy the keys: Project URL, `anon` key, `service_role` key. The service-role key bypasses RLS: it goes only into
   Vercel's server-side environment variables, never into client code or a `NEXT_PUBLIC_` variable.

## 3. Database migrations

Migrations live in `database/migrations/` and are applied in filename order by `scripts/migrate.mjs`, which records each
file's checksum in `public.schema_migrations`, runs each in a transaction, takes an advisory lock, and refuses to run if an
already-applied file was edited.

```bash
# Use the DIRECT connection string (Dashboard → Database → Connection string, port 5432), not the transaction pooler.
export DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'
npm run db:status      # what is applied / pending / drifted
node scripts/migrate.mjs --dry-run
npm run db:migrate
```

Rules for changing the schema later:

- **Never edit an applied migration.** Add a new numbered file.
- Make changes backward compatible (add columns/tables first, switch code, remove old things in a later migration) so the
  previous deployment keeps working during a rollout and a rollback stays possible. Migrations are forward-only.
- Run migrations **before** promoting the new app version.

After the first run, set real plan prices and limits (the seeded values are placeholders):

```sql
update public.plans set price_paise = 199900, limits = '{"seats":5,"bookingsPerMonth":100,"aiOrgDaily":50,"aiUserDaily":20,"storageMb":2048}' where key = 'STARTER';
```

## 4. Environment variables

Set in Vercel → Project → Settings → Environment Variables, per environment. `npm run check-env` (load a file with
`node --env-file=<file> scripts/check-env.mjs`) validates them and prints names only.

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | public. The legacy name `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **secret**, server only |
| `NEXT_PUBLIC_APP_URL` | yes | `https://your-domain` with no trailing slash |
| `ENCRYPTION_KEY` | yes | **secret**. 32 random bytes, base64. Encrypts agencies' Razorpay keys. Generate once; back it up in your password manager; losing it means agencies must re-enter their keys |
| `CRON_SECRET` | yes | **secret**, 16+ chars. Vercel sends it to cron routes; also guards the deep health check |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | yes in production | without them rate limits are per-instance only |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | to sell subscriptions | the **platform's** account (subscriptions to your product). Agencies' customer payments use their own keys, entered in the app |
| `RESEND_API_KEY`, `EMAIL_FROM` | for email | `EMAIL_FROM` must be on a domain verified in Resend |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | optional | AI features are hidden/disabled without the key |
| `SENTRY_DSN` | recommended | error reporting |
| `APP_ENV` | optional | `production` / `preview`, shown in error reports |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # CRON_SECRET
```

## 5. Third-party setup

**Upstash**: create a Redis database in the region nearest your Vercel functions; copy the REST URL and token.

**Resend**: add and verify your domain (SPF, DKIM, DMARC), create an API key limited to sending.

**Razorpay (platform account, for subscriptions)**:
1. Subscriptions → Plans: create one plan per paid tier (monthly, INR).
2. Store each plan id: `update public.plans set razorpay_plan_id = 'plan_xxx' where key = 'STARTER';` (and `PRO`).
3. Settings → Webhooks → add `https://<domain>/api/webhooks/razorpay` with your `RAZORPAY_WEBHOOK_SECRET` and the events
   `subscription.activated`, `.charged`, `.pending`, `.halted`, `.cancelled`, `.completed`, `.resumed`.

**Razorpay (each agency)**: the agency owner opens **Settings → Online payments**, pastes their own key id/secret, picks a
webhook secret, and adds the webhook URL the page shows (`/api/webhooks/razorpay/<organizationId>`) with events
`payment.captured`, `payment.failed`, `order.paid`. Keys are verified with Razorpay and stored encrypted.

## 6. Vercel

1. Import the GitHub repository; framework preset Next.js; Node.js 22.
2. Production branch `main`; enable preview deployments for `develop` and pull requests.
3. Add the environment variables (section 4) for Production and Preview separately.
4. Region: choose the one closest to the Supabase region (for India, `bom1`) in Project → Settings → Functions.
5. Cron: `vercel.json` schedules `/api/cron/automation` daily. Vercel passes `CRON_SECRET` as a bearer token.
6. The PDF, AI and import routes declare `maxDuration = 60`; make sure your Vercel plan allows 60-second functions.
7. Domain: add it, enforce HTTPS (HSTS is already sent in production by `next.config.ts`).
8. Branch protection on `main`: require the **CI** workflow (lint, type check, tests, build, audit, secret scan) to pass.

## 7. Smoke tests after every production deploy

1. `GET /api/health` returns `{"status":"ok"}`.
2. `curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/health?deep=1"` returns `ok` with an empty `problems` list.
3. Register, confirm the email, create an agency, and sign in.
4. Create a lead, customer, quotation (download the PDF), convert to a booking.
5. Record a manual payment and download the receipt.
6. Upload a document and download it (signed URL; try the URL after 60 s: it must fail).
7. Create a customer-portal link and open it in a private window; confirm no internal data appears.
8. Send a test email (Resend) and check it arrives and is not in spam.
9. With Razorpay **test** keys: connect the agency, take a test payment, confirm the booking balance updates only after
   the webhook (watch Settings → Audit log for the `PAYMENT` entry).
10. Check the audit log shows your sign-in, and that a second agency cannot see the first agency's data.
11. Trigger a deliberate error and confirm it reaches Sentry.

### Automated live check

`npm run test:live` runs the same kind of checks against whichever Supabase project is in `.env.local`: RLS and RPC behaviour on the real platform, private storage, the customer portal, webhooks, invitations, then the real app in a browser (sign in, create an agency, open every main page, create a customer and a lead, sign out). It creates users named `live-…@example.invalid` (no email is sent) and agencies named "LIVE-TEST …", and deletes them afterwards. Run it against staging, never production.

## 8. Releasing and rolling back

- Work on `feature/*`, merge to `develop` (staging), then merge `develop` into `main` to release; tag releases (`v1.0.0`).
- Order: run migrations → deploy the app. Roll the app back instantly from Vercel's deployment list (migrations are
  forward-only, which is why they must be backward compatible).
- Data recovery: Supabase PITR / backups (see `docs/RUNBOOK.md`).

## 9. Go-live checklist

Security
- [ ] Email confirmation on; password minimum 12; Supabase SMTP set to Resend
- [ ] Service-role key only in Vercel server env; `.env*` never committed (CI scans for it)
- [ ] `ENCRYPTION_KEY` backed up outside Vercel
- [ ] Razorpay webhooks verified end to end in test mode, then live
- [ ] Upstash configured (deep health check shows no `rate_limit_redis` problem)
- [ ] `docs/SECURITY_AUDIT.md` residual risks reviewed and accepted by the owner
- [ ] A penetration test or independent review done by someone other than the author

Operations
- [ ] Backups/PITR enabled and a restore tested once
- [ ] Sentry alerts and an uptime monitor on `/api/health`
- [ ] Plan prices and limits set; Razorpay plan ids stored
- [ ] Terms of service, privacy policy and data-retention policy published (customer passport data is personal data)
- [ ] Support contact and an incident owner named

## 10. Known limitations at the time of writing

- Browser tests (`npm run test:e2e`) cover the signed-out surface only: public pages, accessibility (axe, WCAG 2.1 AA), security headers, route protection and mobile layout. Signed-in screens have only been exercised through server-side tests, so do the smoke tests in section 7 by hand and a cross-browser pass (Safari, Firefox) before launch.
- No malware scanning on uploads (only staff upload today).
- No data-erasure/retention workflow, no MFA, no per-organization data export.
- Refunds, GST/tax invoicing and supplier payables are not implemented.
- Email delivery tracking and WhatsApp delivery confirmation are not implemented (WhatsApp uses click-to-chat).

## 11. Added in v1.2.0 (security)

- Apply migrations `027`–`031` (`npm run db:migrate`). `031` makes the database honour two-step verification and adds `security_events`; it is additive.
- Optional env var `SESSION_IDLE_MINUTES` (default 480, range 5–1440). Nothing new is secret or public.
- Turn on **Authentication > Multi-factor > TOTP** in the Supabase dashboard (enabled by default on new projects) or enrolment will fail.
- The daily cron (`/api/cron/automation`) now also prunes old security events; make sure `CRON_SECRET` is set.
- `NEXT_PUBLIC_APP_URL` must be the real site address: it is used for the same-origin check on the public payment route and for email links.

## 12. GST: checklist before real invoices are issued

An accountant should confirm each item; the software does not assume any rate or code.

- [ ] Legal name, GSTIN, state and address in *Settings > Invoicing and GST* match the registration certificate.
- [ ] Every tax code (name, SAC, rate, treatment) was entered from current official notifications or the accountant's advice, then verified.
- [ ] Place-of-supply rule (intra vs inter-state) and any exempt/zero-rated cases match how the agency actually supplies services (e.g. tour operator, agent, or pure-agent expenses).
- [ ] Invoice number prefix and series follow the agency's policy; credit notes are used for corrections.
- [ ] A sample invoice and credit note PDF were checked line by line against a manual calculation.
- [ ] Return filing and e-invoicing/e-way thresholds were assessed separately; this app does not file returns or generate IRNs.
