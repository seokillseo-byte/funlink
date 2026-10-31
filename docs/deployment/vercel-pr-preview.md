# FunLink — Vercel PR Preview (staging web)

This guide configures a **non-production web preview** for the Next.js app in this monorepo. It does not deploy the API, provision PostgreSQL, run migrations, or enable real payment processing.

## 1. Import the GitHub repository into Vercel

1. Sign in to Vercel with the account that should own the staging project.
2. Select **Add New → Project** and import `seokillseo-byte/funlink`.
3. Create a separate project named `funlink-staging-web`. Do not attach the production domain.
4. Configure the project as follows:

| Setting | Value |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | `apps/web` |
| Node.js Version | 22.x |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm --filter @funlink/web build` |
| Output Directory | Leave the Next.js default |

Vercel should detect the repository's root `pnpm-lock.yaml` and `pnpm-workspace.yaml`. If the install command fails because the project is scoped to the app directory, enable Vercel's **Include source files outside of the Root Directory** / monorepo setting (wording may vary) and keep the repository root lockfile available.

## 2. Configure preview environment

The web app reads `NEXT_PUBLIC_API_URL` from `apps/web/.env.example`.

- For a **visual-only preview**, leave this variable unset. The web app falls back to localhost and API-backed data/actions will not work in Vercel.
- For an **interactive staging preview**, set `NEXT_PUBLIC_API_URL` to the HTTPS base URL of a separately deployed staging API (for example, `https://api-staging.example.com`). Do not use a production API URL.
- Configure the variable for **Preview** only until staging API, database, CORS, authentication callbacks, and test data are ready.
- The staging API must explicitly allow the Vercel preview origins that will access it. Do not use wildcard credentialed CORS.
- Never put provider secrets, database passwords, signing keys, or private API credentials in `NEXT_PUBLIC_*` variables. Those values are exposed to browsers.

## 3. Enable automatic PR previews

During the Vercel Git integration flow, authorize the Vercel GitHub App for `seokillseo-byte/funlink`. Keep **Preview Deployments** enabled for pull requests. Vercel will then create a unique preview URL for each eligible PR and post the deployment status/link back to GitHub.

Use the Vercel project’s Preview environment for this project. Do not promote a preview to Production and do not add a production domain as part of this setup.

## 4. Verify the first preview

1. Push or update a branch with a pull request.
2. Wait for Vercel's deployment check to finish on that PR.
3. Open the Preview URL posted by Vercel.
4. Confirm the landing page, login page, registration page, and dashboard shell render.
5. Record API-backed features as **not verified** unless the Preview deployment is connected to a dedicated staging API and disposable staging database.

## 5. Current boundary and next infrastructure gate

The repository currently contains a Next.js web app and a Fastify API, but GitHub Actions CI is not itself a web host. This Vercel project deploys only `apps/web`. A fully functional staging environment additionally needs:

- A separate HTTPS deployment for `apps/api` (Node.js 22).
- A disposable PostgreSQL staging database.
- Staging-only environment variables and provider sandbox credentials stored in the hosting provider's secret manager.
- API CORS and authentication/callback URLs configured for the Vercel Preview domain.
- Database migration rehearsal on the disposable staging database only, after reviewing the migration lineage.

Do not run Prisma migrations against production from this preview project. Do not test with live payment credentials or real payments.

## 6. Ownership / access required

A repository maintainer must complete the Vercel account connection and authorize the GitHub App. The GitHub repository cannot create a Vercel project or issue a Vercel preview URL on its own. No Vercel account credentials or provider secrets should be pasted into GitHub files or chat.
