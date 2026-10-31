import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { nativePaymentWebhookRoutes } from "./payment-provider-routes.js";

const secret = "vnpay-route-test-secret";
function signVnpay(params: Record<string, string>) {
  const data = Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value)).join("&");
  return createHmac("sha512", secret).update(data).digest("hex");
}

test("VNPay IPN validates signature, merchant and amount before transactional payment mutation", async () => {
  process.env.VNPAY_HASH_SECRET = secret;
  process.env.VNPAY_TMN_CODE = "TESTCODE";
  let paymentStatus = "";
  let invoiceStatus = "";
  const tx = {
    webhookEvent: {
      create: async () => ({ id: "event-1" }),
      update: async () => ({})
    },
    paymentAttempt: {
      findFirst: async () => ({
        id: "attempt-1", invoiceId: "invoice-1", provider: "vnpay",
        status: "PENDING", amountMinor: 1000, currency: "VND",
        invoice: { id: "invoice-1", status: "OPEN" }
      }),
      update: async ({ data }: any) => { paymentStatus = data.status; return {}; }
    },
    invoice: { update: async ({ data }: any) => { invoiceStatus = data.status; return {}; } }
  };
  const db = { $transaction: async (callback: (value: any) => Promise<any>) => callback(tx) };
  const app = Fastify({ logger: false });
  nativePaymentWebhookRoutes(app, db as unknown as PrismaClient);
  await app.ready();
  const params: Record<string, string> = {
    vnp_Amount: "100000",
    vnp_Command: "pay",
    vnp_ResponseCode: "00",
    vnp_TmnCode: "TESTCODE",
    vnp_TransactionNo: "123456",
    vnp_TransactionStatus: "00",
    vnp_TxnRef: "attempt-1"
  };
  params.vnp_SecureHash = signVnpay(params);
  const query = new URLSearchParams(params).toString();
  const response = await app.inject({ method: "GET", url: "/v1/webhooks/vnpay?" + query });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().RspCode, "00");
  assert.equal(paymentStatus, "SUCCEEDED");
  assert.equal(invoiceStatus, "PAID");
  await app.close();
  delete process.env.VNPAY_HASH_SECRET;
  delete process.env.VNPAY_TMN_CODE;
});

test("VNPay rejects invalid signatures before opening a database transaction", async () => {
  process.env.VNPAY_HASH_SECRET = secret;
  process.env.VNPAY_TMN_CODE = "TESTCODE";
  let transactionCalled = false;
  const db = { $transaction: async () => { transactionCalled = true; throw new Error("must not run"); } };
  const app = Fastify({ logger: false });
  nativePaymentWebhookRoutes(app, db as unknown as PrismaClient);
  await app.ready();
  const response = await app.inject({
    method: "GET",
    url: "/v1/webhooks/vnpay?vnp_TmnCode=TESTCODE&vnp_TxnRef=attempt-1&vnp_SecureHash=" + "a".repeat(128)
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().RspCode, "97");
  assert.equal(transactionCalled, false);
  await app.close();
  delete process.env.VNPAY_HASH_SECRET;
  delete process.env.VNPAY_TMN_CODE;
});

test("PayPal and Binance Pay fail closed when merchant configuration is absent", async () => {
  delete process.env.PAYPAL_WEBHOOK_ID;
  delete process.env.BINANCE_PAY_PUBLIC_KEY;
  delete process.env.BINANCE_PAY_CERTIFICATE_SN;
  const db = {} as PrismaClient;
  const app = Fastify({ logger: false });
  nativePaymentWebhookRoutes(app, db);
  await app.ready();
  const paypal = await app.inject({ method: "POST", url: "/v1/webhooks/paypal", headers: { "content-type": "application/json" }, payload: "{}" });
  const binance = await app.inject({ method: "POST", url: "/v1/webhooks/binance-pay", headers: { "content-type": "application/json" }, payload: "{}" });
  assert.equal(paypal.statusCode, 503);
  assert.equal(binance.statusCode, 503);
  await app.close();
});
