# FunLink Production Candidate — Readiness

## Candidate baseline

- Repository: `seokillseo-byte/funlink`
- Candidate branch: `release/funlink-production-candidate`
- Base: PR #17 commit `6ec6a0ddf9be26ca1467a8fb998a2cbf8498b758`
- Production branch `main` has not been changed.
- No Production deployment or database migration has been performed from this branch.

## Implemented on the candidate branch

- Workspace-scoped link list, create, update, pause/resume and archive API.
- HTTP/HTTPS destination validation and custom slug validation.
- Workspace membership checks and audit log entries for link mutations.
- Public redirect API with click event recording and optional keyed IP hashing.
- Next.js short-link route that forwards a slug to the API and returns the redirect.
- Custom-domain redirect lookup when the domain is ACTIVE, TLS is ACTIVE and a domain-to-link slug mapping exists.
- Dashboard link management screen.
- Canonical site URL configuration, robots.txt and sitemap use `NEXT_PUBLIC_SITE_URL` (defaults to `https://funlink.io.vn`).

## Still required before Production

1. Generate and commit `pnpm-lock.yaml`, then switch CI to frozen-lockfile installs.
2. Add automated tests for link list/update/archive, authorization boundaries, expiry and custom-domain resolution.
3. Complete custom-domain mapping management APIs and UI.
4. Implement and verify TLS provisioning/renewal and domain routing activation. A verified TXT record alone does not make a domain ready to serve traffic.
5. Complete campaign management and connect campaigns to link creation/editing.
6. Add QR-code generation and useful click analytics (date ranges, referrers, devices and exports).
7. Finish subscription entitlement enforcement and test real payment-provider credentials/webhooks in a non-production environment.
8. Audit CMS administration, published content, metadata, sitemap coverage and canonical URLs.
9. Run security review, dependency review, migration rehearsal, backup/restore test and end-to-end browser tests.
10. Deploy only to isolated Staging and obtain explicit approval before any Production release.

## Release policy

- `main`: the single canonical Production source after an approved release.
- `staging`: integration branch for tested work.
- `feature/*`: short-lived feature work.
- `release/*`: release candidates only; never treated as live Production.
- Use immutable version tags for approved releases.
- Do not delete historical branches as part of this cleanup.
