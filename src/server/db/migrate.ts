import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { getMigrationDatabaseUrl } from "@/lib/env";

async function main() {
  const pool = new Pool({
    connectionString: getMigrationDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: 15000,
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.info("Database migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("Migration failed. Check DATABASE_URL_UNPOOLED, database access, and SSL settings. Run npm run db:check for a connection check. No credentials are logged.");
  process.exitCode = 1;
});
