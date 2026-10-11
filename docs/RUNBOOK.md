# Operations runbook

For whoever is on call. Keep it short, keep it current.

## First five minutes of any incident

1. `GET /api/health` (is the app up?) and `GET /api/health?deep=1` with `Authorization: Bearer $CRON_SECRET`
   (database answers? configuration complete?). The `problems` list names what is wrong.
2. Vercel → Deployments: did a deploy just happen? If yes and things broke, **roll back** to the previous deployment.
3. Sentry: new error groups since the incident began.
4. Supabase → Reports / Logs: database CPU, connections, API errors.
5. Tell users what you know; do not guess a cause in public.

## Symptoms and fixes

| Symptom                                       | Likely cause                                                          | Action                                                                                                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everyone gets "something went wrong"          | Bad deploy, Supabase down                                             | Roll back; check Supabase status                                                                                                                                                                                                         |
| Sign-in emails not arriving                   | Supabase SMTP / Resend domain                                         | Check Resend dashboard, DNS records                                                                                                                                                                                                      |
| "Too many attempts" for many users            | One NAT'd office sharing an IP, or Upstash misconfigured              | Check `login throttled` warnings; limits are per IP and per email (8 / 10 min)                                                                                                                                                           |
| Payments stay PENDING after the customer paid | Webhook not arriving or secret mismatch                               | Razorpay → Webhooks → recent deliveries for `/api/webhooks/razorpay/<orgId>`; 400 = wrong secret, 404 = credentials removed, 500 = our error (Razorpay retries). Re-save credentials in Settings → Online payments if the secret changed |
| `amount_mismatch` in logs                     | Amount or currency in the event differs from the request              | Do **not** mark paid. Compare in Razorpay; contact the agency                                                                                                                                                                            |
| Org cannot add members/bookings/documents     | Plan limit (`P0020`) or trial ended                                   | Settings → Billing shows usage; extend the trial or upgrade (see below)                                                                                                                                                                  |
| Subscription paid but plan not upgraded       | `subscription.*` webhook missing, or `plans.razorpay_plan_id` not set | Check platform webhook deliveries; check the plan id matches                                                                                                                                                                             |
| Automation drafts not appearing               | Cron not running or `CRON_SECRET` mismatch                            | Vercel → Cron Jobs → logs for `/api/cron/automation`                                                                                                                                                                                     |
| Documents fail to download                    | Storage bucket or service-role key                                    | Check `/api/health?deep=1`; confirm the `documents` bucket exists and is private                                                                                                                                                         |

## Useful queries (run in the Supabase SQL editor; they bypass RLS, so be careful and read-only unless stated)

```sql
-- Payments that have been pending for over an hour (candidates for reconciliation with Razorpay)
select p.id, o.name as organization, p.amount, p.currency, p.razorpay_order_id, p.created_at
from public.payments p join public.organizations o on o.id = p.organization_id
where p.status = 'PENDING' and p.razorpay_order_id is not null and p.created_at < now() - interval '1 hour';

-- Recent webhook outcomes that need a human
select event_id, event_type, outcome, organization_id, received_at
from public.payment_webhook_events
where outcome in ('amount_mismatch','unknown_order','unknown_subscription','unknown_plan')
order by received_at desc limit 50;

-- Extend a trial for an organization (write: do it deliberately)
update public.subscriptions set trial_ends_at = now() + interval '14 days' where organization_id = '<org id>';

-- Revoke every customer-portal link of one organization (e.g. after a suspected leak)
update public.portal_links set revoked_at = now() where organization_id = '<org id>' and revoked_at is null;
```

## Backups and restore

Two layers exist and they cover different things:

| Layer                                    | Covers                                               | Granularity   | Who runs it                                                           |
| ---------------------------------------- | ---------------------------------------------------- | ------------- | --------------------------------------------------------------------- |
| Supabase backups / PITR                  | the whole database instance                          | whole project | Supabase (turn PITR on for production)                                |
| Application backups (Settings > Backups) | one agency's records, as an encrypted, portable file | one agency    | the daily cron `/api/cron/backup` or a manager pressing "Back up now" |

Application backups contain the agency's database rows only. They do **not** contain files in document storage, gateway
credentials, customer-portal links or platform billing state (these are deliberately excluded so a restore cannot bring back
stale payment secrets or subscription status).

**Recovery targets (goals, not demonstrated):** RPO 24 hours (daily schedule), RTO 4 hours for one agency. These are
targets only. They are not claimed as achieved until a restore drill (below) has been run and its date and duration written
down in the drills log.

### Setting up application backups

1. Create a private bucket in any S3-compatible provider and a key pair limited to that bucket. Turn on versioning or object lock if the provider has it, so a backup cannot be silently overwritten.
2. Set `BACKUP_ENCRYPTION_KEY` and the four `BACKUP_S3_*` variables in the production environment, and keep a copy of the key in your password manager (separate from the bucket).
3. As an owner, open Settings > Backups, switch on automatic backups, choose the frequency and retention, and press "Back up now". A run is only recorded as good after the stored file is read back and verified (checksum, decryption, completeness, row counts).
4. A failure creates a notification for people who hold the backup permission and a security event, and is retried in 6 hours.

