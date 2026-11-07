# FunLink — Master Development Blueprint

- Version: 1.0
- Status: Approved baseline; scope locked
- Product: FunLink SaaS — Smart Links for Growth
- Default branch: main
- Execution: one approved Phase/Issue at a time; Draft PR; user acceptance required

## 1. Locked product decisions

| Decision | Approved value |
|---|---|
| Product | FunLink SaaS |
| Short-link domain strategy | FunLink primary domain; exact hostname must be confirmed from the owner's domain configuration before DNS/production work |
| Payment | VNPay only |
| Languages | Vietnamese and English |
| Pricing | Free, Pro, Business, Enterprise |
| Billing display | Monthly/yearly selector as shown in DESIGN-01 |
| Architecture | Modular Monolith |
| Repository | GitHub Monorepo |
| Frontend | Next.js, React, TypeScript |
| Backend | NestJS, TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Cache | Redis |
| Background jobs | BullMQ |
| Package manager | pnpm |
| Monorepo tooling | Turborepo |
| API | REST, versioned at /api/v1 |
| Deployment target | VPS, Docker, Nginx |
| Git workflow | Feature branch and Draft PR |
| Merge/deploy | Explicit product-owner approval only |

These decisions are immutable unless the product owner explicitly approves a written change request.

## 2. Design authorities

- DESIGN-01: user-provided full-length public homepage screenshot (836 × 1881 px).
- DESIGN-02: user-provided CMS dashboard screenshot (1536 × 1024 px).

The screenshots are normative visual specifications, not inspiration. Preserve layout, section order, colors, gradients, typography hierarchy, font sizes, weights, spacing, proportions, borders, radii, shadows, icons, button styling, labels and navigation. Do not invent a replacement design. Exact font family and HEX values must be verified from original assets/source if available; otherwise record the unknown and request approval. Never silently guess.

## 3. Approved functional scope

1. Authentication and user accounts.
2. Workspace and permissions.
3. Link management.
4. Redirect engine.
5. Custom domains.
6. Link analytics.
7. Campaign management and UTM.
8. QR Code management.
9. Customer workspace/dashboard.
10. Plans and subscriptions.
11. VNPay payments.
12. Usage quotas and billing.
13. Public website and bilingual SEO.
14. CMS.
15. Admin Console for approved administration functions.

The two design references define required visible components. Any further behavior must be specified in the relevant approved Phase document before implementation. No new product module is authorized by implication.

## 4. Technology and architecture constraints

Use a single deployable modular backend, not microservices. Keep frontend, API, worker and shared contracts in a pnpm/Turborepo monorepo. Use strict TypeScript, Prisma migrations, PostgreSQL constraints/indexes, Redis cache and BullMQ only where background processing is required. REST contracts are versioned. Do not introduce alternative frameworks, databases, payment providers, queues or deployment platforms without approval.

Proposed module boundaries: Auth, Users, Workspaces, Links, Redirect, Domains, Analytics, Campaigns, UTM, QRCode, Plans, Subscriptions, Payments, Usage, CMS and Admin. These are code boundaries, not permission to add product features.

## 5. Phase roadmap

- 00 — Repository Audit & Scope Lock
- 01 — Project Foundation
- 02 — Database Foundation
- 03 — Authentication & RBAC
- 04 — Workspace & Multi-tenancy
- 05 — Link Management
- 06 — Redirect Engine
- 07 — Custom Domain
- 08 — Analytics
- 09 — Campaign & UTM
- 10 — QR Code
- 11 — Customer Workspace UI
- 12 — Plans & Subscription
- 13 — VNPay Integration
- 14 — Usage Quota & Billing
- 15 — Public Website & SEO
- 16 — CMS & Admin Console
- 17 — Security & Production Readiness

Each Phase requires a bounded specification, GitHub Issue(s), acceptance criteria, tests and a Draft PR. UI work must be visually checked against the reference screenshots in the Phase where the UI is implemented; Phase 15 is not permission to defer design fidelity.

## 6. Quality gates

Required as applicable: unit tests, integration tests, API contract tests, E2E tests, security tests, tenant-isolation tests, payment tests, regression tests, build checks and visual regression checks. Never weaken, skip or delete tests to obtain green CI. Distinguish code defects from configuration and environment failures.

## 7. Phase completion

A Phase is complete only when its deliverables and acceptance criteria pass, test evidence is recorded, documentation/progress is updated, and the product owner accepts the Draft PR. No automatic merge or deployment.

## 8. Change control

Any change to design, feature scope, architecture, technology, payment, pricing, navigation, data model or Phase scope requires a written SCOPE CHANGE REQUEST and explicit approval. If an instruction is ambiguous or blocked, stop and ask one focused question. Do not expand scope, create speculative backlog, or continue looping through suggestions.
