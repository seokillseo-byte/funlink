# Phase 0.4 — PostgreSQL migration integration test

## Scope

- Uses a disposable PostgreSQL 16 service container inside GitHub Actions.
- Generates the initial SQL migration from the reviewed Prisma data model using the pinned Prisma 6.19.0 CLI.
- Applies that SQL to an empty CI database with `ON_ERROR_STOP=1`.
- Checks that the expected application tables exist.
- Verifies that composite tenant-scoped foreign keys reject cross-tenant campaign, click-event, domain/link mapping, post/category and media/post references.
- Verifies restrictive deletion of referenced Category and Post rows.
- Compares the generated SQL statements with the committed versioned migration (ignoring whitespace/comments).
- Applies the committed migration through `prisma migrate deploy` to a fresh PostgreSQL 16 database and verifies its `_prisma_migrations` record.
- Uploads generated schema SQL as a short-lived audit artifact.

## Latest validation

- Prisma validation: [run 41160905408](https://github.com/seokillseo-byte/funlink/actions/runs/41160905408) — success.
- PostgreSQL 16 integration: [run 41160905401](https://github.com/seokillseo-byte/funlink/actions/runs/41160905401) — success.
- Artifact: `funlink-initial-postgres-migration`, ID `13026703905`, SHA-256 `a967547a0129e6bd4987302de75882da34f6c8e4cbb85a38bf1daa66c904e186`.
- Artifact retention is temporary (14 days); retrieve and review it before expiry. It is not yet a committed migration.

## Safety

- This workflow does not connect to the VPS, production database, or legacy JSON files.
- No production secrets or database credentials are used.
- The generated SQL artifact is a review output, not yet a committed production migration.
- Do not run `prisma migrate deploy` against production as part of this phase.

## SQL review gate

1. Retrieve the CI artifact and inspect every statement, enum, index, unique constraint, foreign key and delete action.
2. Compare the generated SQL with `prisma/schema.prisma`; specifically verify all composite tenant foreign keys and the Restrict/Cascade behavior.
3. Check that the migration is additive for the new SaaS database and does not assume legacy JSON data already exists in PostgreSQL.
4. Commit the reviewed SQL under Prisma's versioned migration directory with its migration lock file.
5. Add CI replay tests using `prisma migrate deploy` against a fresh disposable PostgreSQL 16 database, then run the tenant smoke tests.
6. Only after a separate approval and backup/restore rehearsal may a production cutover be planned.

## Legacy JSON import — preparation plan (no importer run)

### Source inventory and freeze

- Read the legacy JSON files in read-only mode; never modify or delete the source files.
- Record source file names, byte sizes, SHA-256 checksums, parse status, record counts and the capture timestamp.
- Create a stable mapping for each legacy entity ID/slug to its destination ID. Preserve existing link slugs and domain hostnames exactly.
- Resolve click ownership through the legacy link record; never infer tenant ownership from a request-supplied tenant ID.
- Treat missing or ambiguous ownership, duplicate slugs, malformed URLs and orphaned records as explicit exceptions. Do not silently discard or fabricate values.
- For legacy domain verification secrets, do not copy raw tokens into the new schema. Mark the domain as requiring fresh verification and store only a newly generated token hash after the verification workflow exists.

### Dry-run mode

- The importer must default to dry-run and require an explicit `--apply` flag for writes.
- Dry-run parses and validates every source file, computes the destination mapping, and emits a machine-readable JSON report plus a human-readable summary.
- Report per entity type: source count, valid count, planned inserts, planned updates, skipped duplicates, orphaned records, invalid records and conflicts.
- Include a deterministic source checksum and importer version in the report. Re-running an unchanged dry-run must produce the same mapping and counts.
- Dry-run must use read-only database access and must not create tenants, links, domains, click events or migration bookkeeping rows.
- Stop apply if unresolved blocking errors exist or if source checksums differ from the approved dry-run report.

### Apply and reconciliation

- Import into a separate, empty staging database first; do not point the importer at production.
- Use deterministic idempotency keys based on source system + legacy record ID. A retry must update/skip the same imported record, never duplicate it.
- Import in dependency order: tenants/memberships, campaigns, links, domains and domain-slug mappings, then click events and other dependent records.
- Preserve legacy link IDs where compatible; otherwise maintain a permanent legacy-to-new ID map. Preserve slugs and target URLs exactly after validation.
- Reconcile source and destination counts by entity type, distinct IDs, slug/domain uniqueness, click totals, orphan counts and financial totals where applicable.
- Produce a signed-off reconciliation report with source checksums, destination snapshot identifier, inserted/updated/skipped/error counts and all exceptions. Require zero unexplained differences before cutover.

### Rollback and cutover

- Preferred rollback is to discard the isolated staging database and rebuild it from the unchanged JSON source plus the approved report.
- Before any eventual production cutover, take a database snapshot and preserve a verified copy of all legacy JSON files; rehearse restore into a separate database.
- Keep the legacy service and JSON files read-only and available during a controlled cutover window. Do not dual-write unless a separately tested change-capture mechanism is approved.
- Use a feature flag or routing switch for cutover. If health checks or reconciliation fail, switch traffic back to the legacy runtime and restore the pre-cutover database snapshot.
- Do not delete legacy files or retire the old runtime until post-cutover validation and a defined observation period are complete.
- No production import, cutover or rollback has been executed by this preparation plan.

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


## Committed migration status

- Migration: `prisma/migrations/20261031030000_init/migration.sql`.
- Lock file: `prisma/migrations/migration_lock.toml`.
- Latest successful Prisma validation: [41162395450](https://github.com/seokillseo-byte/funlink/actions/runs/41162395450).
- Latest successful PostgreSQL 16 migration comparison/replay and smoke test: [41162395421](https://github.com/seokillseo-byte/funlink/actions/runs/41162395421).
- No production migration has been run.
