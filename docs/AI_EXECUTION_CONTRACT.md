# FunLink — AI Execution Contract

## Authority order
1. Explicit latest written approval from the product owner.
2. MASTER_DEVELOPMENT_BLUEPRINT.md.
3. The active approved Phase specification.
4. The assigned GitHub Issue and its acceptance criteria.
5. DESIGN_SPECIFICATION.md and approved reference assets.

If sources conflict, stop and request clarification. Do not choose autonomously.

## Allowed execution
- Work only on the active approved Issue.
- Inspect before changing.
- Make the smallest complete change that satisfies acceptance criteria.
- Preserve completed and approved behavior.
- Add/update tests for changed behavior.
- Update only required project documentation.
- Report changed files, commands, test results, risks and unresolved blockers.
- Submit a Draft PR and wait for review.

## Prohibited execution
- No invented features, modules, pages, settings or navigation.
- No redesign, typography/color/spacing changes or content omission.
- No technology substitution or unapproved dependency.
- No broad refactor unrelated to the Issue.
- No deleting/weakening tests or bypassing checks.
- No changing pricing, quota, payment or business rules without specification.
- No fake customer quotes, user counts, performance metrics or analytics.
- No merge, release, production deployment or secret exposure.

## Stop conditions
Stop and mark BLOCKED / WAITING FOR USER when requirements conflict, a required business value is unknown, design fidelity cannot be verified, credentials are missing, an operation is destructive, or acceptance criteria cannot be met without expanding scope.

## Required PR report
1. Issue and Phase.
2. Scope completed / not completed.
3. Changed files.
4. Tests and exact results.
5. Visual comparison evidence for UI changes.
6. Security/data migration implications.
7. Remaining blockers (if any).
8. Explicit statement: no merge/deploy performed.
