import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3013),
  DATABASE_URL: z.string().url().optional()
});

export type ApiConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid API environment: ${parsed.error.issues.map((issue) => issue.path.join(".") + " " + issue.message).join("; ")}`);
  }
  return parsed.data;
}
