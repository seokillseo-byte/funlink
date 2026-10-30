# Phase 1.0 authentication and security configuration

## Required environment

Configure these on the API service (never commit real values):

- `DATABASE_URL`: PostgreSQL connection string.
- `CORS_ORIGINS`: comma-separated exact frontend origins, e.g. `https://app.example.com`.
- `APP_BASE_URL`: public frontend origin, e.g. `https://app.example.com`.
- `RESEND_API_KEY`: Resend API key.
- `EMAIL_FROM`: verified sender, e.g. `FunLink <no-reply@example.com>`.
- `FUNLINK_CMS_ADMIN_EMAILS`: comma-separated platform CMS administrator emails.

The email provider must have the sender domain verified. Registration sends a 24-hour one-time verification link. Password reset links expire after one hour and are single-use. Password reset revokes all active sessions for that account.

## Routes

- `POST /v1/auth/register`
- `POST /v1/auth/verify-email`
- `POST /v1/auth/resend-verification`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`
- `POST /v1/auth/forgot-password`
- `POST /v1/auth/reset-password`

## Security behavior

- Passwords use Node.js scrypt with a unique random salt.
- Session and one-time tokens are stored as SHA-256 hashes.
- Session cookie is HttpOnly, SameSite=Lax, Secure in production.
- Password reset invalidates every active session for that user.
- State-changing requests with an Origin header are restricted to the configured CORS origin allowlist.
- Login, registration, resend, reset, and forgot-password endpoints have per-process IP throttling.

## Deployment caveats before production

- Configure `CORS_ORIGINS` with the exact production web origin. Do not leave the localhost default in production.
- The current rate limiter is in-memory and per API process. Replace it with Redis-backed distributed throttling before horizontal scaling.
- Cross-site deployments may require a stricter CSRF token strategy and cookie SameSite=None; Secure, with a separate threat review. Prefer same-site web and API hostnames.
- Configure a trusted reverse proxy and Fastify `trustProxy` deliberately before relying on forwarded client IPs for throttling.
- Set up email provider delivery monitoring, bounce handling, and abuse controls.
- CMS platform access currently uses the explicit `FUNLINK_CMS_ADMIN_EMAILS` allowlist; it is not a general-purpose RBAC administration console.
- Tenant-scoped links, domains, campaigns, and workspace switching are not yet implemented. Every future business endpoint must derive the active tenant from a verified membership and scope every database query by that tenant.
- MFA, security audit logging for auth events, automated session cleanup, E2E browser security tests, and independent penetration testing remain required before production.
- This increment is not production-ready and must not be deployed to the live service until the remaining items are completed and reviewed.
