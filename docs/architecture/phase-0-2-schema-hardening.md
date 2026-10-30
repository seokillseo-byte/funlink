# Phase 0.2 — Schema hardening and migration readiness

## Scope

This phase hardens the proposed Prisma model before any production migration. It does not connect to the production host, change DNS/systemd/proxy settings, import legacy JSON, or touch production data.

## Changes in this branch

- Replace free-form user, tenant, TLS, plan interval and webhook state strings with enums.
- Add composite tenant-aware foreign keys for domain-to-link slug mappings, click events, campaign links, post categories and post media. These constraints prevent accidentally joining records owned by different tenants.
- Replace the domain verification token with `verificationTokenHash`; generate a high-entropy token in the application, show it once, and persist only a keyed hash.
- Add subscription provider identity, trial and cancellation timestamps.
- Add immutable invoice plan/line-item snapshots.
- Add payment idempotency key.
- Add webhook signature-verification timestamp, processing state, received timestamp and failure reason.
- Keep API keys as hashes only; never persist the raw key.

## Required application invariants

1. Every request resolves an authenticated user and an authorized tenant membership before querying tenant data.
2. Never accept `tenantId` as authorization from an untrusted request body.
3. Click ingestion derives tenant ownership from the resolved Link; `ipHash` must be HMAC-SHA-256 using a rotating server secret, never a plain hash of the IP.
4. Webhook handlers verify provider signatures against the raw request body, enforce unique provider event IDs, and process events idempotently. Browser redirect/return URLs are not proof of payment.
5. Invoice snapshots are immutable after issue; changing a Plan must not rewrite historical invoices.
6. Entitlements are parsed and validated against a versioned server-side schema. Never trust arbitrary JSON supplied by the client.
7. Domain verification tokens are random, single-purpose, expire, and are compared using constant-time verification after hashing.
8. Composite tenant foreign keys are defense in depth; service-layer authorization remains mandatory.

## Migration plan (not yet executed)

1. Pin a supported Prisma CLI/client version in the application workspace.
2. Run `prisma format` and `prisma validate` in CI against this schema.
3. Resolve any Prisma relation validation issues before generating SQL.
4. Generate an initial migration against a disposable PostgreSQL database, not the production database.
5. Review generated SQL for composite foreign keys, indexes, enum changes and delete behavior.
6. Run migration up/down or restore-from-snapshot tests against disposable databases.
7. Add seed fixtures for two tenants and verify cross-tenant references are rejected.
8. Only after tests pass, design a separate legacy JSON import with dry-run, reconciliation report, idempotency and rollback.

## Known migration considerations

- Existing domains currently store a raw verification token in the draft schema. A real deployment must generate fresh verification tokens and store hashes; do not blindly copy raw tokens.
- Existing invoices need a historical snapshot policy. Do not invent missing plan details; preserve available amounts and mark unknown snapshot fields explicitly.
- Existing click events must be assigned tenant IDs from their owning links, not inferred from user input.
- Unique global `Link.slug` is retained for the default short host. Custom host slugs are unique by `domainId + slug`.
- Composite optional relations use restrictive deletion behavior where the tenant key itself is required. The service must explicitly detach/reassign optional records before deleting their parent.

## Validation status

**Not yet validated by Prisma CLI and no SQL migration has been generated or applied.** This repository snapshot currently contains architecture/schema artifacts only; the migration must be generated when the application workspace and pinned Prisma toolchain are added. This PR is a reviewable design hardening step, not a production-ready database rollout.
