import {createHash, randomBytes} from "node:crypto";
import type {FastifyInstance} from "fastify";
import type {PrismaClient} from "@prisma/client";
import {z} from "zod";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const tenantParams = z.object({tenantId: z.string().min(1).max(64)});
const linkParams = tenantParams.extend({linkId: z.string().min(1).max(64)});
const slugPattern = /^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])?$/;
const slugSchema = z.string().trim().min(3).max(64).regex(slugPattern, "Slug must use lowercase letters, numbers, hyphens or underscores.");

const targetUrlSchema = z.string().trim().url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Target URL must be a valid HTTP or HTTPS URL.");

async function workspaceAccess(req: any, db: PrismaClient, tenantId: string) {
  const rawSession = req.cookies?.funlink_session;
  if (!rawSession) return null;
  const session = await db.session.findUnique({
    where: {tokenHash: sha256(rawSession)},
    include: {
      user: {
        select: {
          id: true,
          status: true,
          emailVerifiedAt: true,
          memberships: {
            where: {tenantId},
            select: {role: true, tenant: {select: {status: true}}}
          }
        }
      }
    }
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== "ACTIVE" || !session.user.emailVerifiedAt) return null;
  const membership = session.user.memberships[0];
  if (!membership || membership.tenant.status !== "ACTIVE") return null;
  return {userId: session.user.id, role: membership.role};
}

function canWrite(role: string) {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}

function generatedSlug() {
  return randomBytes(6).toString("hex");
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const createSchema = z.object({
  targetUrl: targetUrlSchema,
  slug: slugSchema.optional(),
  title: z.string().trim().max(160).nullable().optional(),
  campaignId: z.string().min(1).max(64).nullable().optional(),
  redirectCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional().default(302),
  expiresAt: z.string().datetime().nullable().optional()
});

const updateSchema = z.object({
  targetUrl: targetUrlSchema.optional(),
  slug: slugSchema.optional(),
  title: z.string().trim().max(160).nullable().optional(),
  campaignId: z.string().min(1).max(64).nullable().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
  redirectCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional(),
  expiresAt: z.string().datetime().nullable().optional()
}).refine(value => Object.keys(value).length > 0, "At least one field is required");

export function linkRoutes(app: FastifyInstance, db: PrismaClient) {
  app.get("/v1/workspaces/:tenantId/links", async (req, reply) => {
    const params = tenantParams.safeParse(req.params);
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
      status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
      search: z.string().trim().max(120).optional()
    }).safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({error: "Invalid link query"});
    const access = await workspaceAccess(req, db, params.data.tenantId);
    if (!access) return reply.code(404).send({error: "Workspace not found"});

    const search = query.data.search;
    const where = {
      tenantId: params.data.tenantId,
      ...(query.data.status ? {status: query.data.status} : {}),
      ...(search ? {OR: [{slug: {contains: search, mode: "insensitive" as const}}, {title: {contains: search, mode: "insensitive" as const}}, {targetUrl: {contains: search, mode: "insensitive" as const}}]} : {})
    };
    const [links, total] = await Promise.all([
      db.link.findMany({
        where,
        orderBy: {createdAt: "desc"},
        skip: query.data.offset,
        take: query.data.limit,
        select: {
          id: true, slug: true, targetUrl: true, title: true, status: true,
          redirectCode: true, expiresAt: true, createdAt: true, updatedAt: true,
          campaign: {select: {id: true, name: true}},
          _count: {select: {clickEvents: true}}
        }
      }),
      db.link.count({where})
    ]);
    return {links, pagination: {limit: query.data.limit, offset: query.data.offset, total}};
  });

  app.post("/v1/workspaces/:tenantId/links", async (req, reply) => {
    const params = tenantParams.safeParse(req.params);
    const parsed = createSchema.safeParse(req.body);
    if (!params.success || !parsed.success) return reply.code(400).send({error: "Invalid link details"});
    const access = await workspaceAccess(req, db, params.data.tenantId);
    if (!access) return reply.code(404).send({error: "Workspace not found"});
    if (!canWrite(access.role)) return reply.code(403).send({error: "Workspace write access required"});

    const data = parsed.data;
    if (data.campaignId) {
      const campaign = await db.campaign.findFirst({where: {id: data.campaignId, tenantId: params.data.tenantId}, select: {id: true}});
      if (!campaign) return reply.code(400).send({error: "Campaign does not belong to this workspace"});
    }
    try {
      const link = await db.link.create({
        data: {
          tenantId: params.data.tenantId,
          slug: data.slug ?? generatedSlug(),
          targetUrl: data.targetUrl,
          title: data.title ?? null,
          campaignId: data.campaignId ?? null,
          redirectCode: data.redirectCode,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null
        },
        select: {id: true, slug: true, targetUrl: true, title: true, status: true, redirectCode: true, expiresAt: true, createdAt: true}
      });
      await db.auditLog.create({data: {
        tenantId: params.data.tenantId, actorId: access.userId,
        action: "link.created", entityType: "Link", entityId: link.id,
        metadata: {slug: link.slug}
      }});
      return reply.code(201).send({link});
    } catch (error) {
      if (isUniqueConflict(error)) return reply.code(409).send({error: "This short link slug is already in use"});
      throw error;
    }
  });

  app.patch("/v1/workspaces/:tenantId/links/:linkId", async (req, reply) => {
    const params = linkParams.safeParse(req.params);
    const parsed = updateSchema.safeParse(req.body);
    if (!params.success || !parsed.success) return reply.code(400).send({error: "Invalid link update"});
    const access = await workspaceAccess(req, db, params.data.tenantId);
    if (!access) return reply.code(404).send({error: "Workspace not found"});
    if (!canWrite(access.role)) return reply.code(403).send({error: "Workspace write access required"});
    const data = parsed.data;
    if (data.campaignId) {
      const campaign = await db.campaign.findFirst({where: {id: data.campaignId, tenantId: params.data.tenantId}, select: {id: true}});
      if (!campaign) return reply.code(400).send({error: "Campaign does not belong to this workspace"});
    }
    try {
      const result = await db.link.updateMany({
        where: {id: params.data.linkId, tenantId: params.data.tenantId},
        data: {
          ...(data.targetUrl !== undefined ? {targetUrl: data.targetUrl} : {}),
          ...(data.slug !== undefined ? {slug: data.slug} : {}),
          ...(data.title !== undefined ? {title: data.title} : {}),
          ...(data.campaignId !== undefined ? {campaignId: data.campaignId} : {}),
          ...(data.status !== undefined ? {status: data.status} : {}),
          ...(data.redirectCode !== undefined ? {redirectCode: data.redirectCode} : {}),
          ...(data.expiresAt !== undefined ? {expiresAt: data.expiresAt ? new Date(data.expiresAt) : null} : {})
        }
      });
      if (result.count !== 1) return reply.code(404).send({error: "Link not found"});
      const link = await db.link.findFirst({
        where: {id: params.data.linkId, tenantId: params.data.tenantId},
        select: {id: true, slug: true, targetUrl: true, title: true, status: true, redirectCode: true, expiresAt: true, updatedAt: true}
      });
      await db.auditLog.create({data: {
        tenantId: params.data.tenantId, actorId: access.userId,
        action: "link.updated", entityType: "Link", entityId: params.data.linkId,
        metadata: {fields: Object.keys(data)}
      }});
      return {link};
    } catch (error) {
      if (isUniqueConflict(error)) return reply.code(409).send({error: "This short link slug is already in use"});
      throw error;
    }
  });

  app.delete("/v1/workspaces/:tenantId/links/:linkId", async (req, reply) => {
    const params = linkParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({error: "Invalid link reference"});
    const access = await workspaceAccess(req, db, params.data.tenantId);
    if (!access) return reply.code(404).send({error: "Workspace not found"});
    if (!canWrite(access.role)) return reply.code(403).send({error: "Workspace write access required"});
    const result = await db.link.updateMany({
      where: {id: params.data.linkId, tenantId: params.data.tenantId, status: {not: "ARCHIVED"}},
      data: {status: "ARCHIVED"}
    });
    if (result.count !== 1) return reply.code(404).send({error: "Active link not found"});
    await db.auditLog.create({data: {
      tenantId: params.data.tenantId, actorId: access.userId,
      action: "link.archived", entityType: "Link", entityId: params.data.linkId
    }});
    return {ok: true, status: "ARCHIVED"};
  });

  app.get("/v1/redirect/:slug", async (req, reply) => {
    const params = z.object({slug: slugSchema}).safeParse(req.params);
    if (!params.success) return reply.code(404).send({error: "Link not found"});
    const forwardedHost = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
    const hostname = String(forwardedHost).split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
    const domain = hostname
      ? await db.domain.findFirst({where: {hostname}, select: {id: true, status: true, tlsStatus: true}})
      : null;

    let link: {id: string; tenantId: string; targetUrl: string; redirectCode: number} | null = null;
    if (domain) {
      if (domain.status !== "ACTIVE" || domain.tlsStatus !== "ACTIVE") {
        return reply.code(404).send({error: "Link not found or domain is not active"});
      }
      const mapping = await db.linkDomainSlug.findFirst({
        where: {domainId: domain.id, slug: params.data.slug},
        select: {
          link: {select: {id: true, tenantId: true, targetUrl: true, redirectCode: true, status: true, expiresAt: true}}
        }
      });
      const mappedLink = mapping?.link;
      if (mappedLink && mappedLink.status === "ACTIVE" && (!mappedLink.expiresAt || mappedLink.expiresAt > new Date())) {
        link = {id: mappedLink.id, tenantId: mappedLink.tenantId, targetUrl: mappedLink.targetUrl, redirectCode: mappedLink.redirectCode};
      }
    } else {
      link = await db.link.findFirst({
        where: {
          slug: params.data.slug,
          status: "ACTIVE",
          OR: [{expiresAt: null}, {expiresAt: {gt: new Date()}}]
        },
        select: {id: true, tenantId: true, targetUrl: true, redirectCode: true}
      });
    }
    if (!link) return reply.code(404).send({error: "Link not found or expired"});

    const referer = req.headers.referer;
    let refererHost: string | null = null;
    if (typeof referer === "string") {
      try {refererHost = new URL(referer).hostname.slice(0, 253);} catch {}
    }
    const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 512);
    const deviceType = /tablet|ipad/i.test(userAgent) ? "tablet" : /mobile|android|iphone/i.test(userAgent) ? "mobile" : "desktop";
    const ipSecret = process.env.CLICK_IP_HASH_SECRET;
    const ipHash = ipSecret && req.ip ? sha256(ipSecret + ":" + req.ip) : undefined;
    await db.clickEvent.create({data: {
      tenantId: link.tenantId,
      linkId: link.id,
      refererHost,
      deviceType,
      ...(ipHash ? {ipHash} : {})
    }});
    return reply.redirect(link.targetUrl, link.redirectCode);
  });
}