### Before applying migrations to a real database

```bash
DATABASE_URL=... node scripts/pre-migration-backup.mjs      # pg_dump if installed, otherwise an encrypted NDJSON export
```

Move the file off the machine, then run `npm run db:migrate`. The script only reads the database.

### Restoring one agency (always a supervised, manual procedure)

The application never restores data by itself. The "Restore plan" button only takes a safety copy of today's data and records a plan.

1. Pick the backup in Settings > Backups and press Verify, then Download (needs a recent password check).
2. Prove it restores: `BACKUP_ENCRYPTION_KEY=... node scripts/restore-check.mjs backup.crmbk <organization-id>` builds a scratch database from the migrations, loads every row and compares the counts. Exit code 0 only if everything matches. No real database is touched.
3. Put the agency in maintenance (tell users; if needed set the subscription to read-only from the platform admin).
4. Take (or confirm) the safety copy the plan produced.
5. Load the verified rows into the production database in one transaction, for that agency only, with `set session_replication_role = replica` so foreign keys are not checked mid-load, and compare counts per table with the History table before committing. `scripts/restore-check.mjs` shows the exact `jsonb_populate_recordset` statements.
6. Run `npm run db:status` and the smoke tests, reopen, and mark the plan as done.

If anything differs from the recorded counts, stop and roll back the transaction. Never restore over production without a safety copy you have verified.

### Restore drills log

| Date                | Backup used | Time taken | Result / notes |
| ------------------- | ----------- | ---------- | -------------- |
| _none recorded yet_ |             |            |                |

### Supabase layer

- Production uses Supabase PITR/daily backups. **Test a restore into a scratch project before you need it.**
- Storage objects (documents) are not part of the database backup; enable bucket replication/backup if the documents matter.
- After any restore: run `npm run db:status` against the restored database, then run the smoke tests.

## Rotating secrets

| Secret                                        | Procedure                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`                   | Regenerate in Supabase, update Vercel, redeploy                                                                                                                                                                                                                                                                         |
| `CRON_SECRET`                                 | Update Vercel (both cron and monitors that call deep health), redeploy                                                                                                                                                                                                                                                  |
| `RAZORPAY_*` (platform)                       | Create new keys in Razorpay, update Vercel, redeploy, then revoke the old keys; update the webhook secret on both sides at the same time                                                                                                                                                                                |
| An agency's Razorpay keys                     | The agency owner re-enters them in Settings → Online payments (replaces the stored ciphertext)                                                                                                                                                                                                                          |
| `ENCRYPTION_KEY`                              | There is no automatic re-encryption yet. Planned procedure: export nothing; set a new key, then every agency re-enters its Razorpay keys (until they do, online payments for that agency are off). If the key is **compromised**, also ask agencies to rotate their Razorpay keys, since the ciphertext may have leaked |
| A user's session / suspected account takeover | Supabase → Authentication → Users → sign out / disable the user; review Settings → Audit log for that user                                                                                                                                                                                                              |

## Data requests

Customers may ask for access to, or deletion of, their data. There is no self-service workflow yet. Process manually:
export the customer's rows (customers, passengers, bookings, documents metadata), delete or anonymise on request subject
to the agency's legal retention duties, and remove the objects from the `documents` bucket. Record the request.

### Restore drill (do this once before go-live, then every quarter)

1. In Supabase, take or confirm a recent backup (Dashboard > Database > Backups). Never run a restore, reset or destructive migration against the production project without a verified backup you have seen.
2. Create a **scratch** project, restore the backup into it (or apply `npm run db:bundle` output to it and load a dump).
3. Point a local `.env.scratch` at it and run `node --env-file=.env.scratch scripts/migrate.mjs --status`; all migrations should show as applied.
4. Run `RUN_LIVE=1` tests against the scratch project only, sign in, open a booking, an invoice PDF and a document (documents live in Storage, which is backed up separately).
5. Record the date, the backup used, how long it took and anything surprising here. Delete the scratch project.

### Locked out of two-step verification

If a person loses their phone: confirm their identity another way, then in Supabase Dashboard > Authentication > Users open the user, delete their TOTP factor, and ask them to sign in and set it up again. Their _authenticator removed_ event appears under Settings > Security. If the only owner is locked out and the agency requires it, remove the factor the same way.

## Help center content

- Guides live in `content/help/*.md`; screenshots in `public/guide-img/` (never `public/help/`, which collides with the page route).
- When a screen changes: re-run `scripts/capture-help-screenshots.mjs`, check the images and captions, bump `updated` and `version` in the affected guides.
- If a guide page returns 404 in production but works locally, the server bundle is missing the files: confirm `outputFileTracingIncludes` in `next.config.ts` and the `.nft.json` traces after a build.
