# Row-Level Security (RLS)

This document describes the RLS setup introduced in Task 8 of Phase 2, and what needs to happen to actually enforce it against the running application.

## What's in place today

All 14 tenant-scoped tables have an RLS policy named `tenant_isolation`:

- `tenants` (using `id`)
- `activities`, `audit_log`, `entity_types`, `field_definitions`, `layouts`, `record_relationships`, `records`, `relationships`, `roles`, `tenant_invitations`, `tenant_memberships`, `tenant_modules`, `validation_rules` (all using `tenant_id`)

The policy:

```sql
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR <tenant_id_column> = current_setting('app.current_tenant_id', true)::uuid
)
WITH CHECK (...same...)
```


RLS is **enabled and forced** on each table — `FORCE ROW LEVEL SECURITY` means even the table owner is subject to the policy.

The migration that creates them: [`packages/database/sql/001-enable-rls.sql`](../packages/database/sql/001-enable-rls.sql).

`role_permissions` is deliberately *not* protected — it has no `tenant_id` column, and its data is meaningless without joining through `roles` (which IS protected).

## The gap: superuser bypass

The local dev `DATABASE_URL` connects as `jamesfoley`, which is a PostgreSQL **superuser**. Superusers bypass RLS unconditionally, regardless of `FORCE`. So the policies are **configured but not enforced against the application today.**

This is deliberate for Phase 2 — switching the app to a non-superuser role requires refactoring the ~44 query sites currently using the bare `db` client to instead route through `withTenant()` / `withSuperAdminBypass()`. That refactor is its own task.

## Helpers

`packages/database/src/client.ts` exports:

- `withTenant(tenantId, callback)` — opens a transaction, sets `SET LOCAL app.current_tenant_id = '<id>'`, runs the callback. Use this for any tenant-scoped query.
- `withSuperAdminBypass(callback)` — opens a transaction, sets `SET LOCAL app.bypass_rls = 'on'`, runs the callback. Use ONLY for `/super-admin` and other code paths that legitimately need cross-tenant visibility.

Both use `SET LOCAL`, so the setting auto-resets on transaction commit/rollback.

## Verifying RLS works locally

A dedicated non-superuser role exists for testing: `adserve_rls_test` (password: `rls_test_password`). It has CRUD privileges on the protected tables but neither `SUPERUSER` nor `BYPASSRLS`.

To verify:

```bash
TEST_DSN="postgresql://adserve_rls_test:rls_test_password@localhost:5432/adserve"

# 1. No session variable set → 0 rows
psql "$TEST_DSN" -c "SELECT count(*) FROM roles"

# 2. With tenant context → only that tenant's rows
psql "$TEST_DSN" -c "BEGIN; SET LOCAL app.current_tenant_id = '<some-tenant-uuid>';
  SELECT count(*) FROM roles; COMMIT;"

# 3. With bypass → all rows
psql "$TEST_DSN" -c "BEGIN; SET LOCAL app.bypass_rls = 'on';
  SELECT count(*) FROM roles; COMMIT;"

# 4. Cross-tenant INSERT is blocked
psql "$TEST_DSN" -c "BEGIN; SET LOCAL app.current_tenant_id = '<tenant-a>';
  INSERT INTO roles (tenant_id, name, slug) VALUES ('<tenant-b>', 'sneaky', 'sneaky');
  ROLLBACK;"
# → ERROR: new row violates row-level security policy for table "roles"
```


## Production switchover (separate task)

To enforce RLS against the application, three things need to happen:

### 1. Create an application role

Replace `adserve_rls_test` (or model on it) with a production role:

```sql
CREATE ROLE adserve_app LOGIN PASSWORD '<strong-secret>' NOSUPERUSER NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO adserve_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO adserve_app;
```


Set `DATABASE_URL=postgresql://adserve_app:<secret>@host/adserve` for the app deployment. Keep a separate superuser DSN for migrations (`drizzle-kit push`, seeds) — `DATABASE_MIGRATION_URL` or similar.

### 2. Refactor every query site

Roughly 24 tenant-admin and 20 super-admin query sites today use the bare `db` client. They must route through:

- `withTenant(ctx.tenant.id, async (tx) => { ... })` — for tenant pages and APIs
- `withSuperAdminBypass(async (tx) => { ... })` — for `/super-admin` and `/api/super-admin`

A tenant-scoped query that doesn't set `app.current_tenant_id` will return 0 rows under the production role. A super-admin query that doesn't set `app.bypass_rls` will be tenant-isolated (and likely empty since super admins have no tenant context).

### 3. Audit super-admin paths

Every super-admin page and API needs `withSuperAdminBypass`. Anything that's currently doing a `db.select()` against a tenant-scoped table needs the wrapper.

## Notes

- `withSuperAdminBypass` is a powerful primitive. Treat its use as security-sensitive code — anyone with this wrapped in their code path can read across tenants.
- The session variables use `, true` (the `missing_ok` parameter) inside the policies, so a connection that never sets them gets the default behaviour: `current_setting(...)` returns the empty string, which fails the comparison, which means 0 rows visible.
- `WITH CHECK` is included on every policy so writes are also constrained — you can't INSERT or UPDATE a row that would violate the policy. This blocks "forge a `tenant_id`" attacks.
