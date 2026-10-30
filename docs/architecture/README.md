# FunLink Architecture — Phase 0

## Decision
Use a modular monolith (single deployable API) with PostgreSQL as the source of truth. Keep redirect handling in the same application initially, but isolate it as a module so it can be extracted later. Do not introduce microservices before measured scaling needs justify them.

## Audit of current repository
- Runtime: dependency-free Node.js HTTP server, Node >=18.
- Persistence: `data/links.json` and `data/domains.json`; synchronous whole-file reads/writes.
- Link API: `GET/POST /api/links`; create-link endpoint currently shares global data.
- Domain API: `GET/POST /api/domains`, `POST /api/domains/verify`, `POST /api/domains/origin`.
- Redirects: root-level slug and `/r/:slug`; click count and bounded click log are synchronously written into JSON on each request.
- Admin guard: one environment-wide `FUNLINK_ADMIN_TOKEN` protects links/domains APIs. It is not end-user authentication or tenant isolation.
- Frontend: static HTML/JS. Dashboard includes sample/demo chart data, browser-local campaign/settings state, and an admin-token prompt. It calls the existing link/domain APIs for some actions.
- Deployment: systemd service on port 3012; existing reverse proxy / Cloudflare Tunnel must be preserved.

## Target runtime architecture
1. Web app: Next.js + TypeScript for public pages, customer dashboard, and admin UI.
2. API: Node.js + TypeScript + Fastify, organized by domain modules in one deployable service.
3. Database: PostgreSQL + Prisma. Every customer-owned row is tenant-scoped.
4. Queue/cache: Redis + BullMQ for click aggregation, webhook processing, email, and scheduled CMS jobs. Redirect must not wait for analytics aggregation.
5. Object storage: S3-compatible storage for media and exports.
6. Payments: provider adapter interface; SePay/VietQR first for Vietnam, Stripe adapter only when commercially/legalistically available. Verify signatures and process webhook events idempotently.
7. Deployment: Dockerized services and GitHub Actions, while retaining current production service until migration is rehearsed and approved.

## Module boundaries
- Identity: users, sessions, tenant memberships, roles.
- Workspace: tenants and plan entitlements.
- Links: slug allocation, destination validation, status, campaigns.
- Domains: ownership verification, routing status, TLS status, domain-to-tenant mapping.
- Redirect: host + slug lookup, fast 301/302 response, enqueue click event.
- Analytics: raw/aggregated events, reporting and exports.
- Billing: plans, subscriptions, invoices, payment attempts, provider webhooks.
- CMS/SEO: posts, categories, media, metadata, sitemap and schema.
- Platform operations: audit logs, abuse reports, admin moderation, system settings.

## Non-negotiable invariants
- Never trust a tenantId supplied by the browser; derive tenant context from the authenticated session and membership.
- Every tenant-owned read/write must include tenant scope. Add PostgreSQL row-level security in a later hardening migration after application-level scoping is covered by tests.
- Public slugs are globally unique for the primary domain. Custom-domain slugs are unique per domain; model this with a composite unique key.
- A custom domain can route only after ownership verification and an explicit active routing state.
- Payment activation is driven by verified provider events, never by a browser redirect or client-side success message.
- Webhook processing is idempotent using provider + provider event ID.
- Redirect path performs no synchronous analytics database aggregation.
- Preserve legacy link IDs/slugs and custom-domain records during migration. Never overwrite production JSON files during a rehearsal.
- Keep secrets out of Git. Use environment/secret manager at runtime.

## Migration strategy
1. Add PostgreSQL and Prisma in a separate feature branch; do not change production runtime yet.
2. Create schema and run migrations against an isolated development database.
3. Build a read-only importer for legacy JSON. Validate counts, duplicate slugs, invalid destinations, and domain records; produce a reconciliation report.
4. Run importer against a copy of production data. Compare source/target counts and sample redirect resolution.
5. Implement compatibility reads behind a feature flag; keep JSON as rollback source until explicit cutover approval.
6. Cut over during a planned maintenance window with a fresh backup, final delta import, smoke tests, and a documented rollback.
7. Remove JSON writes only after production verification and backup retention are confirmed.

## Phase 0 exit criteria
- Schema reviewed and accepted.
- Development database migration succeeds.
- Legacy import/reconciliation plan is testable.
- No production files, DNS, proxy, or service settings changed by Phase 0.
