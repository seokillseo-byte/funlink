import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const FREE_PLAN = {
  id: "plan_free_2026",
  code: "FREE",
  name: "Free",
  priceMinor: 0,
  currency: "VND",
  interval: "MONTH" as const,
  entitlements: {
    linksPerMonth: 20, trackedClicksPerMonth: 5000, qrPerMonth: 5,
    customDomains: 0, retentionDays: 30, seats: 1,
    features: ["FunLink branded links", "Basic analytics"]
  }
};
type Entitlements = {
  linksPerMonth: number; trackedClicksPerMonth: number; qrPerMonth: number;
  customDomains: number; retentionDays: number; seats: number; features: string[];
};
function readEntitlements(value: Prisma.JsonValue): Entitlements {
  const v = value as Partial<Entitlements>;
  const number = (n: unknown, fallback: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : fallback;
  return {
    linksPerMonth: number(v?.linksPerMonth, 20),
    trackedClicksPerMonth: number(v?.trackedClicksPerMonth, 5000),
    qrPerMonth: number(v?.qrPerMonth, 5),
    customDomains: number(v?.customDomains, 0),
    retentionDays: number(v?.retentionDays, 30),
    seats: number(v?.seats, 1),
    features: Array.isArray(v?.features) ? v.features.filter((x): x is string => typeof x === "string") : []
  };
}
function addOneMonth(date: Date) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}
function monthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
export async function getPlanContext(db: PrismaClient, tenantId: string, now = new Date()) {
  const subscription = await db.subscription.findFirst({
    where: { tenantId, status: "ACTIVE", currentPeriodStart: { lte: now }, currentPeriodEnd: { gt: now } },
    include: { plan: true },
    orderBy: { currentPeriodStart: "desc" }
  });
  if (subscription) {
    return {
      plan: { ...subscription.plan, entitlements: readEntitlements(subscription.plan.entitlements) },
      subscription,
      periodStart: subscription.currentPeriodStart ?? monthStart(now),
      periodEnd: subscription.currentPeriodEnd ?? addOneMonth(now)
    };
  }
  const plan = await db.plan.findUnique({ where: { code: "FREE" } });
  return {
    plan: plan
      ? { ...plan, entitlements: readEntitlements(plan.entitlements) }
      : { ...FREE_PLAN, entitlements: FREE_PLAN.entitlements },
    subscription: null,
    periodStart: monthStart(now),
    periodEnd: addOneMonth(now)
  };
}
async function workspaceAccess(req: any, db: PrismaClient, tenantId: string) {
  const raw = req.cookies?.funlink_session;
  if (!raw) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha(raw) },
    include: { user: { select: { id: true, status: true, emailVerifiedAt: true, memberships: {
      where: { tenantId }, include: { tenant: { select: { status: true } } }
    } } } }
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() ||
      session.user.status !== "ACTIVE" || !session.user.emailVerifiedAt) return null;
  const membership = session.user.memberships[0];
  if (!membership || membership.tenant.status !== "ACTIVE") return null;
  return { userId: session.user.id, role: membership.role };
}
function canBill(role: string) { return ["OWNER", "ADMIN", "BILLING"].includes(role); }
function invoiceNumber(now: Date) {
  return "FL-" + now.toISOString().slice(0, 10).replaceAll("-", "") + "-" + randomBytes(3).toString("hex").toUpperCase();
}
export async function activateSubscriptionForInvoice(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; subscriptionId: string },
  now = new Date()
) {
  const subscription = await tx.subscription.findFirst({
    where: { id: input.subscriptionId, tenantId: input.tenantId, status: "INCOMPLETE" },
    select: { id: true }
  });
  if (!subscription) return false;
  await tx.subscription.updateMany({
    where: { tenantId: input.tenantId, status: "ACTIVE", id: { not: subscription.id } },
    data: { status: "CANCELED", canceledAt: now, cancelAtPeriodEnd: false }
  });
  await tx.subscription.update({
    where: { id: subscription.id },
    data: { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: addOneMonth(now), cancelAtPeriodEnd: false, canceledAt: null }
  });
  return true;
}
export function billingRoutes(app: FastifyInstance, db: PrismaClient) {
  app.get("/v1/plans", async () => {
    const plans = await db.plan.findMany({
      where: { active: true }, orderBy: { priceMinor: "asc" },
      select: { id: true, code: true, name: true, priceMinor: true, currency: true, interval: true, entitlements: true }
    });
    return { plans: plans.map(plan => ({ ...plan, entitlements: readEntitlements(plan.entitlements) })) };
  });
  app.get("/v1/workspaces/:tenantId/billing", async (req, reply) => {
    const p = z.object({ tenantId: z.string().min(1).max(64) }).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "Invalid workspace" });
    const access = await workspaceAccess(req, db, p.data.tenantId);
    if (!access) return reply.code(404).send({ error: "Workspace not found" });
    const now = new Date();
    const context = await getPlanContext(db, p.data.tenantId, now);
    const [links, clicks, domains, seats] = await Promise.all([
      db.link.count({ where: { tenantId: p.data.tenantId, createdAt: { gte: context.periodStart, lt: context.periodEnd } } }),
      db.clickEvent.count({ where: { tenantId: p.data.tenantId, occurredAt: { gte: context.periodStart, lt: context.periodEnd } } }),
      db.domain.count({ where: { tenantId: p.data.tenantId } }),
      db.tenantMember.count({ where: { tenantId: p.data.tenantId } })
    ]);
    const invoices = await db.invoice.findMany({
      where: { tenantId: p.data.tenantId }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, number: true, status: true, amountMinor: true, currency: true, createdAt: true, dueAt: true, paidAt: true }
    });
    return {
      plan: context.plan, subscription: context.subscription,
      periodStart: context.periodStart, periodEnd: context.periodEnd,
      usage: {
        links: { used: links, limit: context.plan.entitlements.linksPerMonth },
        trackedClicks: { used: clicks, limit: context.plan.entitlements.trackedClicksPerMonth },
        customDomains: { used: domains, limit: context.plan.entitlements.customDomains },
        seats: { used: seats, limit: context.plan.entitlements.seats },
        qr: { used: 0, limit: context.plan.entitlements.qrPerMonth, available: false }
      },
      invoices
    };
  });
  app.post("/v1/workspaces/:tenantId/subscriptions", async (req, reply) => {
    const p = z.object({ tenantId: z.string().min(1).max(64) }).safeParse(req.params);
    const body = z.object({ planCode: z.enum(["FREE", "STARTER", "PRO", "AGENCY"]) }).safeParse(req.body);
    if (!p.success || !body.success) return reply.code(400).send({ error: "Invalid subscription request" });
    const access = await workspaceAccess(req, db, p.data.tenantId);
    if (!access) return reply.code(404).send({ error: "Workspace not found" });
    if (!canBill(access.role)) return reply.code(403).send({ error: "Workspace billing access required" });
    const plan = await db.plan.findUnique({ where: { code: body.data.planCode, active: true } });
    if (!plan) return reply.code(404).send({ error: "Plan not found" });
    const current = await db.subscription.findFirst({
      where: { tenantId: p.data.tenantId, status: "ACTIVE", currentPeriodEnd: { gt: new Date() } },
      include: { plan: true }, orderBy: { currentPeriodStart: "desc" }
    });
    if (current?.plan.code === plan.code) return reply.code(409).send({ error: "This plan is already active for the workspace" });
    const now = new Date();
    if (plan.code === "FREE") {
      const subscription = await db.$transaction(async tx => {
        await tx.subscription.updateMany({
          where: { tenantId: p.data.tenantId, status: "ACTIVE" },
          data: { status: "CANCELED", canceledAt: now, cancelAtPeriodEnd: false }
        });
        return tx.subscription.create({
          data: { tenantId: p.data.tenantId, planId: plan.id, status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: addOneMonth(now) },
          include: { plan: true }
        });
      });
      return reply.code(201).send({ subscription, invoice: null, paymentRequired: false });
    }
    const created = await db.$transaction(async tx => {
      const subscription = await tx.subscription.create({
        data: { tenantId: p.data.tenantId, planId: plan.id, status: "INCOMPLETE" },
        select: { id: true, tenantId: true, planId: true, status: true, createdAt: true }
      });
      const snapshot = {
        code: plan.code, name: plan.name, priceMinor: plan.priceMinor,
        currency: plan.currency, interval: plan.interval,
        entitlements: readEntitlements(plan.entitlements)
      };
      const invoice = await tx.invoice.create({
        data: {
          tenantId: p.data.tenantId, subscriptionId: subscription.id,
          number: invoiceNumber(now), status: "OPEN", amountMinor: plan.priceMinor,
          currency: plan.currency, planSnapshot: snapshot,
          lineItems: [{ description: "FunLink " + plan.name + " - 1 month", quantity: 1, amountMinor: plan.priceMinor }],
          dueAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        },
        select: { id: true, number: true, status: true, amountMinor: true, currency: true, dueAt: true }
      });
      return { subscription, invoice };
    });
    return reply.code(201).send({ ...created, paymentRequired: true });
  });
  app.post("/v1/workspaces/:tenantId/subscription/cancel", async (req, reply) => {
    const p = z.object({ tenantId: z.string().min(1).max(64) }).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "Invalid workspace" });
    const access = await workspaceAccess(req, db, p.data.tenantId);
    if (!access) return reply.code(404).send({ error: "Workspace not found" });
    if (!canBill(access.role)) return reply.code(403).send({ error: "Workspace billing access required" });
    const subscription = await db.subscription.findFirst({
      where: { tenantId: p.data.tenantId, status: "ACTIVE", currentPeriodEnd: { gt: new Date() } },
      orderBy: { currentPeriodStart: "desc" }
    });
    if (!subscription) return reply.code(404).send({ error: "No active subscription found" });
    const updated = await db.subscription.update({
      where: { id: subscription.id }, data: { cancelAtPeriodEnd: true }
    });
    return { subscription: updated, notice: "The current plan remains active until the end of this billing period." };
  });
}
