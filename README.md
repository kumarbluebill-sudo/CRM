# Smart Travel CRM

AI-powered CRM and itinerary management platform for travel agencies.
Multi-tenant SaaS on Next.js (App Router), TypeScript, Tailwind, shadcn/ui, Supabase and Vercel.

## What it does

Leads and customers, itinerary builder and document import, quotations with branded PDFs, bookings and operations
(passengers, suppliers, vouchers, private documents), payments (manual and Razorpay) with invoices and receipts,
email and WhatsApp messaging with draft automation, a customer portal, an AI assistant, reports with CSV export,
subscription plans with limits, team management, and an audit log.

## Status

All 15 phases are implemented and tested locally (unit tests, plus row-level-security integration tests on an embedded
Postgres). It has **not** been run against live Supabase, Razorpay, Resend or OpenAI accounts or in a real browser.
Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), including the smoke tests, before taking real customers.

## Local setup

```bash
npm install
cp .env.example .env.local     # every integration is optional locally; the app runs without Supabase configured
npm run dev                    # http://localhost:3000
```

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` / `format:check` | Static checks |
| `npm test` | Unit + integration tests (embedded Postgres, no credentials needed) |
| `npm run verify` | lint + typecheck + test + build (what CI runs) |
| `npm run db:status` / `db:migrate` | Show / apply database migrations (needs `DATABASE_URL`) |
| `npm run check-env` | Validate production environment variables (prints names only) |

## Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Supabase, Vercel, third-party setup, smoke tests, go-live checklist
- [docs/RUNBOOK.md](docs/RUNBOOK.md): incidents, reconciliation queries, backups, secret rotation
- [docs/SECURITY.md](docs/SECURITY.md) and [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md): security model, audit findings, residual risk
- [docs/DATABASE.md](docs/DATABASE.md): schema notes per phase

## Notes for developers

- Next.js 16: `middleware.ts` is now `proxy.ts`; `params` and `searchParams` are async.
- shadcn style is `base-nova` (Base UI): use `render={...}` instead of `asChild`.
- Tenant isolation is enforced by Postgres RLS, not by application code. New tables must `enable row level security`
  and use `public.apply_tenant_policies(...)`; `tests/integration/security-invariants.test.ts` fails if you forget.
- Never edit an applied migration; add a new one.
