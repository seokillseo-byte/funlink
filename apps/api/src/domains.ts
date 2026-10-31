import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { resolveTxt } from "node:dns/promises";
import { domainToASCII } from "node:url";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const VERIFY_RATE_LIMIT = 10;
const VERIFY_RATE_WINDOW_MS = 15 * 60 * 1000;
const attemptsByActor = new Map<string, { count: number; resetAt: number }>();

type TxtLookup = (hostname: string) => Promise<string[][]>;
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const createDomainVerificationToken = () => randomBytes(32).toString("base64url");

export function normalizeDomainHostname(value: string): string | null {
  const ascii = domainToASCII(value.trim().replace(/\\.$/, "").toLowerCase());
  if (!ascii || ascii.length > 253 || isIP(ascii)) return null;
  const labels = ascii.split(".");
  if (labels.length < 2 || labels.some(label => label.length < 1 || label.length > 63)) return null;
  if (!labels.every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return ascii;
}

export function matchesDomainVerificationToken(candidate: string, storedHash: string | null): boolean {
  if (!storedHash || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const candidateHash = Buffer.from(sha256(candidate), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  for (const [entry, value] of attemptsByActor) if (value.resetAt <= now) attemptsByActor.delete(entry);
  const current = attemptsByActor.get(key);
  if (!current || current.resetAt <= now) {
    attemptsByActor.set(key, { count: 1, resetAt: now + VERIFY_RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > VERIFY_RATE_LIMIT;
}

async function workspaceAccess(req: any, db: PrismaClient, tenantId: string) {
  const rawSession = req.cookies?.funlink_session;
  if (!rawSession) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(rawSession) },
    include: {
      user: {
        select: {
          id: true,
          status: true,
          emailVerifiedAt: true,
          memberships: {
            where: { tenantId },
            select: { role: true, tenant: { select: { status: true } } }
          }
        }
      }
    }
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== "ACTIVE" || !session.user.emailVerifiedAt) return null;
  const membership = session.user.memberships[0];
  if (!membership || membership.tenant.status !== "ACTIVE") return null;
  return { userId: session.user.id, role: membership.role };
}

const paramsSchema = z.object({ tenantId: z.string().min(1).max(64), domainId: z.string().min(1).max(64).optional() });
const hostnameSchema = z.object({ hostname: z.string().trim().min(1).max(253) });

export function domainRoutes(app: FastifyInstance, db: PrismaClient, lookupTxt: TxtLookup = resolveTxt) {
  app.post("/v1/workspaces/:tenantId/domains", async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    const body = hostnameSchema.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid domain details" });
    const access = await workspaceAccess(req, db, params.data.tenantId);
    if (!access) return reply.code(404).send({ error: "Workspace not found" });
    if (access.role !== "OWNER" && access.role !== "ADMIN") return reply.code(403).send({ error: "Workspace administrator required" });
    const hostname = normalizeDomainHostname(body.data.hostname);
    if (!hostname) return reply.code(400).send({ error: "Enter a valid public domain hostname" });

    const rawToken = createDomainVerificationToken();
    const now = new Date();
    try {
      const domain = await db.domain.create({
        data: {
          tenantId: params.data.tenantId,
          hostname,
          verificationTokenHash: sha256(rawToken),
          verificationExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
          verificationAttempts: 0,
          status: "PENDING_VERIFICATION"
        },
        select: { id: true, hostname: true, status: true, verificationExpiresAt: true, createdAt: true }
      });
      return reply.code(201).send({
        domain,
        dnsRecord: { type: "TXT", name: `_funlink-verification.${hostname}`, value: rawToken },
        notice: "Copy this TXT value now. FunLink stores only its hash and will not show the token again."
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "This domain is already registered" });
      }
      throw error;
    }
  });

  app.post("/v1/workspaces/:tenantId/domains/:domainId/verification/rotate", async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success || !params.data.domainId) return reply.code(400).send({ error: "Invalid domain reference" });
    const access = await workspaceAccess(req, db, params.data.tenantId);
    if (!access) return reply.code(404).send({ error: "Workspace not found" });
    if (access.role !== "OWNER" && access.role !== "ADMIN") return reply.code(403).send({ error: "Workspace administrator required" });

    const rawToken = createDomainVerificationToken();
    const now = new Date();
    const updated = await db.domain.updateMany({
      where: { id: params.data.domainId, tenantId: params.data.tenantId, status: { in: ["PENDING_VERIFICATION", "FAILED"] } },
      data: {
        verificationTokenHash: sha256(rawToken),
        verificationExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        verificationAttempts: 0,
        status: "PENDING_VERIFICATION",
        verifiedAt: null
      }
    });
    if (updated.count !== 1) return reply.code(404).send({ error: "Pending domain not found" });
    const domain = await db.domain.findFirst({
      where: { id: params.data.domainId, tenantId: params.data.tenantId },
      select: { id: true, hostname: true, status: true, verificationExpiresAt: true }
    });
    if (!domain) return reply.code(404).send({ error: "Pending domain not found" });
    return {
      domain,
      dnsRecord: { type: "TXT", name: `_funlink-verification.${domain.hostname}`, value: rawToken },
      notice: "The previous token is invalid. Copy this new TXT value; it is shown only once."
    };
  });

  app.post("/v1/workspaces/:tenantId/domains/:domainId/verify", async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success || !params.data.domainId) return reply.code(400).send({ error: "Invalid domain reference" });
    const access = await workspaceAccess(req, db, params.data.tenantId);
    if (!access) return reply.code(404).send({ error: "Workspace not found" });
    if (access.role !== "OWNER" && access.role !== "ADMIN") return reply.code(403).send({ error: "Workspace administrator required" });
    const rateKey = `${access.userId}:${params.data.domainId}`;
    if (isRateLimited(rateKey)) return reply.code(429).send({ error: "Too many verification requests. Try again later." });

    const domain = await db.domain.findFirst({
      where: { id: params.data.domainId, tenantId: params.data.tenantId },
      select: { id: true, hostname: true, status: true, verificationTokenHash: true, verificationExpiresAt: true, verificationAttempts: true }
    });
    if (!domain || domain.status !== "PENDING_VERIFICATION") return reply.code(404).send({ error: "Pending domain not found" });
    const now = new Date();
    if (!domain.verificationTokenHash || !domain.verificationExpiresAt || domain.verificationExpiresAt <= now) {
      return reply.code(410).send({ error: "Verification token expired. Generate a new token to continue." });
    }
    if (domain.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
      return reply.code(429).send({ error: "Verification attempt limit reached. Generate a new token to continue." });
    }

    let records: string[][];
    try {
      records = await lookupTxt(`_funlink-verification.${domain.hostname}`);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN") records = [];
      else {
        req.log.warn({ domainId: domain.id, dnsCode: code }, "Domain TXT lookup failed");
        return reply.code(503).send({ error: "DNS lookup is temporarily unavailable. Try again shortly." });
      }
    }

    const candidates = records.map(record => record.join(""));
    const matched = candidates.some(value => matchesDomainVerificationToken(value, domain.verificationTokenHash));
    if (!matched) {
      const nextAttempts = domain.verificationAttempts + 1;
      await db.domain.updateMany({
        where: {
          id: domain.id,
          tenantId: params.data.tenantId,
          status: "PENDING_VERIFICATION",
          verificationTokenHash: domain.verificationTokenHash,
          verificationExpiresAt: { gt: now },
          verificationAttempts: { lt: MAX_VERIFICATION_ATTEMPTS }
        },
        data: {
          verificationAttempts: { increment: 1 },
          ...(nextAttempts >= MAX_VERIFICATION_ATTEMPTS ? { status: "FAILED" as const } : {})
        }
      });
      return reply.code(nextAttempts >= MAX_VERIFICATION_ATTEMPTS ? 429 : 400).send({
        error: nextAttempts >= MAX_VERIFICATION_ATTEMPTS
          ? "Verification attempt limit reached. Generate a new token to continue."
          : "TXT verification record was not found or did not match."
      });
    }

    const claimed = await db.domain.updateMany({
      where: {
        id: domain.id,
        tenantId: params.data.tenantId,
        status: "PENDING_VERIFICATION",
        verificationTokenHash: domain.verificationTokenHash,
        verificationExpiresAt: { gt: now },
        verificationAttempts: { lt: MAX_VERIFICATION_ATTEMPTS }
      },
      data: {
        status: "VERIFIED",
        verifiedAt: now,
        verificationTokenHash: null,
        verificationExpiresAt: null
      }
    });
    if (claimed.count !== 1) return reply.code(409).send({ error: "Verification state changed. Refresh and try again." });
    return { ok: true, status: "VERIFIED", verifiedAt: now.toISOString() };
  });
}
