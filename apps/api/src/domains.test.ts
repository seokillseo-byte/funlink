import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { PrismaClient } from "@prisma/client";
import {
  domainRoutes,
  createDomainVerificationToken,
  matchesDomainVerificationToken,
  normalizeDomainHostname
} from "./domains.js";
import { createHash } from "node:crypto";

const sessionCookie = "funlink_session=domain-test-session";
const activeSession = {
  revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  user: {
    id: "user-owner",
    status: "ACTIVE",
    emailVerifiedAt: new Date(),
    memberships: [{ role: "OWNER", tenant: { status: "ACTIVE" } }]
  }
};
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function buildDomainTestApp(db: Record<string, any>, lookupTxt?: (hostname: string) => Promise<string[][]>) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  domainRoutes(app, db as unknown as PrismaClient, lookupTxt);
  await app.ready();
  return app;
}

test("domain hostname normalization accepts public hostnames and rejects URLs/IPs", () => {
  assert.equal(normalizeDomainHostname("  WWW.Example.COM. "), "www.example.com");
  assert.equal(normalizeDomainHostname("münich.example"), "xn--mnich-kva.example");
  assert.equal(normalizeDomainHostname("https://example.com"), null);
  assert.equal(normalizeDomainHostname("127.0.0.1"), null);
  assert.equal(normalizeDomainHostname("localhost"), null);
});

test("verification tokens are high entropy and compared using their stored SHA-256 hash", () => {
  const token = createDomainVerificationToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(matchesDomainVerificationToken(token, sha(token)), true);
  assert.equal(matchesDomainVerificationToken("wrong-token", sha(token)), false);
  assert.equal(matchesDomainVerificationToken(token, null), false);
  assert.equal(matchesDomainVerificationToken(token, "not-a-hash"), false);
});

test("creating a domain returns the DNS TXT token once and stores only its hash", async () => {
  let saved: any;
  const db = {
    session: { findUnique: async () => activeSession },
    domain: {
      create: async ({ data, select }: any) => {
        saved = data;
        return { id: "domain-1", hostname: data.hostname, status: data.status, verificationExpiresAt: data.verificationExpiresAt, createdAt: new Date() };
      }
    }
  };
  const app = await buildDomainTestApp(db);
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-1/domains",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    payload: { hostname: "Example.com" }
  });
  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.dnsRecord.name, "_funlink-verification.example.com");
  assert.match(body.dnsRecord.value, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(saved.hostname, "example.com");
  assert.equal(saved.verificationTokenHash, sha(body.dnsRecord.value));
  assert.notEqual(saved.verificationTokenHash, body.dnsRecord.value);
  assert.ok(saved.verificationExpiresAt.getTime() > Date.now());
  assert.equal(saved.verificationAttempts, 0);
  await app.close();
});

test("domain creation is tenant scoped and denies a user without membership", async () => {
  let created = false;
  const db = {
    session: { findUnique: async () => ({ ...activeSession, user: { ...activeSession.user, memberships: [] } }) },
    domain: { create: async () => { created = true; return {}; } }
  };
  const app = await buildDomainTestApp(db);
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/another-tenant/domains",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    payload: { hostname: "example.com" }
  });
  assert.equal(response.statusCode, 404);
  assert.equal(created, false);
  await app.close();
});

test("verification succeeds only when DNS TXT contains the exact unexpired token", async () => {
  const token = createDomainVerificationToken();
  let update: any;
  const db = {
    session: { findUnique: async () => activeSession },
    domain: {
      findFirst: async () => ({
        id: "domain-1", hostname: "example.com", status: "PENDING_VERIFICATION",
        verificationTokenHash: sha(token), verificationExpiresAt: new Date(Date.now() + 60_000), verificationAttempts: 0
      }),
      updateMany: async (args: any) => { update = args; return { count: 1 }; }
    }
  };
  const app = await buildDomainTestApp(db, async name => {
    assert.equal(name, "_funlink-verification.example.com");
    return [[token]];
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-1/domains/domain-1/verify",
    headers: { cookie: sessionCookie }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "VERIFIED");
  assert.equal(update.data.status, "VERIFIED");
  assert.equal(update.data.verificationTokenHash, null);
  assert.equal(update.data.verificationExpiresAt, null);
  await app.close();
});

test("wrong DNS TXT increments persistent attempts and never verifies the domain", async () => {
  let update: any;
  const token = createDomainVerificationToken();
  const db = {
    session: { findUnique: async () => activeSession },
    domain: {
      findFirst: async () => ({
        id: "domain-1", hostname: "example.com", status: "PENDING_VERIFICATION",
        verificationTokenHash: sha(token), verificationExpiresAt: new Date(Date.now() + 60_000), verificationAttempts: 0
      }),
      updateMany: async (args: any) => { update = args; return { count: 1 }; }
    }
  };
  const app = await buildDomainTestApp(db, async () => [["attacker-controlled-value"]]);
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-1/domains/domain-1/verify",
    headers: { cookie: sessionCookie }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(update.data.verificationAttempts.increment, 1);
  assert.equal(update.data.status, undefined);
  await app.close();
});

test("expired verification token is rejected without a DNS lookup", async () => {
  let lookedUp = false;
  const token = createDomainVerificationToken();
  const db = {
    session: { findUnique: async () => activeSession },
    domain: {
      findFirst: async () => ({
        id: "domain-1", hostname: "example.com", status: "PENDING_VERIFICATION",
        verificationTokenHash: sha(token), verificationExpiresAt: new Date(Date.now() - 1_000), verificationAttempts: 0
      })
    }
  };
  const app = await buildDomainTestApp(db, async () => { lookedUp = true; return [[token]]; });
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-1/domains/domain-1/verify",
    headers: { cookie: sessionCookie }
  });
  assert.equal(response.statusCode, 410);
  assert.equal(lookedUp, false);
  await app.close();
});


