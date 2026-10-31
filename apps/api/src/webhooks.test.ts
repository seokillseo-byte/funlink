import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { webhookRoutes } from "./webhooks.js";

const secret = "test-webhook-secret-with-at-least-32-characters";
const event = {
  id: "evt_test_001",
  type: "payment.succeeded",
  data: { paymentAttemptId: "payment-1", amountMinor: 12900, currency: "VND" }
};
const raw = JSON.stringify(event);
const sign = (body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

async function buildWebhookApp(db: Record<string, any>) {
  const app = Fastify({ logger: false });
  webhookRoutes(app, db as unknown as PrismaClient);
  await app.ready();
  return app;
}

test("valid raw-body HMAC verifies before payment and invoice mutation", async () => {
  process.env.FUNLINK_WEBHOOK_SECRET_TESTPAY = secret;
  let paymentUpdate: any;
  let invoiceUpdate: any;
  let webhookUpdate: any;
  let storedPayload: any;
  const tx = {
    webhookEvent: {
      create: async ({ data }: any) => { storedPayload = data; return { id: "webhook-1" }; },
      update: async ({ data }: any) => { webhookUpdate = data; return {}; }
    },
    paymentAttempt: {
      findFirst: async () => ({
        id: "payment-1", invoiceId: "invoice-1", provider: "stripe", status: "PENDING",
        amountMinor: 12900, currency: "VND", invoice: { id: "invoice-1", status: "OPEN" }
      }),
      update: async ({ data }: any) => { paymentUpdate = data; return {}; }
    },
    invoice: { update: async ({ data }: any) => { invoiceUpdate = data; return {}; } }
  };
  const db = { $transaction: async (callback: (value: any) => Promise<any>) => callback(tx) };
  const app = await buildWebhookApp(db);
  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/testpay",
    headers: { "content-type": "application/json", "x-funlink-signature": sign(raw) },
    payload: raw
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().processed, true);
  assert.equal(storedPayload.signatureVerifiedAt instanceof Date, true);
  assert.equal(storedPayload.status, "VERIFIED");
  assert.deepEqual(paymentUpdate.status, "SUCCEEDED");
  assert.equal(invoiceUpdate.status, "PAID");
  assert.equal(webhookUpdate.status, "PROCESSED");
  await app.close();
  delete process.env.FUNLINK_WEBHOOK_SECRET_TESTPAY;
});

test("invalid signature is rejected before any database transaction", async () => {
  process.env.FUNLINK_WEBHOOK_SECRET_TESTPAY = secret;
  let transactionCalled = false;
  const app = await buildWebhookApp({
    $transaction: async () => { transactionCalled = true; throw new Error("must not run"); }
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/testpay",
    headers: { "content-type": "application/json", "x-funlink-signature": sign(raw.replace("12900", "12901")) },
    payload: raw
  });
  assert.equal(response.statusCode, 401);
  assert.equal(transactionCalled, false);
  await app.close();
  delete process.env.FUNLINK_WEBHOOK_SECRET_TESTPAY;
});

test("missing provider secret fails closed without touching billing data", async () => {
  delete process.env.FUNLINK_WEBHOOK_SECRET_TESTPAY;
  let transactionCalled = false;
  const app = await buildWebhookApp({
    $transaction: async () => { transactionCalled = true; throw new Error("must not run"); }
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/testpay",
    headers: { "content-type": "application/json", "x-funlink-signature": sign(raw) },
    payload: raw
  });
  assert.equal(response.statusCode, 503);
  assert.equal(transactionCalled, false);
  await app.close();
});

test("duplicate provider event IDs are acknowledged without reprocessing", async () => {
  process.env.FUNLINK_WEBHOOK_SECRET_TESTPAY = secret;
  let paymentLookupCalled = false;
  const app = await buildWebhookApp({
    $transaction: async () => { throw { code: "P2002" }; },
    paymentAttempt: { findFirst: async () => { paymentLookupCalled = true; return null; } }
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/testpay",
    headers: { "content-type": "application/json", "x-funlink-signature": sign(raw) },
    payload: raw
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().duplicate, true);
  assert.equal(paymentLookupCalled, false);
  await app.close();
  delete process.env.FUNLINK_WEBHOOK_SECRET_TESTPAY;
});

test("amount or currency mismatch is recorded but cannot mutate payment or invoice", async () => {
  process.env.FUNLINK_WEBHOOK_SECRET_TESTPAY = secret;
  let paymentUpdated = false;
  let invoiceUpdated = false;
  let failureReason = "";
  const tx = {
    webhookEvent: {
      create: async () => ({ id: "webhook-2" }),
      update: async ({ data }: any) => { failureReason = data.failureReason; return {}; }
    },
    paymentAttempt: {
      findFirst: async () => ({
        id: "payment-1", invoiceId: "invoice-1", provider: "stripe", status: "PENDING",
        amountMinor: 12901, currency: "VND", invoice: { id: "invoice-1", status: "OPEN" }
      }),
      update: async () => { paymentUpdated = true; return {}; }
    },
    invoice: { update: async () => { invoiceUpdated = true; return {}; } }
  };
  const app = await buildWebhookApp({ $transaction: async (callback: (value: any) => Promise<any>) => callback(tx) });
  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/testpay",
    headers: { "content-type": "application/json", "x-funlink-signature": sign(raw) },
    payload: raw
  });
  assert.equal(response.statusCode, 202);
  assert.equal(paymentUpdated, false);
  assert.equal(invoiceUpdated, false);
  assert.equal(failureReason, "payment_amount_or_currency_mismatch");
  await app.close();
  delete process.env.FUNLINK_WEBHOOK_SECRET_TESTPAY;
});
