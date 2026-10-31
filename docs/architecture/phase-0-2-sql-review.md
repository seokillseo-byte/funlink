# Phase 0.2 — Initial PostgreSQL SQL review

## Review target

- Source artifact: `funlink-initial-postgres-migration.zip` from workflow run 41160905401.
- ZIP SHA-256 verified locally: `a967547a0129e6bd4987302de75882da34f6c8e4cbb85a38bf1daa66c904e186`.
- SQL file: `0001_initial.sql`.
- The reviewed SQL was generated from code commit `d5cd07ca6b31c0e7607dd745f317e54a78b64c30`; it is a review artifact, not an approved production migration.

## Findings

### Blocking: tenant ownership was not enforced across billing foreign keys

The first generated SQL used:
- `Invoice.subscriptionId -> Subscription.id` without matching `tenantId`.
- `PaymentAttempt.invoiceId -> Invoice.id` without matching `tenantId`.

Because both child tables carry their own `tenantId`, a malformed service write could associate an invoice with another tenant's subscription, or a payment attempt with another tenant's invoice. The database would have accepted those cross-tenant references.

### Fix committed to the Phase 0.2 branch

- Add composite unique keys `Subscription(tenantId,id)` and `Invoice(tenantId,id)`.
- Change Invoice -> Subscription to composite `(tenantId,subscriptionId)` -> `(tenantId,id)`, with `ON DELETE RESTRICT`. The optional subscription must be explicitly detached before deleting a subscription; the required tenant key is never nulled.
- Change PaymentAttempt -> Invoice to composite `(tenantId,invoiceId)` -> `(tenantId,id)`, preserving `ON DELETE CASCADE`.
- Extend the PostgreSQL smoke test to prove that cross-tenant Invoice -> Subscription and PaymentAttempt -> Invoice references are rejected.

The fix is in commit `e4acd45fb19a1d601e3077811daabf6e3ff70b6b` (schema) and `b8f059933fbd069c7e0fc7057ffcb4e9009bcc77` (smoke test).

## Validation gate

New CI runs for the corrected HEAD:
- Prisma validation: [run 41161956410](https://github.com/seokillseo-byte/funlink/actions/runs/41161956410).
- PostgreSQL 16 migration integration: [run 41161956423](https://github.com/seokillseo-byte/funlink/actions/runs/41161956423).

Do not approve the initial SQL artifact. Once the corrected PostgreSQL workflow passes, download the new artifact, verify its checksum, and repeat this review against the corrected SQL. Only then prepare the versioned migration directory and replay test.

## Other reviewed behavior

- Tenant-aware composite foreign keys are present for campaign links, click events, custom-domain slug mappings, post categories and post media.
- The SQL preserves the intentional Restrict behavior for optional composite references to Category and Post.
- Invoice snapshot fields are JSONB columns, but immutability is not enforced by the SQL schema alone. A service/database policy and tests remain required.
- Domain verification token hash storage is represented in the schema; generation, expiry, and constant-time comparison are application responsibilities and remain unverified.
- Webhook signature verification is not supplied by the table definition and remains an application responsibility.
- The first corrected SQL review exposed destructive tenant-to-billing cascades. The current branch changes Tenant -> Subscription, Tenant -> Invoice, Tenant -> PaymentAttempt, Invoice -> PaymentAttempt and Subscription -> Invoice delete behavior to Restrict. Tenant closure should use the existing `CLOSED` status; physical deletion is blocked while financial records remain. Smoke tests now assert these restrictions. This retention-safe revision still needs the current PostgreSQL 16 workflow to pass and the new artifact to be reviewed.

## Safety decision

The first SQL artifact is rejected for migration commitment because of the billing tenant-isolation gaps above. The corrected schema and tests must pass CI and the newly generated SQL must be reviewed before any versioned migration is committed. No production database or legacy JSON has been touched.


## Billing retention hardening (follow-up)

- Schema commit: `1dd3ba5e833daa6fad86dc404465c16882a26e92`.
- Smoke-test commit: `2d41de16954cdb112a846f5e0ae51b966894d66d`.
- Tenant, subscription, invoice and payment-attempt deletion paths now use restrictive behavior so financial history is not removed by cascading deletes.
- Regression tests cover deleting a subscription with invoices, an invoice with payment attempts, and a tenant with billing records.
- Latest CI for this revision: Prisma run [41162118561](https://github.com/seokillseo-byte/funlink/actions/runs/41162118561); PostgreSQL 16 run [41162118613](https://github.com/seokillseo-byte/funlink/actions/runs/41162118613). Results must be checked before approval.


## Versioned migration and replay validation

- Versioned migration committed on the Phase 0.2 branch: `prisma/migrations/20261031030000_init/migration.sql`.
- Prisma migration lock committed: `prisma/migrations/migration_lock.toml`.
- CI now generates SQL from `prisma/schema.prisma`, compares normalized SQL statements against the committed migration, applies the committed migration with `prisma migrate deploy` to disposable PostgreSQL 16, verifies the migration history row, then runs tenant/billing smoke tests.
- Latest Prisma validation: [run 41162395450](https://github.com/seokillseo-byte/funlink/actions/runs/41162395450) — success.
- Latest PostgreSQL 16 SQL comparison, versioned migration replay and tenant/billing smoke tests: [run 41162395421](https://github.com/seokillseo-byte/funlink/actions/runs/41162395421) — success.
- The latest generated SQL artifact digest is `sha256:9fe73cbb30892706e7c10b2f776b1b6bb0283edf7ee53e168669a91252f24e70`; it is retained until 14 November 2026. The committed migration is the canonical source for future deploys.

## Remaining application-level gates

The migration validates the database shape and tenant constraints only. It does not implement or prove domain token generation/expiry/constant-time verification, webhook signature verification, or invoice snapshot immutability. These remain blocking Phase 0.2 work. The legacy JSON importer is also not implemented because the current branch contains no legacy JSON data files or importer source to inspect; its dry-run/reconciliation/rollback design is recorded in the Phase 0.4 runbook.
