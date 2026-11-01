import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import dotenv from "dotenv";

// This helper owns only .local/postgres; it never controls the system service.
const root = process.cwd();
const localDir = path.join(root, ".local");
const dataDir = path.join(localDir, "postgres");
const credentialFile = path.join(localDir, "postgres.credentials.json");
const localEnvFile = path.join(root, ".env.development.local");
const binDir = process.env.PG_BIN_DIR ?? (process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\16\\bin" : "");
const port = 5433;

type Credentials = { user: string; password: string; port: number };

function executable(name: string) {
  const file = process.platform === "win32" ? `${name}.exe` : name;
  return binDir ? path.join(binDir, file) : file;
}

function run(name: string, args: string[], allowFailure = false) {
  const result = spawnSync(executable(name), args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw new Error(`Cannot run ${name}. Install PostgreSQL binaries or set PG_BIN_DIR.`);
  if (!allowFailure && result.status !== 0) throw new Error(`${name} failed; existing databases were not changed.`);
  return result.status;
}

async function main() {
  const action = process.argv[2];
  if (action !== "start" && action !== "stop") throw new Error("Use start or stop.");
  if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") {
    throw new Error("Local PostgreSQL management is development-only.");
  }

  if (action === "stop") {
    if (!existsSync(credentialFile) || !existsSync(path.join(dataDir, "PG_VERSION"))) {
      throw new Error("No project-owned local cluster exists. Nothing was stopped.");
    }
    run("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
    return;
  }

  run("initdb", ["--version"]);
  mkdirSync(localDir, { recursive: true });
  const initialized = existsSync(path.join(dataDir, "PG_VERSION"));
  if (initialized && !existsSync(credentialFile)) {
    throw new Error("Existing data directory has no project credentials. Refusing to modify it.");
  }
  const credentials: Credentials = existsSync(credentialFile)
    ? JSON.parse(readFileSync(credentialFile, "utf8"))
    : { user: "atlas_local", password: randomBytes(32).toString("hex"), port };
  if (!existsSync(credentialFile)) {
    writeFileSync(credentialFile, JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
  }

  if (!initialized) {
    const passwordFile = path.join(localDir, "initdb-password");
    writeFileSync(passwordFile, credentials.password, { mode: 0o600 });
    try {
      run("initdb", ["-D", dataDir, "-U", credentials.user, "--pwfile", passwordFile, "-A", "scram-sha-256", "--encoding=UTF8", "--locale=C"]);
    } finally {
      unlinkSync(passwordFile);
    }
  }

  if (run("pg_ctl", ["-D", dataDir, "status"], true) !== 0) {
    run("pg_ctl", ["-D", dataDir, "-l", path.join(localDir, "postgres.log"), "-o", `-p ${credentials.port} -h 127.0.0.1`, "-w", "start"]);
  }

  const connection = {
    host: "127.0.0.1", port: credentials.port,
    user: credentials.user, password: credentials.password,
    database: "postgres", max: 1, connectionTimeoutMillis: 10000,
  };
  const pool = new Pool(connection);
  try {
    const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", ["atlas_erp"]);
    if (exists.rowCount === 0) await pool.query("CREATE DATABASE atlas_erp");
  } finally {
    await pool.end();
  }

  const url = `postgresql://${credentials.user}:${credentials.password}@127.0.0.1:${credentials.port}/atlas_erp`;
  if (existsSync(localEnvFile)) {
    const existing = dotenv.parse(readFileSync(localEnvFile));
    if ((existing.DATABASE_URL && existing.DATABASE_URL !== url) || (existing.DATABASE_URL_UNPOOLED && existing.DATABASE_URL_UNPOOLED !== url)) {
      throw new Error("Existing .env.development.local points elsewhere. Refusing to overwrite it; configure the local URL privately.");
    }
  } else {
    // Next.js and CLI helpers load this development-only override before .env.local.
    writeFileSync(localEnvFile, `# Generated local database URLs; never commit this file.\nDATABASE_URL=${url}\nDATABASE_URL_UNPOOLED=${url}\n`, { mode: 0o600, flag: "wx" });
  }
  console.info(`Project PostgreSQL is ready at 127.0.0.1:${credentials.port}/atlas_erp. Local URLs saved privately; no existing service was changed.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local PostgreSQL setup failed.");
  process.exitCode = 1;
});
