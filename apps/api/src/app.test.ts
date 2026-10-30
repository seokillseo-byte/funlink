import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig({ NODE_ENV: "test", API_HOST: "127.0.0.1", API_PORT: "3013" });

test("GET /health returns service health", async () => {
  const app = buildApp({ config, logger: false });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", service: "funlink-api" });
  await app.close();
});

test("GET /ready returns 503 when database is not configured", async () => {
  const app = buildApp({ config, logger: false });
  const response = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.database, "not_configured");
  await app.close();
});

test("GET /ready succeeds when database probe succeeds", async () => {
  const prisma = { async $queryRaw<T>() { return [{ result: 1 }] as T; } } as unknown as PrismaClient;
  const app = buildApp({ config, logger: false, prisma });
  const response = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ready", checks: { database: "ok" } });
  await app.close();
});

test("GET /ready returns 503 when database probe fails", async () => {
  const prisma = { $queryRaw: async () => { throw new Error("offline"); } } as unknown as PrismaClient;
  const app = buildApp({ config, logger: false, prisma });
  const response = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.database, "error");
  await app.close();
});

test("invalid API port is rejected", () => {
  assert.throws(() => loadConfig({ API_PORT: "70000" }), /Invalid API environment/);
});

test("state-changing requests reject an untrusted Origin", async () => {
  const app = buildApp({ config, logger: false });
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    payload: { email: "test@example.com", password: "not-a-real-password" }
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: "Request origin is not allowed" });
  await app.close();
});

test("workspace endpoints do not reveal workspace data without a valid session", async () => {
  const prisma = {
    session: { findUnique: async () => null }
  } as unknown as PrismaClient;
  const app = buildApp({ config, logger: false, prisma });
  const workspace = await app.inject({ method: "GET", url: "/v1/workspaces/tenant-secret" });
  const members = await app.inject({ method: "GET", url: "/v1/workspaces/tenant-secret/members" });
  assert.equal(workspace.statusCode, 404);
  assert.deepEqual(workspace.json(), { error: "Workspace not found" });
  assert.equal(members.statusCode, 404);
  assert.deepEqual(members.json(), { error: "Workspace not found" });
  await app.close();
});

test("workspace member endpoint requires an authenticated workspace administrator", async () => {
  const prisma = {
    session: { findUnique: async () => null }
  } as unknown as PrismaClient;
  const app = buildApp({ config, logger: false, prisma });
  const response = await app.inject({ method: "GET", url: "/v1/workspaces/tenant-secret/members", headers: { cookie: "funlink_session=invalid" } });
  assert.equal(response.statusCode, 404);
  await app.close();
});


function workspacePrisma(role: string | null, overrides: Record<string, unknown> = {}) {
  const membership = role ? { role, tenant: { id: "tenant-1", name: "Test workspace", slug: "test", status: "ACTIVE" } } : null;
  const session = {
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: "user-1",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      memberships: membership ? [membership] : []
    }
  };
  return {
    session: { findUnique: async () => session },
    tenantMember: {
      findMany: async () => [{ id: "member-1", role: "MEMBER", user: { id: "user-2", email: "member@example.com" } }],
      ...overrides
    },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
      tenantMember: {
        update: async ({ data }: any) => ({ id: "member-2", role: data.role, userId: "user-2" }),
        deleteMany: async () => ({ count: 1 })
      },
      auditLog: { create: async () => ({ id: "audit-1" }) }
    })
  } as unknown as PrismaClient;
}

const sessionCookie = "funlink_session=test-session";

test("workspace member list is available to an OWNER or ADMIN", async () => {
  for (const role of ["OWNER", "ADMIN"]) {
    const prisma = workspacePrisma(role);
    const app = buildApp({ config, logger: false, prisma });
    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/tenant-1/members",
      headers: { cookie: sessionCookie }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().members[0].id, "member-1");
    await app.close();
  }
});

test("workspace member list denies a non-admin and hides another tenant", async () => {
  const viewer = buildApp({ config, logger: false, prisma: workspacePrisma("VIEWER") });
  const denied = await viewer.inject({
    method: "GET",
    url: "/v1/workspaces/tenant-1/members",
    headers: { cookie: sessionCookie }
  });
  assert.equal(denied.statusCode, 403);
  await viewer.close();

  const otherTenant = buildApp({ config, logger: false, prisma: workspacePrisma(null) });
  const hidden = await otherTenant.inject({
    method: "GET",
    url: "/v1/workspaces/tenant-2/members",
    headers: { cookie: sessionCookie }
  });
  assert.equal(hidden.statusCode, 404);
  await otherTenant.close();
});

test("workspace role update requires OWNER to promote ADMIN", async () => {
  const adminApp = buildApp({ config, logger: false, prisma: workspacePrisma("ADMIN", {
    findFirst: async () => ({ id: "member-2", role: "MEMBER", userId: "user-2" })
  }) });
  const denied = await adminApp.inject({
    method: "PATCH",
    url: "/v1/workspaces/tenant-1/members/member-2",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    payload: { role: "ADMIN" }
  });
  assert.equal(denied.statusCode, 403);
  await adminApp.close();

  const ownerApp = buildApp({ config, logger: false, prisma: workspacePrisma("OWNER", {
    findFirst: async () => ({ id: "member-2", role: "MEMBER", userId: "user-2" })
  }) });
  const allowed = await ownerApp.inject({
    method: "PATCH",
    url: "/v1/workspaces/tenant-1/members/member-2",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    payload: { role: "ADMIN" }
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().member.role, "ADMIN");
  await ownerApp.close();
});


function invitationPrisma(userEmail: string, claimCount = 1) {
  const rawToken = "test-invitation-token-1234567890";
  const session = {
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: "user-invitee",
      email: userEmail,
      status: "ACTIVE",
      emailVerifiedAt: new Date()
    }
  };
  const invitation = {
    id: "invite-1",
    tenantId: "tenant-1",
    email: "invitee@example.com",
    role: "MEMBER",
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    tenant: { id: "tenant-1", status: "ACTIVE" }
  };
  let accepted = false;
  return {
    rawToken,
    get accepted() { return accepted; },
    prisma: {
      session: { findUnique: async () => session },
      workspaceInvitation: {
        findUnique: async () => invitation
      },
      $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
        workspaceInvitation: {
          updateMany: async () => {
            if (claimCount !== 1 || accepted) return { count: 0 };
            accepted = true;
            return { count: 1 };
          }
        },
        tenantMember: {
          upsert: async () => ({ id: "membership-1" })
        }
      })
    } as unknown as PrismaClient
  };
}

test("workspace invitation cannot be accepted by a different email address", async () => {
  const fixture = invitationPrisma("attacker@example.com");
  const app = buildApp({ config, logger: false, prisma: fixture.prisma });
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspace-invitations/accept",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    payload: { token: fixture.rawToken }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(fixture.accepted, false);
  await app.close();
});

test("workspace invitation is claimed once before membership is created", async () => {
  const fixture = invitationPrisma("invitee@example.com");
  const app = buildApp({ config, logger: false, prisma: fixture.prisma });
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspace-invitations/accept",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    payload: { token: fixture.rawToken }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().tenantId, "tenant-1");
  assert.equal(fixture.accepted, true);
  await app.close();
});

test("workspace invitation returns conflict when another request already claimed it", async () => {
  const fixture = invitationPrisma("invitee@example.com", 0);
  const app = buildApp({ config, logger: false, prisma: fixture.prisma });
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspace-invitations/accept",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    payload: { token: fixture.rawToken }
  });
  assert.equal(response.statusCode, 409);
  await app.close();
});