test("workspace domain listing includes domain status and slug mappings", async () => {
  const db = {
    session: { findUnique: async () => activeSession },
    domain: { findMany: async () => [{id: "domain-1", hostname: "go.example.com", status: "VERIFIED", tlsStatus: "PENDING", slugMappings: []}] }
  };
  const app = await buildDomainTestApp(db);
  const response = await app.inject({
    method: "GET",
    url: "/v1/workspaces/tenant-1/domains",
    headers: { cookie: sessionCookie }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().domains[0].hostname, "go.example.com");
  assert.equal(response.json().domains[0].tlsStatus, "PENDING");
  await app.close();
});

test("workspace administrator can map a verified domain slug to a link", async () => {
  let mappingData: any;
  let audit: any;
  const db = {
    session: { findUnique: async () => activeSession },
    domain: { findFirst: async () => ({id: "domain-1", hostname: "go.example.com", status: "VERIFIED", tlsStatus: "PENDING"}) },
    link: { findFirst: async () => ({id: "link-1", slug: "campaign", status: "ACTIVE"}) },
    linkDomainSlug: {
      create: async ({data}: any) => {
        mappingData = data;
        return {id: "mapping-1", slug: data.slug, domainId: data.domainId, linkId: data.linkId, createdAt: new Date()};
      }
    },
    auditLog: {create: async ({data}: any) => {audit = data;}}
  };
  const app = await buildDomainTestApp(db);
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-1/domains/domain-1/slugs",
    headers: {cookie: sessionCookie, "content-type": "application/json"},
    payload: {linkId: "link-1", slug: "brand-campaign"}
  });
  assert.equal(response.statusCode, 201);
  assert.equal(mappingData.tenantId, "tenant-1");
  assert.equal(mappingData.domainId, "domain-1");
  assert.equal(mappingData.linkId, "link-1");
  assert.equal(response.json().domain.status, "VERIFIED");
  assert.match(response.json().notice, /TLS are active/);
  assert.equal(audit.action, "domain.slug_mapping.created");
  await app.close();
});

test("workspace administrator cannot map a link from another workspace", async () => {
  let created = false;
  const db = {
    session: { findUnique: async () => activeSession },
    domain: { findFirst: async () => ({id: "domain-1", hostname: "go.example.com", status: "VERIFIED", tlsStatus: "PENDING"}) },
    link: { findFirst: async () => null },
    linkDomainSlug: {create: async () => {created = true; return {};}}
  };
  const app = await buildDomainTestApp(db);
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-1/domains/domain-1/slugs",
    headers: {cookie: sessionCookie, "content-type": "application/json"},
    payload: {linkId: "link-from-other-tenant", slug: "brand-campaign"}
  });
  assert.equal(response.statusCode, 404);
  assert.equal(created, false);
  await app.close();
});

test("workspace administrator can remove a custom-domain slug mapping", async () => {
  let deletedWhere: any;
  let audit: any;
  const db = {
    session: { findUnique: async () => activeSession },
    linkDomainSlug: {deleteMany: async ({where}: any) => {deletedWhere = where; return {count: 1};}},
    auditLog: {create: async ({data}: any) => {audit = data;}}
  };
  const app = await buildDomainTestApp(db);
  const response = await app.inject({
    method: "DELETE",
    url: "/v1/workspaces/tenant-1/domains/domain-1/slugs/mapping-1",
    headers: {cookie: sessionCookie}
  });
  assert.equal(response.statusCode, 200);
  assert.equal(deletedWhere.tenantId, "tenant-1");
  assert.equal(deletedWhere.domainId, "domain-1");
  assert.equal(audit.action, "domain.slug_mapping.deleted");
  await app.close();
});
