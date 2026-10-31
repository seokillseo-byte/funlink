# Phase 0.2 — Tenant isolation and billing review checklist

- [ ] Prisma schema formatting and validation passes with pinned toolchain.
- [x] PostgreSQL fixture proves cross-tenant LinkDomainSlug insert fails.
- [x] PostgreSQL fixture proves ClickEvent cannot point to another tenant's Link.
- [x] PostgreSQL fixture proves Link cannot reference another tenant's Campaign.
- [x] PostgreSQL fixture proves Post cannot reference another tenant's Category.
- [x] PostgreSQL fixture proves MediaAsset cannot reference another tenant's Post.
- [ ] Domain verification persists only a token hash.
- [x] PostgreSQL fixture proves duplicate payment idempotency keys are rejected.
- [x] PostgreSQL fixture proves duplicate provider event IDs are rejected at the database constraint.
- [ ] Invalid webhook signature cannot change invoice/subscription state.
- [ ] Invoice snapshot remains unchanged after plan price/entitlements change.
- [x] No migration is run against production during this phase.
- [x] PostgreSQL fixture proves referenced Category/Post deletion is restricted until the optional relation is explicitly detached.
- [ ] CI schema validation and PostgreSQL integration workflow pass.
- [ ] Domain verification service stores only a hash and validates expiry/constant-time comparison.
- [ ] Webhook handler verifies raw-body signatures before any payment/subscription mutation.
- [ ] Invoice snapshot immutability is enforced and tested in the billing service.
