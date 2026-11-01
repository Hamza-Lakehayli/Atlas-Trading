import { Pool } from "pg";
import { getMigrationDatabaseUrl } from "@/lib/env";

async function main() {
  const connectionString = getMigrationDatabaseUrl();
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 15000 });
  try {
    await pool.query("SELECT 1");
    console.info("PostgreSQL connection succeeded. No schema or data was changed.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message.startsWith("Set DATABASE_URL_UNPOOLED")) {
    console.error(error.message);
  } else {
    console.error("Database connection failed. Check the direct URL, credentials, SSL, and database availability. No credentials are logged.");
  }
  process.exitCode = 1;
});
