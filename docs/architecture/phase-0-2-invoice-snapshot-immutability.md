# Phase 0.2 — Invoice snapshot immutability

## Database enforcement
Migration `0006_invoice_snapshot_immutability` installs a PostgreSQL trigger on `Invoice`:
- Immutable fields: tenant, subscription reference, invoice number, amount in minor units, currency, plan snapshot and line items.
- Any UPDATE that changes one of these fields is rejected with SQLSTATE `23514`.
- DELETE is rejected so a financial invoice record cannot be physically removed.
- Lifecycle fields such as `status` and `paidAt` remain updateable; the webhook service can move an OPEN invoice to PAID without altering its snapshot.

The rule is enforced in PostgreSQL, not only in an application service, so direct SQL and alternate application paths cannot bypass it.

## Validation
The disposable PostgreSQL migration workflow now deploys the committed versioned migrations (rather than applying only a generated schema snapshot), verifies the migration history, and runs smoke tests that attempt to mutate planSnapshot, lineItems and amount, attempt deletion, and confirm a status-only lifecycle update still succeeds.

## Safety and integration
All trigger tests run against disposable PostgreSQL in CI. No production invoice, database or payment provider is accessed. The hardened tenant/billing constraints in PR #9 still need to be integrated with the API branch before Phase 0.2 can be signed off.
