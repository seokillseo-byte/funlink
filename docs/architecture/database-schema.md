# FunLink PostgreSQL Data Model — Draft 1

This is the logical model for the first SaaS foundation. PostgreSQL is authoritative; tenant-owned records carry `tenantId`. Prisma schema is maintained at `prisma/schema.prisma`.

## Identity and tenancy
- User has a unique normalized email and password hash.
- Session stores only a hash of the opaque session token, expiry and revocation timestamp.
- Tenant is a customer workspace; TenantMember joins users to workspaces and carries a role.
- A user may belong to multiple tenants. Active tenant is selected server-side and verified against membership on every request.

## Links and domains
- Link belongs to a tenant; slug is globally unique for the default FunLink host.
- Domain belongs to a tenant; domain name is globally unique.
- Domain verification and routing are separate states. Verification alone never enables routing.
- LinkDomainSlug supports a slug unique within a custom domain without changing the globally unique primary slug.

## Click analytics
- ClickEvent is append-only and may be partitioned by time after volume requires it.
- Store coarse/refined attribution only when lawful and necessary. Do not store full IP addresses by default; use a short-lived keyed hash or coarse geo enrichment with a documented retention policy.
- Redirect enqueues events; reporting reads pre-aggregated data when volume grows.

## Billing
- Plan defines entitlements; Subscription records current lifecycle state and period.
- Invoice is the commercial record; PaymentAttempt records provider transactions.
- WebhookEvent has unique (provider, providerEventId) for idempotency.
- Subscription state changes only after server-side verified payment/provider events or explicit admin action with audit log.

## CMS / SEO
- Post and Category are tenant-owned initially; public blog content can later support a platform-level tenant/system scope.
- SeoMetadata is one-to-one with a post; MediaAsset records object-storage metadata.
- Publishing, sitemap generation and indexing checks run as background jobs, not in request handlers.

## Indexes and constraints
- Unique normalized email, session token hash, tenant membership, primary slug, domain hostname, provider event identity.
- Index tenantId + createdAt on high-traffic tenant-owned tables.
- Index redirect lookup keys and click event timestamps.
- Add check constraints in SQL migrations for valid enum/state transitions where Prisma cannot express them.
- Never rely on UI validation as a data integrity boundary.

## Deliberately deferred
- Microservices, Kafka, ClickHouse, multi-region replication, advanced RBAC, enterprise SSO, and complex metered billing. Add only when traffic or customer requirements justify them.
