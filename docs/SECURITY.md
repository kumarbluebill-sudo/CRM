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
