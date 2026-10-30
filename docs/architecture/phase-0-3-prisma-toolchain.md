# Phase 0.3 — Prisma toolchain and validation

## Implemented

- Pin Prisma CLI and Prisma Client to 6.19.0.
- Pin pnpm to 10.12.1 and require Node.js 22+.
- Add repeatable formatting, validation, client generation and migration scripts.
- Add GitHub Actions checks for schema formatting, validation and client generation.
- CI does not require production credentials and does not apply migrations.

## Commands

```bash
pnpm install
pnpm db:format
pnpm db:validate
pnpm db:generate
```

## Migration safety

Do not run migration commands against production in this phase. Initial SQL generation must use a disposable PostgreSQL database and a reviewed DATABASE_URL.

## Next verification gate

1. Confirm CI passes on this PR.
2. Provision an isolated PostgreSQL 16 test database.
3. Generate the initial SQL migration against that disposable database.
4. Test clean install, migration replay and cross-tenant constraints.
5. Prepare a separate legacy JSON import plan. No production migration is included here.
