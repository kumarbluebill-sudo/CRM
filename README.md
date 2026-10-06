# Smart Travel CRM

AI-powered CRM and itinerary management platform for travel agencies.
Multi-tenant SaaS on Next.js (App Router), TypeScript, Tailwind, shadcn/ui, Supabase and Vercel.

## Status

Phase 1 (foundation) complete. Auth, organizations, RLS and CRM modules follow in later phases.

## Local setup

```bash
npm install
cp .env.example .env.local   # Supabase values optional in Phase 1
npm run dev                  # http://localhost:3000
```

## Scripts

`dev`, `build`, `start`, `lint`, `typecheck`, `format`, `format:check`, `test`

## Notes

- Next.js 16: `middleware.ts` is now `proxy.ts`.
- shadcn style is `base-nova` (Base UI): use `render={...}` instead of `asChild`.
- Security baseline: see [docs/SECURITY.md](docs/SECURITY.md).
