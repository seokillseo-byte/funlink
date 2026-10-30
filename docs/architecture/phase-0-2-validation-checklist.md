# Phase 0.2 — Tenant isolation and billing review checklist

- [ ] Prisma schema formatting and validation passes with pinned toolchain.
- [ ] Two-tenant fixture proves cross-tenant LinkDomainSlug insert fails.
- [ ] Two-tenant fixture proves ClickEvent cannot point to another tenant's Link.
- [ ] Two-tenant fixture proves Link cannot reference another tenant's Campaign.
- [ ] Two-tenant fixture proves Post cannot reference another tenant's Category.
- [ ] Two-tenant fixture proves MediaAsset cannot reference another tenant's Post.
- [ ] Domain verification persists only a token hash.
- [ ] Payment creation requires a unique idempotency key.
- [ ] Duplicate provider webhook event is safely ignored.
- [ ] Invalid webhook signature cannot change invoice/subscription state.
- [ ] Invoice snapshot remains unchanged after plan price/entitlements change.
- [ ] No migration is run against production during this phase.
