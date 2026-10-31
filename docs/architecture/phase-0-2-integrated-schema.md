# Phase 0.2 — Integrated API and hardened schema

## Single migration lineage
The API foundation branch originally carried its own initial schema migration while the schema-integrity PR carried a second initial migration under a timestamped directory. Keeping both would create duplicate-table failures on a fresh database.

The integration branch therefore uses one lineage:
1. `0001_initial` is replaced with the reviewed hardened baseline from the schema-integrity work.
2. `0002_user_profile_and_cms`, `0003_auth_tokens`, and `0004_workspace_invitations` remain additive API migrations.
3. `0005_domain_verification_lifecycle` remains additive for one-time domain TXT token expiry/attempt tracking.
4. `0006_invoice_snapshot_immutability` remains additive for the PostgreSQL invoice guard trigger.

The timestamped duplicate initial migration from the schema-only branch is intentionally not carried into the integrated tree. This avoids two initial migrations creating the same tables.

## Schema invariants carried forward
- Subscription, Invoice and PaymentAttempt tenant foreign keys use RESTRICT to preserve billing history.
- Invoice -> Subscription uses the composite `(tenantId, subscriptionId)` relation.
- PaymentAttempt -> Invoice uses the composite `(tenantId, invoiceId)` relation.
- Subscription and Invoice expose composite unique keys required by those foreign keys.
- Category -> Post and Post -> MediaAsset deletion rules are RESTRICT where the child relationship is required to be detached/reassigned explicitly.
- Domain verification expiry index and lifecycle fields remain present.
- API-only UserProfile, SitePage, AuthToken and WorkspaceInvitation models/migrations remain in the same schema.

## Verification
The disposable PostgreSQL migration workflow deploys the full committed chain and runs smoke tests for cross-tenant invoice/subscription and payment/invoice references, restrictive deletion of billing records and editorial parents, and invoice snapshot immutability. The migration baseline workflow also runs drift checks and repeated deploy.

## Migration safety
This integration rewrites only the not-yet-released initial migration on a draft branch so the final history is coherent. It must not be applied to any database where the earlier `0001_initial` migration has already been recorded. Before any shared/staging database use, inspect its `_prisma_migrations` history and create a separately reviewed forward-only reconciliation migration if needed. Production remains untouched.
