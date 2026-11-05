import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { activateSubscriptionForInvoice, billingRoutes, getPlanContext } from "./billing.js";

const catalog = [
  { id: "free", code: "FREE", name: "Free", priceMinor: 0, currency: "VND", interval: "MONTH", entitlements: { linksPerMonth: 20, trackedClicksPerMonth: 5000, qrPerMonth: 5, customDomains: 0, retentionDays: 30, seats: 1, features: [] }, active: true },
  { id: "starter", code: "STARTER", name: "Starter", priceMinor: 99000, currency: "VND", interval: "MONTH", entitlements: { linksPerMonth: 200, trackedClicksPerMonth: 50000, qrPerMonth: 50, customDomains: 1, retentionDays: 90, seats: 1, features: [] }, active: true },
  { id: "pro", code: "PRO", name: "Pro", priceMinor: 249000, currency: "VND", interval: "MONTH", entitlements: { linksPerMonth: 1000, trackedClicksPerMonth: 250000, qrPerMonth: 250, customDomains: 5, retentionDays: 365, seats: 3, features: [] }, active: true },
  { id: "agency", code: "AGENCY", name: "Agency", priceMinor: 599000, currency: "VND", interval: "MONTH", entitlements: { linksPerMonth: 5000, trackedClicksPerMonth: 1000000, qrPerMonth: 1000, customDomains: 20, retentionDays: 730, seats: 10, features: [] }, active: true }
];

test("plan catalog exposes the four approved monthly VND plans", async () => {
  const db = { plan: { findMany: async () => catalog } } as unknown as PrismaClient;
  const app = Fastify({ logger: false });
  billingRoutes(app, db);
  await app.ready();
  const response = await app.inject({ method: "GET", url: "/v1/plans" });
  assert.equal(response.statusCode, 200);
  const plans = response.json().plans;
  assert.deepEqual(plans.map((plan: any) => [plan.code, plan.priceMinor]), [
    ["FREE", 0], ["STARTER", 99000], ["PRO", 249000], ["AGENCY", 599000]
  ]);
  assert.equal(plans[2].entitlements.linksPerMonth, 1000);
  await app.close();
});

test("unauthenticated callers cannot create workspace subscriptions", async () => {
  const db = {
    session: { findUnique: async () => null },
    plan: { findUnique: async () => catalog[1] }
  } as unknown as PrismaClient;
  const app = Fastify({ logger: false });
  billingRoutes(app, db);
  await app.ready();
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-a/subscriptions",
    headers: { "content-type": "application/json" },
    payload: { planCode: "STARTER" }
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test("free fallback uses the approved monthly allowance when no active subscription exists", async () => {
  const db = {
    subscription: { findFirst: async () => null },
    plan: { findUnique: async () => null }
  } as unknown as PrismaClient;
  const context = await getPlanContext(db, "tenant-a", new Date("2026-11-05T10:00:00.000Z"));
  assert.equal(context.plan.code, "FREE");
  assert.equal(context.plan.priceMinor, 0);
  assert.equal(context.plan.entitlements.linksPerMonth, 20);
  assert.equal(context.plan.entitlements.trackedClicksPerMonth, 5000);
  assert.equal(context.plan.entitlements.customDomains, 0);
  assert.equal(context.periodStart.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("verified invoice payment activates its pending subscription and replaces the previous active plan", async () => {
  let canceled = false;
  let activated: any = null;
  const tx = {
    subscription: {
      findFirst: async () => ({ id: "new-subscription" }),
      updateMany: async (args: any) => { canceled = args.where.status === "ACTIVE" && args.where.id.not === "new-subscription"; return { count: 1 }; },
      update: async (args: any) => { activated = args.data; return { id: args.where.id, ...args.data }; }
    }
  } as unknown as Prisma.TransactionClient;
  const now = new Date("2026-11-05T10:00:00.000Z");
  const result = await activateSubscriptionForInvoice(tx, { tenantId: "tenant-a", subscriptionId: "new-subscription" }, now);
  assert.equal(result, true);
  assert.equal(canceled, true);
  assert.equal(activated.status, "ACTIVE");
  assert.equal(activated.currentPeriodStart.toISOString(), now.toISOString());
  assert.equal(activated.currentPeriodEnd.toISOString(), "2026-12-05T10:00:00.000Z");
});
