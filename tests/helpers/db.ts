import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * Embedded Postgres that mimics the parts of Supabase our policies depend on:
 * auth.users, auth.uid() (reads request.jwt.claim.sub like PostgREST) and the
 * anon/authenticated roles. All real migrations are applied in order.
 */
export const SUPABASE_STUB = `
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'unverified',
  factor_type text not null default 'totp'
);
create role anon nologin;
create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  const dir = path.resolve(import.meta.dirname, "../../database/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

export async function createUser(db: PGlite, email: string, fullName = email): Promise<string> {
  const res = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: fullName })],
  );
  return res.rows[0].id;
}

/** Runs fn as an authenticated API user (RLS applies). Pass null for the anon role. */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  fn: (db: PGlite) => Promise<T>,
  aal: "aal1" | "aal2" = "aal1",
): Promise<T> {
  await db.exec(
    userId
      ? `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false); select set_config('request.jwt.claims', '{"sub":"${userId}","aal":"${aal}"}', false);`
      : `set role anon; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '{}', false);`,
  );
  try {
    return await fn(db);
  } finally {
    await db.exec("reset role;");
  }
}

export async function setupTenant(db: PGlite, label: string) {
  const userId = await createUser(db, `${label}@example.test`, `Owner ${label}`);
  const orgId = await asUser(db, userId, async (d) => {
    const r = await d.query<{ create_organization: string }>(
      "select public.create_organization($1)",
      [`Agency ${label}`],
    );
    return r.rows[0].create_organization;
  });
  return { userId, orgId };
}

/** True if the statement throws (e.g. permission denied / RLS violation / FK violation). */
export async function fails(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
