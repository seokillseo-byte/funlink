# Phase 0.2 — Native payment provider webhook adapters

## VNPay
- Verify the native v2.1 callback signature with HMAC-SHA512 over the sorted callback parameters, excluding `vnp_SecureHash` and `vnp_SecureHashType`.
- Verify `vnp_TmnCode`, `vnp_TxnRef`, `vnp_Amount`, `vnp_ResponseCode` and `vnp_TransactionStatus` after signature validation.
- VNPay returns `vnp_Amount` multiplied by 100. A successful payment requires both response code and transaction status `00`.
- The browser return URL is not payment proof.

## PayPal
- Verify the exact raw request body, not a parsed-and-reserialized JSON value.
- Require transmission ID/time, certificate URL, auth algorithm and transmission signature headers.
- Use `SHA256withRSA`, a five-minute timestamp window, the registered webhook ID, and CRC32 of the original raw body.
- Only trust certificates fetched over HTTPS from official PayPal API hosts; reject redirects and untrusted hosts.
- Only completed capture events can mark an invoice paid. An approved order is not proof of capture.

## Binance Pay
- Verify RSA-SHA256 over `timestamp + LF + nonce + LF + rawBody + LF`.
- Match the certificate serial header to the configured Binance Pay certificate/public key.
- Require a 13-digit millisecond timestamp within five minutes and the documented nonce format.
- Only `bizType=PAY` and `bizStatus=PAY_SUCCESS` represent a successful payment. Payout/refund events need separate handlers.
- Never accept a public-key URL supplied by the inbound webhook.

## Shared invariants
- Verify signature/freshness before any database write.
- Resolve provider references to a payment attempt and derive tenant ownership from the database, never from webhook-supplied tenant IDs.
- Verify exact amount/currency and payable invoice state in one transaction.
- Enforce provider event/transaction idempotency and do not log raw bodies, signatures, tokens or secrets.
- Refunds, disputes, chargebacks and subscription lifecycle events require separate mappings.

## Integration gate
The current schema stores money as integer minor units. Binance Pay currencies with precision beyond the supported currency exponent require an exact atomic-unit/decimal migration; never round crypto amounts into cents. Keep all provider payment mutation disabled until native event mapping, database tests, replay/idempotency tests and sandbox end-to-end tests pass.

## Official references
- VNPay: https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
- PayPal: https://developer.paypal.com/api/rest/webhooks/rest/
- Binance Pay: https://merchant.binance.com/en/docs/functionalities/webhooks
