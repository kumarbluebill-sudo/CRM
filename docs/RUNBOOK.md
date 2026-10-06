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

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Everyone gets "something went wrong" | Bad deploy, Supabase down | Roll back; check Supabase status |
| Sign-in emails not arriving | Supabase SMTP / Resend domain | Check Resend dashboard, DNS records |
| "Too many attempts" for many users | One NAT'd office sharing an IP, or Upstash misconfigured | Check `login throttled` warnings; limits are per IP and per email (8 / 10 min) |
| Payments stay PENDING after the customer paid | Webhook not arriving or secret mismatch | Razorpay → Webhooks → recent deliveries for `/api/webhooks/razorpay/<orgId>`; 400 = wrong secret, 404 = credentials removed, 500 = our error (Razorpay retries). Re-save credentials in Settings → Online payments if the secret changed |
| `amount_mismatch` in logs | Amount or currency in the event differs from the request | Do **not** mark paid. Compare in Razorpay; contact the agency |
| Org cannot add members/bookings/documents | Plan limit (`P0020`) or trial ended | Settings → Billing shows usage; extend the trial or upgrade (see below) |
| Subscription paid but plan not upgraded | `subscription.*` webhook missing, or `plans.razorpay_plan_id` not set | Check platform webhook deliveries; check the plan id matches |
| Automation drafts not appearing | Cron not running or `CRON_SECRET` mismatch | Vercel → Cron Jobs → logs for `/api/cron/automation` |
| Documents fail to download | Storage bucket or service-role key | Check `/api/health?deep=1`; confirm the `documents` bucket exists and is private |

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

- Production uses Supabase PITR/daily backups. **Test a restore into a scratch project before you need it.**
- Storage objects (documents) are not part of the database backup; enable bucket replication/backup if the documents matter.
- After any restore: run `npm run db:status` against the restored database, then run the smoke tests.

## Rotating secrets

| Secret | Procedure |
|--------|-----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Regenerate in Supabase, update Vercel, redeploy |
| `CRON_SECRET` | Update Vercel (both cron and monitors that call deep health), redeploy |
| `RAZORPAY_*` (platform) | Create new keys in Razorpay, update Vercel, redeploy, then revoke the old keys; update the webhook secret on both sides at the same time |
| An agency's Razorpay keys | The agency owner re-enters them in Settings → Online payments (replaces the stored ciphertext) |
| `ENCRYPTION_KEY` | There is no automatic re-encryption yet. Planned procedure: export nothing; set a new key, then every agency re-enters its Razorpay keys (until they do, online payments for that agency are off). If the key is **compromised**, also ask agencies to rotate their Razorpay keys, since the ciphertext may have leaked |
| A user's session / suspected account takeover | Supabase → Authentication → Users → sign out / disable the user; review Settings → Audit log for that user |

## Data requests

Customers may ask for access to, or deletion of, their data. There is no self-service workflow yet. Process manually:
export the customer's rows (customers, passengers, bookings, documents metadata), delete or anonymise on request subject
to the agency's legal retention duties, and remove the objects from the `documents` bucket. Record the request.
