import dotenv from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: [".env.development.local", ".env.local"], quiet: true });
}

const databaseUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}, "Expected a PostgreSQL connection URL");

const envSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  DEMO_PASSWORD: z.string().min(12),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
});

export function getMigrationDatabaseUrl() {
  const parsed = databaseUrlSchema.safeParse(process.env.DATABASE_URL_UNPOOLED);
  if (!parsed.success || /YOUR-ENDPOINT|USER:PASSWORD/.test(parsed.data)) {
    throw new Error("Set DATABASE_URL_UNPOOLED to a direct PostgreSQL URL. For local setup run npm run db:local:start; for Neon see docs/DEPLOYMENT.md. Do not share credentials in chat.");
  }
  if (new URL(parsed.data).hostname.includes("-pooler")) {
    throw new Error("DATABASE_URL_UNPOOLED must use the direct database endpoint, not the -pooler runtime endpoint.");
  }
  return parsed.data;
}

export function getServerEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}
