# Phase 0.2 — Domain verification service

## API
- `POST /v1/workspaces/:tenantId/domains`: create a pending domain and return its DNS TXT record value once.
- `POST /v1/workspaces/:tenantId/domains/:domainId/verification/rotate`: replace an unverified/failed token and invalidate the previous value.
- `POST /v1/workspaces/:tenantId/domains/:domainId/verify`: resolve the TXT record and verify ownership.

All routes require a valid, non-revoked session, a verified active user, an active workspace membership, and OWNER/ADMIN role. Domain reads and writes are scoped by both `tenantId` and `domainId`; a workspace ID supplied by the browser is never trusted without membership lookup.

## Security controls
- Generate a 256-bit cryptographically random base64url token.
- Store only SHA-256 token hashes. The raw value is returned once in the create/rotate response and is never logged.
- TXT record name: `_funlink-verification.<hostname>`.
- Token expires after 24 hours; expiry is persisted.
- Compare candidate and stored token hashes with Node.js `timingSafeEqual`.
- Persist failed verification attempts and lock the token after five failures; rotating creates a new token and resets the counter.
- Add a per-user/domain process-local request throttle as an additional layer.
- Successful verification atomically claims the pending token, sets `verifiedAt`, clears the hash/expiry, and changes status to `VERIFIED`, preventing replay.
- DNS provider errors return a retryable 503 and do not consume an ownership attempt.

## Routing boundary
Verification only moves a domain to `VERIFIED`. It does not enable redirect routing or TLS. Routing remains a separate lifecycle transition and must require an explicitly active/ready domain.

## Database and validation
Migration `0005_domain_verification_lifecycle` makes the token hash nullable after successful one-time use, adds expiry and persistent attempt count, and indexes the pending verification lifecycle. The Phase 1.0 CI workflow now replays all committed migrations on a disposable PostgreSQL 16 service before generating Prisma Client and running API typecheck/build/tests.

## Scope and safety
This implementation is on `phase/0-2-domain-verification`, based on the API foundation branch `saas/phase-1-0-auth-workspaces` because PR #9 contains schema/migration work but not the Fastify API. It is intended to be integrated with the hardened schema from PR #9 before the overall Phase 0.2 sign-off. No production DNS, VPS, database, or live domain is queried or changed by CI.
