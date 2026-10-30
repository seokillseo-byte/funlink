# Phase 0.4 — PostgreSQL migration integration test

## Scope

- Uses a disposable PostgreSQL 16 service container inside GitHub Actions.
- Generates the initial SQL migration from the reviewed Prisma data model using the pinned Prisma 6.19.0 CLI.
- Applies that SQL to an empty CI database with `ON_ERROR_STOP=1`.
- Checks that the expected application tables exist.
- Verifies that composite tenant-scoped foreign keys reject cross-tenant campaign and click-event references.
- Uploads the generated `0001_initial.sql` as a short-lived workflow artifact for review.

## Safety

- This workflow does not connect to the VPS, production database, or legacy JSON files.
- No production secrets or database credentials are used.
- The generated SQL artifact is a review output, not yet a committed production migration.
- Do not run `prisma migrate deploy` against production as part of this phase.

## Review gate

1. Confirm the GitHub Actions migration integration job is green.
2. Download and review the `funlink-initial-postgres-migration` artifact.
3. After SQL review, commit the reviewed SQL as the first versioned migration and add migration replay checks.
4. Design legacy JSON import separately; do not import production data yet.

## Local reproduction

Start an isolated PostgreSQL 16 database, set `DATABASE_URL` and `PGPASSWORD`, then run:

```bash
pnpm install
pnpm db:validate
pnpm db:generate
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > 0001_initial.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0001_initial.sql
bash scripts/db/smoke-test.sh
```
