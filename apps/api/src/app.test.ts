import test from "node:test";
import assert from "node:assert/strict";
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
  const app = buildApp({ config, logger: false, prisma: { $queryRaw: async <T>() => [{ result: 1 }] as T } });
  const response = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ready", checks: { database: "ok" } });
  await app.close();
});

test("GET /ready returns 503 when database probe fails", async () => {
  const app = buildApp({ config, logger: false, prisma: { $queryRaw: async () => { throw new Error("offline"); } } });
  const response = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.database, "error");
  await app.close();
});

test("invalid API port is rejected", () => {
  assert.throws(() => loadConfig({ API_PORT: "70000" }), /Invalid API environment/);
});
