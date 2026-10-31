# Phase 0.6 — Backend API Foundation

## Scope

This phase introduces an isolated Fastify + TypeScript API under `apps/api`. It does not replace the existing Node.js MVP entry point (`server.js`) and does not change production deployment, DNS, VPS configuration, or persisted production data.

## Runtime

- Node.js 22+
- Fastify 5
- TypeScript (NodeNext modules)
- Prisma Client 6.19.0, matching the existing schema/toolchain
- Zod environment validation
- Default bind: `127.0.0.1:3013`

## Endpoints

- `GET /health`: process-level liveness check.
- `GET /ready`: readiness check; returns 503 if Prisma is not configured or its database probe fails.

## Local development

1. Install Node.js 22+ and pnpm 10.12.1.
2. Run `pnpm install` from the repository root.
3. Copy `apps/api/.env.example` to `apps/api/.env` only if using a local environment loader in a future deployment; currently export the variables in the shell.
4. Set `DATABASE_URL` to a disposable/local PostgreSQL database.
5. Run `pnpm db:generate`.
6. Run `pnpm --filter @funlink/api dev`.
7. Check `http://127.0.0.1:3013/health` and `/ready`.

## Validation

CI installs dependencies, generates Prisma Client, typechecks, builds, and runs API tests. No production secrets or database are used. The existing `pnpm start` command remains `node server.js`.

## Safety boundaries

This phase intentionally does not implement authentication, tenant authorization, link CRUD, payments, or production cutover. Those are separate phases and must be reviewed independently.
