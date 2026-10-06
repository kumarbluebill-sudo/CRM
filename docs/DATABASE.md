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
