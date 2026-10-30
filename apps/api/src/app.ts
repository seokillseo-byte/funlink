import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { ApiConfig } from "./config.js";

export interface ReadinessDatabase {
  $queryRaw<T = unknown>(query: TemplateStringsArray): Promise<T>;
}

export interface BuildAppOptions {
  config: ApiConfig;
  prisma?: ReadinessDatabase;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? options.config.NODE_ENV !== "test" });

  app.get("/health", async () => ({ status: "ok", service: "funlink-api" }));

  app.get("/ready", async (_request, reply) => {
    if (!options.prisma) {
      return reply.code(503).send({ status: "not_ready", checks: { database: "not_configured" } });
    }
    try {
      await options.prisma.$queryRaw\`SELECT 1\`;
      return { status: "ready", checks: { database: "ok" } };
    } catch (error) {
      requestLog(app, error);
      return reply.code(503).send({ status: "not_ready", checks: { database: "error" } });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, "Unhandled API error");
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    return reply.code(statusCode).send({ error: statusCode >= 500 ? "Internal server error" : error.message });
  });

  return app;
}

function requestLog(app: FastifyInstance, error: unknown): void {
  app.log.error({ err: error }, "Readiness database check failed");
}
