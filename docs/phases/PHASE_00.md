# PHASE 00 — Repository Audit & Scope Lock

Status: IN REVIEW. No product code is permitted in this Phase.

## Objective
Establish a verifiable clean starting point and the approved product/design/technical baseline.

## Tasks
1. Verify default branch, branches, pull requests and main tree.
2. Record legacy archive boundaries; never merge or restore legacy application code.
3. Record current CI facts and distinguish historical green runs from CI on current main.
4. Publish Master Blueprint and AI Execution Contract.
5. Publish exact visible section/component inventories for DESIGN-01 and DESIGN-02.
6. Publish approved scope, implementation status, technical gaps, task registry, decision log and acceptance log.
7. Verify documents are consistent and link to this Issue.

## Deliverables
- PROJECT_AUDIT.md
- MASTER_DEVELOPMENT_BLUEPRINT.md
- AI_EXECUTION_CONTRACT.md
- DESIGN_SPECIFICATION.md
- APPROVED_SCOPE.md
- IMPLEMENTATION_STATUS.md
- TECHNICAL_GAPS.md
- TASK_REGISTRY.md
- DECISION_LOG.md
- ACCEPTANCE_LOG.md
- This Phase specification.

## Explicit exclusions
No frontend/backend code, package manifests, dependency installation, database schema, CI workflow creation, VPS changes, secrets, deployment, feature additions or redesign.

## Acceptance criteria
- [ ] Repository audit reflects current GitHub state.
- [ ] Main remains free of product implementation code.
- [ ] Both design references and all visible required sections/components are documented.
- [ ] Locked decisions are consistent across all documents.
- [ ] Unknowns are recorded as gaps; no guessed values are presented as facts.
- [ ] AI execution restrictions are explicit and testable.
- [ ] Draft PR contains documentation only.
- [ ] Product owner reviews and explicitly accepts the Phase.

## Exit rule
After Draft PR is opened and reported, STOP. Do not begin Phase 01 until explicit acceptance.