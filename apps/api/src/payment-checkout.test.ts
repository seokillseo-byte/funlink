import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { buildVnpayCheckoutUrl, formatMinorAmount, paymentCheckoutRoutes, signBinancePayRequest } from "./payment-checkout.js";
import { verifyVnpayIpn } from "./payment-providers.js";

test("minor-unit formatting preserves VND and two-decimal crypto amounts without rounding", () => {
  assert.equal(formatMinorAmount(12500, "VND"), "12500");
  assert.equal(formatMinorAmount(1234, "USDT"), "12.34");
  assert.equal(formatMinorAmount(1234, "USD"), "12.34");
  assert.equal(formatMinorAmount(1234, "JPY"), "1234");
  assert.throws(() => formatMinorAmount(0, "USD"), /Invalid amount/);
});

test("VNPay checkout URL uses internal attempt ID and a verifiable HMAC-SHA512 signature", () => {
  const original = {
    VNPAY_PAYMENT_URL: process.env.VNPAY_PAYMENT_URL,
    VNPAY_TMN_CODE: process.env.VNPAY_TMN_CODE,
    VNPAY_HASH_SECRET: process.env.VNPAY_HASH_SECRET,
    PAYMENT_RETURN_URL: process.env.PAYMENT_RETURN_URL
  };
  process.env.VNPAY_PAYMENT_URL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
  process.env.VNPAY_TMN_CODE = "TESTMERCHANT";
  process.env.VNPAY_HASH_SECRET = "unit-test-secret";
  process.env.PAYMENT_RETURN_URL = "https://funlink.example/billing/return";
  try {
    const url = new URL(buildVnpayCheckoutUrl({
      attemptId: "attempt-internal-123",
      tenantId: "tenant-test",
      invoiceNumber: "INV-2026-001",
      amountMinor: 125000,
      ipAddress: "127.0.0.1",
      now: new Date("2026-10-31T02:00:00.000Z")
    }));
    const params = Object.fromEntries(url.searchParams.entries());
    assert.equal(params.vnp_TxnRef, "attempt-internal-123");
    assert.equal(params.vnp_Amount, "12500000");
    assert.equal(params.vnp_TmnCode, "TESTMERCHANT");
    assert.equal(verifyVnpayIpn(params, "unit-test-secret"), true);
    assert.equal(url.protocol, "https:");
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Binance Pay request signature uses HMAC-SHA512 and uppercase hexadecimal", () => {
  const secret = "binance-test-secret";
  const body = '{"merchantTradeNo":"attempt-1","orderAmount":10.25,"currency":"USDT"}';
  const timestamp = "1793431200000";
  const nonce = "0123456789abcdef0123456789abcdef";
  const signature = signBinancePayRequest(body, timestamp, nonce, secret);
  const expected = createHmac("sha512", secret).update(timestamp + "\n" + nonce + "\n" + body + "\n").digest("hex").toUpperCase();
  assert.equal(signature, expected);
  assert.equal(/^[A-F0-9]{128}$/.test(signature), true);
});

test("checkout endpoint requires a valid workspace session before reading invoice data", async () => {
  const db = { session: { findUnique: async () => null } } as unknown as PrismaClient;
  const app = Fastify({ logger: false });
  paymentCheckoutRoutes(app, db);
  await app.ready();
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-a/invoices/invoice-a/checkout",
    headers: { "content-type": "application/json", "idempotency-key": "test-idempotency-0001" },
    payload: { provider: "vnpay" }
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});
