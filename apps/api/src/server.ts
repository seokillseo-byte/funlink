import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const prisma = config.DATABASE_URL ? new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } }) : undefined;
const app = buildApp({ config, prisma });

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info({ host: config.API_HOST, port: config.API_PORT }, "FunLink API listening");
} catch (error) {
  app.log.error(error);
  await prisma?.$disconnect();
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down API");
  await app.close();
  await prisma?.$disconnect();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
