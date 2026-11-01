import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { getServerEnv } from "@/lib/env";

const env = getServerEnv();

export const auth = betterAuth({
  appName: "Atlas Trading Co.",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: env.DEMO_MODE === "true",
    disableSignUp: true,
    minPasswordLength: 12,
  },
  user: {
    additionalFields: {
      appRole: { type: "string", required: true, input: false, defaultValue: "viewer" },
      organizationId: { type: "string", required: false, input: false },
      locale: { type: "string", required: false, input: false, defaultValue: "en" },
    },
  },
  trustedOrigins: [env.BETTER_AUTH_URL],
});
