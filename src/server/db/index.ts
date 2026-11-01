import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { getServerEnv } from "@/lib/env";

const globalForDb = globalThis as unknown as { atlasPool?: Pool };
const pool = globalForDb.atlasPool ?? new Pool({
  connectionString: getServerEnv().DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 15000,
});
if (!globalForDb.atlasPool && process.env.VERCEL === "1") attachDatabasePool(pool);
if (process.env.NODE_ENV !== "production") globalForDb.atlasPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
