# Phase 0.2 — Webhook signature security

## Endpoint and signature contract
- Endpoint: `POST /v1/webhooks/:provider`.
- Each provider has a secret in `FUNLINK_WEBHOOK_SECRET_<PROVIDER>`, with provider normalized to uppercase alphanumeric/underscore.
- The generic adapter contract expects `x-funlink-signature: sha256=<64 hex chars>`, an HMAC-SHA256 over the exact raw HTTP request bytes.
- Secrets shorter than 32 characters are rejected; missing secrets fail closed with 503.
- Raw bytes are captured in Fastify's `preParsing` hook. The HMAC is verified with constant-time comparison before any database transaction or billing mutation.
- Invalid signatures return 401 and do not write webhook, payment, invoice, or subscription rows.

This is a secure internal adapter contract, not a claim that every payment provider's native webhook format is already supported. A real provider integration must implement its native header/timestamp/replay rules and map verified events into this normalized contract before enabling that provider.

## Normalized event contract
Accepted event types:
- `payment.succeeded`
- `payment.failed`

The signed body must include a unique provider event ID, internal payment-attempt ID, amount in minor units, and currency. The API verifies provider + payment attempt association, exact amount/currency, PENDING payment status, and OPEN invoice status before mutation.

## Processing guarantees
- Unique `(provider, providerEventId)` database constraint provides event idempotency.
- Event record creation, payment-attempt update, invoice update, and webhook processing state update occur in one Prisma transaction.
- A successful payment marks the attempt SUCCEEDED and invoice PAID; a failed payment marks only the attempt FAILED.
- Unknown payment attempts, mismatched amount/currency, and non-payable states are recorded as failed processing and do not change billing state.
- Duplicate events are acknowledged without a second mutation.
- Logs contain provider and safe error metadata only; raw request body and signature are not logged.

## Tests and safety
API tests cover valid raw-body signatures, tampered-body/invalid signatures, missing secrets, duplicate events, and amount/currency mismatch. All CI databases are disposable PostgreSQL instances. No production payment provider, webhook endpoint, or secret was configured or contacted.

## Remaining provider-specific work
Before accepting real production callbacks, add and test each provider's native signature scheme (for example timestamp tolerance and provider-specific header format), event taxonomy, and refund/chargeback/subscription event mapping. The normalized route must remain fail-closed until an adapter is explicitly configured.
