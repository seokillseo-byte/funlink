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
