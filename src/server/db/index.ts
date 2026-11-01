import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { getServerEnv } from "@/lib/env";

const globalForDb = globalThis as unknown as {
  atlasPool?: Pool;
  atlasDatabase?: ReturnType<typeof createDatabase>;
};

function createPool() {
  const pool = new Pool({
    connectionString: getServerEnv().DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 15000,
  });
  if (process.env.VERCEL === "1") attachDatabasePool(pool);
  return pool;
}

function createDatabase() {
  const pool = globalForDb.atlasPool ?? createPool();
  globalForDb.atlasPool = pool;
  return drizzle(pool, { schema });
}

export function getPool() {
  return globalForDb.atlasPool ?? (globalForDb.atlasPool = createPool());
}

export function getDb() {
  return globalForDb.atlasDatabase ?? (globalForDb.atlasDatabase = createDatabase());
}
