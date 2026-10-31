import { createHmac, timingSafeEqual } from "node:crypto";
import { Transform } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

const eventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.enum(["payment.succeeded", "payment.failed"]),
  data: z.object({
    paymentAttemptId: z.string().min(1).max(64),
    amountMinor: z.number().int().positive(),
    currency: z.string().length(3).transform(value => value.toUpperCase())
  }).strict()
}).strict();

function secretFor(provider: string): string | null {
  const envName = `FUNLINK_WEBHOOK_SECRET_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const secret = process.env[envName];
  return secret && secret.length >= 32 ? secret : null;
}

function signatureMatches(rawBody: Buffer, header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== "string") return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header);
  if (!match?.[1]) return false;
  const supplied = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function captureRawBody(request: any) {
  return async (_request: any, _reply: any, payload: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = [];
    const transform = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
        callback(null, chunk);
      },
      flush(callback) {
        request.rawBody = Buffer.concat(chunks);
        callback();
      }
    });
    payload.pipe(transform);
    return transform;
  };
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function webhookRoutes(app: FastifyInstance, db: PrismaClient) {
  app.post("/v1/webhooks/:provider", {
    config: { rawBody: true },
    preParsing: captureRawBody
  }, async (req, reply) => {
    const provider = String((req.params as { provider?: string }).provider ?? "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(provider)) return reply.code(400).send({ error: "Invalid webhook provider" });
    const secret = secretFor(provider);
    if (!secret) {
      req.log.error({ provider }, "Webhook secret is missing or too short");
      return reply.code(503).send({ error: "Webhook provider is not configured" });
    }

    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    if (!Buffer.isBuffer(rawBody)) return reply.code(400).send({ error: "Raw webhook body is unavailable" });
    if (!signatureMatches(rawBody, req.headers["x-funlink-signature"], secret)) {
      req.log.warn({ provider }, "Rejected webhook with invalid signature");
      return reply.code(401).send({ error: "Invalid webhook signature" });
    }

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid webhook event" });
    const event = parsed.data;
    const now = new Date();

    try {
      const outcome = await db.$transaction(async tx => {
        const stored = await tx.webhookEvent.create({
          data: {
            provider,
            providerEventId: event.id,
            payload: event as Prisma.InputJsonValue,
            signatureVerifiedAt: now,
            status: "VERIFIED"
          },
          select: { id: true }
        });

        const payment = await tx.paymentAttempt.findFirst({
          where: { id: event.data.paymentAttemptId, provider },
          include: { invoice: true }
        });
        if (!payment) {
          await tx.webhookEvent.update({ where: { id: stored.id }, data: { status: "FAILED", failureReason: "payment_attempt_not_found" } });
          return { processed: false, reason: "payment_attempt_not_found" };
        }
        if (payment.amountMinor !== event.data.amountMinor || payment.currency.toUpperCase() !== event.data.currency) {
          await tx.webhookEvent.update({ where: { id: stored.id }, data: { paymentAttemptId: payment.id, status: "FAILED", failureReason: "payment_amount_or_currency_mismatch" } });
          return { processed: false, reason: "payment_amount_or_currency_mismatch" };
        }
        if (payment.status !== "PENDING" || payment.invoice.status !== "OPEN") {
          await tx.webhookEvent.update({ where: { id: stored.id }, data: { paymentAttemptId: payment.id, status: "FAILED", failureReason: "payment_or_invoice_not_payable" } });
          return { processed: false, reason: "payment_or_invoice_not_payable" };
        }

        const succeeded = event.type === "payment.succeeded";
        await tx.paymentAttempt.update({
          where: { id: payment.id },
          data: { status: succeeded ? "SUCCEEDED" : "FAILED", ...(succeeded ? { paidAt: now } : {}) }
        });
        if (succeeded) {
          await tx.invoice.update({ where: { id: payment.invoiceId }, data: { status: "PAID", paidAt: now } });
        }
        await tx.webhookEvent.update({
          where: { id: stored.id },
          data: { paymentAttemptId: payment.id, status: "PROCESSED", processedAt: now }
        });
        return { processed: true, paymentStatus: succeeded ? "SUCCEEDED" : "FAILED" };
      });
      if (!outcome.processed) return reply.code(202).send({ received: true, processed: false, reason: outcome.reason });
      return { received: true, processed: true, paymentStatus: outcome.paymentStatus };
    } catch (error) {
      if (isUniqueConflict(error)) return { received: true, duplicate: true };
      throw error;
    }
  });
}
