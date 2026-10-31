# Payment sandbox test runbook — Phase 0.2

This runbook is for an isolated staging environment only. The automated tests in this branch mock provider HTTP responses and verify our outbound request signatures, idempotency, tenant access, return URLs and webhook-authoritative settlement. They do NOT contact real merchant accounts. A provider-hosted sandbox checkout must still be run with merchant test credentials before any production launch.

## 1. Safe test environment

1. Deploy the candidate branch to a disposable staging environment, not the production VPS or production database.
2. Use a fresh PostgreSQL database dedicated to this test. Apply the reviewed migration chain only after inspecting its _prisma_migrations history.
3. Configure the web app's NEXT_PUBLIC_API_URL to the staging API and set CORS_ORIGINS to the exact staging web origin.
4. Set PAYMENT_RETURN_URL=https://<staging-web-host>/billing/return and PAYMENT_CANCEL_URL=https://<staging-web-host>/billing/return. The return URL includes the originating workspace ID and payment attempt ID.
5. Keep every merchant secret in the deployment secret manager. Never commit real credentials, paste them into an issue, or place them in frontend environment variables.

## 2. Provider test credentials and callbacks

Use test/sandbox merchant credentials only. Confirm the provider account's currently supported test environment and callback requirements before configuring it.

| Provider | API settings | Incoming callback |
|---|---|---|
| VNPay | VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html, VNPAY_TMN_CODE, VNPAY_HASH_SECRET | Configure the staging API IPN URL https://<staging-api-host>/v1/webhooks/vnpay in the VNPay merchant test portal |
| PayPal | PAYPAL_API_BASE_URL=https://api-m.sandbox.paypal.com, sandbox PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET | Register https://<staging-api-host>/v1/webhooks/paypal; set the returned webhook ID as PAYPAL_WEBHOOK_ID |
| Binance Pay | BINANCE_PAY_API_BASE_URL=https://bpay.binanceapi.com, test BINANCE_PAY_API_KEY, BINANCE_PAY_API_SECRET, and BINANCE_PAY_WEBHOOK_URL=https://<staging-api-host>/v1/webhooks/binance-pay | Set the merchant webhook certificate serial and public key as BINANCE_PAY_CERTIFICATE_SN and BINANCE_PAY_PUBLIC_KEY |

If a provider does not issue a sandbox merchant account to the project, do not substitute live credentials. Keep that provider at mocked-test status until the provider supplies an approved test facility.

## 3. Create isolated test invoices

Create test users and workspaces in staging. Verify the email, then create invoices through the approved billing test fixture or admin-only staging seed process. Do not expose an invoice-seeding endpoint in production.

Use one invoice for each supported provider currency:

- VNPay: VND invoice.
- PayPal: USD invoice.
- Binance Pay: USDT invoice (two-decimal minor-unit storage only).

The dashboard displays invoices for the selected workspace. Only OWNER, ADMIN or BILLING members can start a checkout. Other workspace members can view invoices but cannot create a payment attempt.

## 4. End-to-end acceptance checklist

For each provider:

1. Sign in as an OWNER or BILLING member and open Dashboard → Thanh toán & hóa đơn.
2. Select the matching open test invoice and click Thanh toán.
3. Confirm the provider checkout page is hosted by the expected provider domain.
4. Complete the provider's approved sandbox payment using its test buyer account.
5. Confirm the provider calls the staging webhook endpoint.
6. Confirm the PaymentAttempt changes from PENDING to SUCCEEDED, and the invoice changes from OPEN to PAID.
7. Reload the dashboard and confirm the paid state is shown.
8. Replay the same webhook event and confirm it does not create a second settlement or duplicate invoice update.

Additional negative cases:

- Cancel the provider checkout and confirm the redirect alone does not mark an invoice paid.
- Send an invalid webhook signature; no payment or invoice state may change.
- Send a correct signature with the wrong amount, currency, tenant, or payment-attempt ID; no invoice may be settled.
- Reuse an idempotency key for a different invoice/provider; expect HTTP 409.
- Try to pay as MEMBER or VIEWER; expect HTTP 403.
- Try to read an invoice using another tenant ID; expect no cross-tenant data.
- Simulate provider API timeout or invalid response; expect a failed local attempt and no invoice settlement.

## 5. Automated tests

From the repository root:

    pnpm --filter @funlink/api test
    pnpm --filter @funlink/api typecheck
    pnpm --filter @funlink/api build
    pnpm --filter @funlink/web typecheck
    pnpm --filter @funlink/web build

The added integration tests replace provider HTTP calls with deterministic sandbox-shaped responses. They assert the exact outbound Binance HMAC signature, PayPal order/capture linkage, VNPay URL signature, workspace authorization and the fact that PayPal capture does not settle the invoice without the signed webhook.

## 6. Go-live gate

Do not enable live payments until all three provider-hosted sandbox flows have passed, webhook replay and mismatch tests are recorded, provider settlement records reconcile with local invoices, support/refund procedures exist, and the migration lineage is reviewed. This PR does not change production configuration, DNS, live merchant credentials, production data, or the live VPS.
