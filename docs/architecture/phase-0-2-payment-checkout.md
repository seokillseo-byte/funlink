# Phase 0.2 — Native payment checkout

This change adds server-side checkout creation for VNPay, PayPal Orders v2 and Binance Pay, plus an authenticated PayPal capture endpoint.

## API

### Create a checkout
`POST /v1/workspaces/:tenantId/invoices/:invoiceId/checkout`

Requires the authenticated workspace OWNER, ADMIN or BILLING role, an OPEN invoice belonging to that tenant, a supported currency and an `Idempotency-Key` header (16–128 safe characters).

JSON body:

```json
{ "provider": "vnpay" }
```

Supported provider values: `vnpay`, `paypal`, `binancepay`.

The response contains `paymentAttemptId`, `provider` and `checkoutUrl`. The internal PaymentAttempt ID is used as VNPay `vnp_TxnRef`, PayPal purchase-unit `custom_id`, and Binance Pay `merchantTradeNo`.

Repeated requests with the same idempotency key return the stored pending checkout URL only when tenant, invoice and provider all match. A key cannot be reused for another payment.

### Capture a PayPal order after buyer approval
`POST /v1/workspaces/:tenantId/payment-attempts/:attemptId/paypal/capture`

Requires the same workspace billing authorization. This calls PayPal Orders v2 capture. It does not mark an invoice paid: the signed PayPal webhook remains the authoritative settlement path.

## Environment

Set values in the API deployment secret store, not in source control:

- `PAYMENT_RETURN_URL`, optional `PAYMENT_CANCEL_URL`
- VNPay: `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_PAYMENT_URL`
- PayPal: `PAYPAL_API_BASE_URL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and the existing `PAYPAL_WEBHOOK_ID`
- Binance Pay: `BINANCE_PAY_API_BASE_URL`, `BINANCE_PAY_API_KEY`, `BINANCE_PAY_API_SECRET`, `BINANCE_PAY_CERTIFICATE_SN`, `BINANCE_PAY_WEBHOOK_URL`

Use provider sandbox/test credentials and sandbox API endpoints for test environments. Never put merchant credentials in `.env.example`, commits or browser code.

## Money and precision rules

- VNPay is VND-only. The VNPAY request amount is the invoice's VND amount multiplied by 100, and the request is signed with HMAC-SHA512.
- PayPal uses Orders v2 with CAPTURE intent and a server-side OAuth token. VND is rejected because PayPal does not support it as a checkout currency.
- Binance Pay request signing uses HMAC-SHA512 over timestamp + LF + nonce + LF + exact JSON body + LF; send the uppercase hexadecimal signature in BinancePay-Signature.
- The current schema stores integer minor units. The checkout adapter formats supported currencies to zero or two decimals and does not round. Do not enable currencies requiring more than two fractional digits (for example BTC/ETH/BNB) until the money model is migrated to explicit decimal precision.
- Checkout URL and provider checkout ID are persisted separately from the final provider payment/transaction ID.
- Provider API failure marks the local attempt FAILED. A created provider order may remain unpaid until its provider expiry.

## Settlement and safety

Only verified provider webhooks may settle an invoice. PayPal capture endpoint only initiates capture and reports that it is awaiting the signed webhook. No live credentials, live payments, production database, VPS, DNS or production migrations are part of this PR.

The new migration is additive. It must only be applied after the existing migration-lineage inspection and integration PR sequence; do not apply it directly to a legacy/shared database.
