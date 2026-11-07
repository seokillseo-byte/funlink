# PHASE 01 — Project Foundation

Status: NOT STARTED. This Phase may begin only after Phase 00 is explicitly accepted.

## Objective
Create the minimum maintainable monorepo foundation for the approved FunLink application without implementing product features.

## Locked stack
- pnpm + Turborepo.
- Next.js + React + TypeScript frontend.
- NestJS + TypeScript API.
- TypeScript shared contracts/package.
- Worker application shell only where required by the approved architecture.
- Docker Compose for local development.
- GitHub Actions CI.

## Planned bounded deliverables
1. Monorepo workspace and package configuration.
2. Frontend app shell with approved design token foundation only; no unapproved page design.
3. NestJS API bootstrap and /api/v1 health endpoint.
4. Shared TypeScript contracts package.
5. Environment variable schema/validation and safe example env file.
6. Docker Compose local infrastructure placeholders for PostgreSQL and Redis; no production credentials.
7. Lint, format, typecheck, unit-test and build scripts.
8. CI workflow running the same deterministic checks.
9. README developer setup instructions.

## Not included
No auth, workspace business logic, database business schema, link management, redirect, analytics, payment, CMS, pricing UI, deployment or production server configuration.

## Acceptance criteria to be finalized in Phase 01 Issue
- Clean install from documented lockfile.
- Reproducible lint, format check, typecheck, tests and builds.
- API health endpoint works locally.
- Frontend shell starts locally.
- Shared package imports correctly from apps.
- Docker Compose starts only local development dependencies.
- CI runs on pull requests and reports failures accurately.
- No secrets committed; no production deploy workflow.

The exact repository folder structure and dependency versions must be pinned in the Phase 01 Issue before implementation. The agent must not substitute technologies or add product modules.