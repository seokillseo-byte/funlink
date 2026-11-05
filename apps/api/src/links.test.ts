import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {buildApp} from "./app.js";
import {loadConfig} from "./config.js";

const config = loadConfig({NODE_ENV: "test", API_HOST: "127.0.0.1", API_PORT: "3013"});
const rawSession = "funlink-links-test-session-token";
const cookie = "funlink_session=" + rawSession;
const tokenHash = createHash("sha256").update(rawSession, "utf8").digest("hex");

function authenticatedSession(role = "OWNER") {
  return {
    tokenHash,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: "user-1",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      memberships: [{role, tenant: {status: "ACTIVE"}}]
    }
  };
}

test("workspace link creation requires an authenticated workspace", async () => {
  const prisma = {session: {findUnique: async () => null}} as unknown as PrismaClient;
  const app = buildApp({config, logger: false, prisma});
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-1/links",
    payload: {targetUrl: "https://example.com"}
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test("workspace member can create a validated short link", async () => {
  let created: any;
  let audited = false;
  const prisma = {
    session: {findUnique: async () => authenticatedSession("MEMBER")},
    link: {create: async ({data}: any) => {
      created = data;
      return {id: "link-1", slug: data.slug, targetUrl: data.targetUrl, title: data.title, status: "ACTIVE", redirectCode: data.redirectCode, expiresAt: null, createdAt: new Date()};
    }},
    auditLog: {create: async () => {audited = true;}}
  } as unknown as PrismaClient;
  const app = buildApp({config, logger: false, prisma});
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-1/links",
    headers: {cookie},
    payload: {slug: "campaign-2026", targetUrl: "https://example.com/landing", title: "Campaign"}
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().link.slug, "campaign-2026");
  assert.equal(created.tenantId, "tenant-1");
  assert.equal(created.targetUrl, "https://example.com/landing");
  assert.equal(audited, true);
  await app.close();
});

test("workspace link creation rejects non-HTTP target URLs", async () => {
  const prisma = {session: {findUnique: async () => authenticatedSession()}} as unknown as PrismaClient;
  const app = buildApp({config, logger: false, prisma});
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces/tenant-1/links",
    headers: {cookie},
    payload: {targetUrl: "javascript:alert(1)"}
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});

test("public redirect records a click and redirects to the stored destination", async () => {
  let click: any;
  const prisma = {
    link: {findFirst: async () => ({
      id: "link-1", tenantId: "tenant-1", targetUrl: "https://example.com/landing", redirectCode: 302
    })},
    clickEvent: {create: async ({data}: any) => {click = data;}}
  } as unknown as PrismaClient;
  const app = buildApp({config, logger: false, prisma});
  const response = await app.inject({
    method: "GET",
    url: "/v1/redirect/campaign-2026",
    headers: {"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"}
  });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "https://example.com/landing");
  assert.equal(click.tenantId, "tenant-1");
  assert.equal(click.linkId, "link-1");
  assert.equal(click.deviceType, "mobile");
  await app.close();
});

test("public redirect returns 404 for an unknown or invalid slug", async () => {
  const prisma = {link: {findFirst: async () => null}} as unknown as PrismaClient;
  const app = buildApp({config, logger: false, prisma});
  const missing = await app.inject({method: "GET", url: "/v1/redirect/not-found"});
  const invalid = await app.inject({method: "GET", url: "/v1/redirect/%3Cscript%3E"});
  assert.equal(missing.statusCode, 404);
  assert.equal(invalid.statusCode, 404);
  await app.close();
});
