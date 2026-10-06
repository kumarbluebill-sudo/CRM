# Security audit (Phase 14)

Scope: the whole repository at the end of Phase 13 (database, server actions, route handlers, portal, billing, AI).
This is a code and configuration review plus automated checks. It is **not** a penetration test, and nothing was run
against live Supabase, Razorpay, Resend or OpenAI accounts.

## Method

1. Read every server action and route handler for the same four questions: who is the caller, is the organization taken
   from the session (never the request), is the permission checked server-side, is the input validated.
2. Searched for dangerous primitives (`dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML`): none present.
3. Reviewed every use of the service-role client (9 files). Each is behind a prior authorization step, a token, a
   signature or a shared secret, and none is imported by client code (`server-only`).
4. Added **schema-wide invariant tests** (`tests/integration/security-invariants.test.ts`) so the properties below keep
   holding as the schema grows:
   - every table in `public` has RLS enabled;
   - every `SECURITY DEFINER` function pins `search_path`;
   - anonymous users can execute no application function (only extension helpers) and read zero rows from any table;
   - every view runs as the caller (`security_invoker`);
   - service-only functions (`portal_*`, `apply_*`, `run_automation`, …) are not callable by signed-in or anonymous users;
   - secret-bearing tables and columns are unreadable by every signed-in user.
5. `npm audit` on production dependencies.

## Findings and status

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| F-01 | High | Customer payments (staff checkout and the customer portal) used one platform-wide Razorpay account, so agencies' customer money would have flowed to the platform. | **Fixed.** Each agency connects its own Razorpay keys (Settings → Online payments). Keys are verified with Razorpay, encrypted with AES-256-GCM (server-held `ENCRYPTION_KEY`, ciphertext bound to the organization id) and stored where no browser role can read them. Platform keys are now used only for the product's own subscriptions. |
| F-02 | High | The payment webhook identified a payment only by Razorpay order id, so anyone holding *one* agency's webhook secret could confirm *another* agency's payment. | **Fixed.** Webhooks are addressed per organization (`/api/webhooks/razorpay/<orgId>`), verified with that organization's secret, and `apply_razorpay_event` only settles payments of that same organization. Tested. |
| F-03 | Medium | The rate limiter was per-instance memory, which is close to useless on serverless. | **Fixed.** Upstash Redis (shared counters) when configured, in-memory fallback if unset or unreachable. All 22 call sites converted. |
| F-04 | Medium | No throttling on login, registration or password reset. | **Fixed.** Login is limited per IP and per target email; registration and reset per IP (reset also per email, with an identical response so it can't be used to probe accounts). |
| F-05 | Medium | Sign-in and sign-out were not audited. | **Fixed** for users who belong to an organization. Failed sign-ins are logged to the server log (no organization context exists to attach them to). |
| F-06 | Medium | The audit log had no way to be read. | **Fixed.** Settings → Audit log (owners/admins), filterable and paginated, read-only. |
| F-07 | Medium | No team management, so seat limits could never be reached through the app and roles couldn't be changed. | **Fixed.** Settings → Team: invitations bound to a verified email, expiring after 7 days, seat-limited, rank-checked (only roles below your own; OWNER is never grantable); role changes and removals are enforced by RLS rank rules. Tested. |
| F-08 | Medium | `shadcn` (a code-generation CLI) was a runtime dependency, bringing 7 high-severity advisories into the production tree. | **Fixed.** Moved to devDependencies. |
| F-09 | Low | `sprintf-js` (via `mammoth` → `argparse`) has a moderate ReDoS-style advisory with no upstream fix. | **Accepted.** `argparse` is used only by mammoth's command-line tool; we never pass attacker-controlled format strings. Re-check on each mammoth release. |
| F-10 | Info | CSP allows `'unsafe-inline'` for scripts (Next.js inline bootstrap). | **Accepted for now.** No user-controlled HTML is rendered anywhere, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`. Moving to nonces is a follow-up. |
| F-11 | Info | If Redis is unreachable, limits fall back to per-instance. | **By design** (fail soft, never fail open completely). Monitor Upstash availability. |

## Things verified as already sound

- Tenant isolation: RLS on every table, composite foreign keys that include `organization_id`, organization taken from the
  session in the database (`current_org_id()`), never from request data. Covered by PGlite integration tests per module.
- Privileged writes only through `SECURITY DEFINER` functions with permission checks, row locks and pinned `search_path`.
- Money: amounts validated in the database against the booking balance; paid status only from signature-verified,
  de-duplicated webhooks; amount and currency in the event must match what was requested.
- Secrets: nothing secret reaches the browser (Razorpay key id only, as Razorpay Checkout requires); stored credentials
  are encrypted; log/audit helpers strip secret-looking keys.
- Documents: private bucket, random object names, magic-byte validation, 60-second signed URLs, audited downloads.
- Customer portal: hashed 256-bit tokens, narrow projection (tested to exclude costs, profit, passport data), no-referrer
  and no-store headers, per-IP rate limits.
- AI: no tools, no write path, redacted context, review gate for generated itineraries.
- CSV export formula-injection guard; PDF output is generated from data, not HTML.

## Residual risks and recommendations (not done)

| Area | Recommendation |
|------|----------------|
| Authentication | Turn on **email confirmation** in Supabase (invitations trust the verified email). Set a minimum password length of 12. Consider MFA for owners/admins. |
| Uploads | No malware scanning. Acceptable while only staff upload; add scanning before customers can upload. |
| Key management | `ENCRYPTION_KEY` has no rotation procedure yet (the `v1:` prefix leaves room). Losing the key means agencies re-enter their Razorpay keys. |
| Monitoring | Alert on `amount_mismatch` webhook outcomes, repeated `login throttled` warnings and 5xx rates. |
| Data protection | No retention/erasure workflow yet (customer deletion requests, passport purge after travel). Needed for GDPR/DPDP. |
| Verification | A professional penetration test and a review against the real Supabase project (policies are tested on a local Postgres stand-in) before taking real customers. |
| Browser testing | The UI has not been exercised in a real browser. |
