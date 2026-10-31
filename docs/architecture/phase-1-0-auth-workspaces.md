# Phase 1.0 — SaaS Frontend & Backend Foundation

## Implemented
- Next.js 15 + React 19 login/register UI connected to the API.
- Fastify routes: POST /v1/auth/register, POST /v1/auth/login, POST /v1/auth/logout, GET /v1/auth/me.
- Passwords hashed with Node.js scrypt and a unique random salt.
- Opaque session tokens stored only as SHA-256 hashes.
- HttpOnly, SameSite=Lax session cookies; Secure in production.
- Registration atomically creates a workspace and OWNER membership using existing Prisma models.
- Existing production server.js, VPS, DNS and live database are untouched.

## Local setup
1. Run pnpm install.
2. Configure DATABASE_URL in apps/api/.env.
3. Run pnpm db:generate and pnpm db:migrate:deploy against a local development database only.
4. Start API with pnpm api:dev (port 3013).
5. Set NEXT_PUBLIC_API_URL=http://localhost:3013 in apps/web/.env.local.
6. Start frontend with pnpm --filter @funlink/web dev (port 3014).

## Remaining before production
Email verification and delivery, password reset, rate limiting, CSRF strategy for cross-site deployment, MFA, platform admin authorization, tenant-scoped business resources, and end-to-end security tests. This increment is not production-ready authentication.
