import { Transform } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  verifyBinancePayWebhook,
  verifyPayPalWebhook,
  verifyVnpayIpn
} from "./payment-providers.js";

type RawRequest = { rawBody?: Buffer };

async function captureRawBody(request: RawRequest, _reply: unknown, payload: NodeJS.ReadableStream) {
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
}

const zeroDecimalCurrencies = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG",
  "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"
]);

function toMinorUnits(value: string, currency: string): number | null {
  const code = currency.toUpperCase();
  const decimals = zeroDecimalCurrencies.has(code) ? 0 : 2;
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) return null;
  const [whole = "", fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  const amount = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (amount <= 0n || amount > 2_147_483_647n) return null;
  return Number(amount);
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function processVerifiedPayment(db: PrismaClient, input: {
  provider: string;
  eventId: string;
  paymentAttemptId: string;
  amountMinor: number;
  currency: string;
  succeeded: boolean;
  payload: unknown;
}) {
  return db.$transaction(async tx => {
    const event = await tx.webhookEvent.create({
      data: {
        provider: input.provider,
        providerEventId: input.eventId,
        payload: input.payload as Prisma.InputJsonValue,
        signatureVerifiedAt: new Date(),
        status: "VERIFIED"
      },
      select: { id: true }
    });
    const payment = await tx.paymentAttempt.findFirst({
      where: { id: input.paymentAttemptId, provider: input.provider },
      include: { invoice: true }
    });
    if (!payment) {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { status: "FAILED", failureReason: "payment_attempt_not_found" } });
      return { processed: false, reason: "payment_attempt_not_found" };
    }
    if (payment.amountMinor !== input.amountMinor || payment.currency.toUpperCase() !== input.currency.toUpperCase()) {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { paymentAttemptId: payment.id, status: "FAILED", failureReason: "payment_amount_or_currency_mismatch" } });
      return { processed: false, reason: "payment_amount_or_currency_mismatch" };
    }
    if (payment.status !== "PENDING" || payment.invoice.status !== "OPEN") {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { paymentAttemptId: payment.id, status: "FAILED", failureReason: "payment_or_invoice_not_payable" } });
      return { processed: false, reason: "payment_or_invoice_not_payable" };
    }
    const now = new Date();
    await tx.paymentAttempt.update({
      where: { id: payment.id },
      data: { status: input.succeeded ? "SUCCEEDED" : "FAILED", ...(input.succeeded ? { paidAt: now } : {}) }
    });
    if (input.succeeded) {
      await tx.invoice.update({ where: { id: payment.invoiceId }, data: { status: "PAID", paidAt: now } });
    }
    await tx.webhookEvent.update({
      where: { id: event.id },
      data: { paymentAttemptId: payment.id, status: "PROCESSED", processedAt: now }
    });
    return { processed: true };
  });
}

function acknowledgeDuplicate(error: unknown): boolean {
  return isUniqueConflict(error);
}

