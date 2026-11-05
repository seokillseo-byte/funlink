# FunLink Production Candidate — Readiness

## Candidate baseline

- Repository: `seokillseo-byte/funlink`
- Candidate branch: `release/funlink-production-candidate`
- Base: PR #17 commit `6ec6a0ddf9be26ca1467a8fb998a2cbf8498b758`
- Latest verified CI commit: `89213cd5543aa7b85f89d44be1111de8eef9e9f6`
- Draft review PR: #19
- Production branch `main` has not been changed.
- No Production deployment or database migration has been performed from this branch.

## Implemented on the candidate branch

- Workspace-scoped link list, create, update, pause/resume and archive API.
- HTTP/HTTPS destination validation, reserved-slug protection and workspace authorization.
- Audit log entries for link mutations and tenant-scoped operations.
- Public redirect API with click-event recording and optional keyed IP hashing.
- Next.js short-link route that forwards a slug to the API and returns the redirect.
- Custom-domain redirect lookup only when the domain is ACTIVE, TLS is ACTIVE and a domain-to-link slug mapping exists.
- Custom-domain list and slug-mapping create/delete APIs with workspace administrator checks and audit logging.
- Custom-domain dashboard, DNS TXT verification flow, and token rotation after failed verification.
- Link-management dashboard and dashboard navigation.
- Canonical site URL configuration, robots.txt and sitemap use `NEXT_PUBLIC_SITE_URL`.

## Verification completed

- [x] API foundation workflow passed on the latest verified commit.
- [x] Phase 1.0 SaaS foundation workflow passed on the latest verified commit.
- [x] Prisma schema validation and migrations passed against the isolated PostgreSQL service in CI.
- [x] Prisma Client generation passed.
- [x] API typecheck, build and tests passed.
- [x] Web typecheck and production build passed.
- [x] Vercel generated a Ready preview for Draft PR #19:
  `https://funlink-staging-web-git-release-fu-59125d-ai-builder-s-projects.vercel.app`
- [ ] Ubuntu Staging deployment and browser/API/database integration have not yet been verified.

## Still required before Production

1. Generate and commit `pnpm-lock.yaml`, then switch CI to frozen-lockfile installs.
2. Add further end-to-end tests for auth/session cookies, link expiry, redirects, domain ownership and cross-tenant access.
3. Implement TLS provisioning/renewal and reverse-proxy domain routing activation. A verified TXT record and saved slug mapping alone do not make a custom domain ready to serve traffic.
4. Add billing entitlement enforcement for custom domains and other paid features.
5. Complete campaign management and connect campaigns to link creation/editing.
6. Add QR-code generation and useful click analytics (date ranges, referrers, devices and exports).
7. Finish subscription entitlement enforcement and test real payment-provider credentials/webhooks in a non-production environment.
8. Audit CMS administration, published content, metadata, sitemap coverage and canonical URLs.
9. Run security/dependency review, migration rehearsal, Staging backup/restore test and end-to-end browser tests.
10. Deploy only to isolated Staging and obtain explicit approval before any Production release.

## Release policy

- `main`: canonical Production source only after an approved release.
- `release/*`: release candidates; never treated as live Production.
- Use immutable version tags for approved releases.
- Do not merge to `main`, delete historical branches, or deploy Production without explicit user approval.
