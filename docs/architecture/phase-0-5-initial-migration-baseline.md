# Phase 0.5 — Initial migration baseline

## Goal
Turn the reviewed Prisma schema into the first versioned PostgreSQL migration and prove that the migration history is repeatable and matches the schema.

## Scope
- PostgreSQL migration provider lock file.
- Versioned initial migration under `prisma/migrations/0001_initial/`.
- Apply migrations to a disposable PostgreSQL 16 database using `prisma migrate deploy`.
- Run deployment a second time to prove it is a no-op.
- Run tenant-isolation smoke tests after migration.
- Compare the migration history to `prisma/schema.prisma` using Prisma's shadow database drift check.

## Safety
- CI uses disposable PostgreSQL service containers only.
- No production DATABASE_URL, VPS, live JSON data, or production credentials are used.
- This phase does not run migrations against production and does not import legacy data.
- Do not run `prisma migrate deploy` against production until a separately reviewed deployment and backup plan is approved.

## Local reproduction
Use two disposable PostgreSQL databases: one application database and one shadow database. Set `DATABASE_URL`, `PSQL_DATABASE_URL`, `SHADOW_DATABASE_URL`, and `PGPASSWORD`, then run:

```bash
pnpm install
pnpm db:validate
pnpm db:generate
pnpm exec prisma migrate deploy
pnpm exec prisma migrate deploy
bash scripts/db/smoke-test.sh
bash scripts/db/check-migration-drift.sh
```

## Acceptance
- The committed migration applies to an empty PostgreSQL database.
- A second deploy succeeds without applying additional migrations.
- Tenant-scoped foreign keys reject cross-tenant references.
- Drift check exits successfully.
- GitHub Actions latest run is green.