export function nativePaymentWebhookRoutes(app: FastifyInstance, db: PrismaClient) {
  app.get("/v1/webhooks/vnpay", async (request, reply) => {
    const params = request.query as Record<string, unknown>;
    const secret = process.env.VNPAY_HASH_SECRET;
    const tmnCode = process.env.VNPAY_TMN_CODE;
    if (!secret || !tmnCode) return reply.code(503).send({ RspCode: "99", Message: "Provider not configured" });
    if (!verifyVnpayIpn(params, secret)) return reply.code(200).send({ RspCode: "97", Message: "Invalid checksum" });
    if (params.vnp_TmnCode !== tmnCode || typeof params.vnp_TxnRef !== "string" || typeof params.vnp_Amount !== "string" || typeof params.vnp_TransactionNo !== "string") {
      return reply.code(200).send({ RspCode: "99", Message: "Invalid transaction data" });
    }
    const amount = Number(params.vnp_Amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) return reply.code(200).send({ RspCode: "04", Message: "Invalid amount" });
    try {
      const result = await processVerifiedPayment(db, {
        provider: "vnpay",
        eventId: params.vnp_TransactionNo,
        paymentAttemptId: params.vnp_TxnRef,
        amountMinor: amount / 100,
        currency: "VND",
        succeeded: params.vnp_ResponseCode === "00" && params.vnp_TransactionStatus === "00",
        payload: params
      });
      if (!result.processed) return reply.code(200).send({ RspCode: "04", Message: "Transaction not payable or mismatched" });
      return reply.code(200).send({ RspCode: "00", Message: "Confirm Success" });
    } catch (error) {
      if (acknowledgeDuplicate(error)) return reply.code(200).send({ RspCode: "00", Message: "Duplicate transaction" });
      throw error;
    }
  });

  app.post("/v1/webhooks/paypal", { preParsing: captureRawBody }, async (request, reply) => {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    const rawBody = (request as typeof request & RawRequest).rawBody;
    if (!webhookId) return reply.code(503).send({ error: "PayPal webhook is not configured" });
    if (!Buffer.isBuffer(rawBody)) return reply.code(400).send({ error: "Raw webhook body unavailable" });
    const valid = await verifyPayPalWebhook({ rawBody, headers: request.headers, webhookId });
    if (!valid) return reply.code(401).send({ error: "Invalid PayPal webhook signature" });
    let event: any;
    try { event = JSON.parse(rawBody.toString("utf8")); } catch { return reply.code(400).send({ error: "Invalid JSON payload" }); }
    if (typeof event.id !== "string" || typeof event.event_type !== "string") return reply.code(400).send({ error: "Invalid PayPal event" });
    const resource = event.resource ?? {};
    const captureCompleted = event.event_type === "PAYMENT.CAPTURE.COMPLETED" && resource.status === "COMPLETED";
    const captureFailed = event.event_type === "PAYMENT.CAPTURE.DENIED";
    if (!captureCompleted && !captureFailed) return { received: true, ignored: true };
    const attemptId = resource.custom_id ?? resource.invoice_id;
    const amountText = resource.amount?.value;
    const currency = resource.amount?.currency_code;
    if (typeof attemptId !== "string" || typeof amountText !== "string" || typeof currency !== "string") {
      return reply.code(400).send({ error: "PayPal capture is missing payment reference or amount" });
    }
    const amountMinor = toMinorUnits(amountText, currency);
    if (amountMinor === null) return reply.code(400).send({ error: "Unsupported or invalid PayPal amount precision" });
    try {
      const result = await processVerifiedPayment(db, {
        provider: "paypal", eventId: event.id, paymentAttemptId: attemptId,
        amountMinor, currency, succeeded: captureCompleted, payload: event
      });
      if (!result.processed) return reply.code(202).send({ received: true, processed: false });
      return { received: true, processed: true };
    } catch (error) {
      if (acknowledgeDuplicate(error)) return { received: true, duplicate: true };
      throw error;
    }
  });

  app.post("/v1/webhooks/binance-pay", { preParsing: captureRawBody }, async (request, reply) => {
    const publicKeyPem = process.env.BINANCE_PAY_PUBLIC_KEY ?? "";
    const certificateSerial = process.env.BINANCE_PAY_CERTIFICATE_SN ?? "";
    const rawBody = (request as typeof request & RawRequest).rawBody;
    if (!publicKeyPem || !certificateSerial) return reply.code(503).send({ returnCode: "FAIL", returnMessage: "Provider not configured" });
    if (!Buffer.isBuffer(rawBody)) return reply.code(400).send({ returnCode: "FAIL", returnMessage: "Raw body unavailable" });
    if (!verifyBinancePayWebhook({ rawBody, headers: request.headers, publicKeyPem, certificateSerial })) {
      return reply.code(401).send({ returnCode: "FAIL", returnMessage: "Invalid signature" });
    }
    let event: any;
    try { event = JSON.parse(rawBody.toString("utf8")); } catch { return reply.code(400).send({ returnCode: "FAIL", returnMessage: "Invalid JSON" }); }
    if (event.bizType !== "PAY" || typeof event.data !== "string" || !event.bizId) {
      return reply.code(400).send({ returnCode: "FAIL", returnMessage: "Unsupported Binance Pay event" });
    }
    let data: any;
    try { data = JSON.parse(event.data); } catch { return reply.code(400).send({ returnCode: "FAIL", returnMessage: "Invalid payment data" }); }
    if (event.bizStatus !== "PAY_SUCCESS") return { returnCode: "SUCCESS", returnMessage: null };
    if (typeof data.merchantTradeNo !== "string" || typeof data.totalFee !== "number" && typeof data.totalFee !== "string" || typeof data.currency !== "string") {
      return reply.code(400).send({ returnCode: "FAIL", returnMessage: "Missing payment fields" });
    }
    const amountMinor = toMinorUnits(String(data.totalFee), data.currency);
    if (amountMinor === null) return reply.code(400).send({ returnCode: "FAIL", returnMessage: "Unsupported currency precision" });
    try {
      const result = await processVerifiedPayment(db, {
        provider: "binancepay", eventId: String(event.bizId), paymentAttemptId: data.merchantTradeNo,
        amountMinor, currency: data.currency, succeeded: true, payload: event
      });
      if (!result.processed) return reply.code(202).send({ returnCode: "FAIL", returnMessage: "Payment mismatch" });
      return { returnCode: "SUCCESS", returnMessage: null };
    } catch (error) {
      if (acknowledgeDuplicate(error)) return { returnCode: "SUCCESS", returnMessage: null };
      throw error;
    }
  });
}
