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
