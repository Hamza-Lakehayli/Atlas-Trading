import assert from "node:assert/strict";
import { Pool } from "pg";
import { getMigrationDatabaseUrl, getServerEnv } from "../src/lib/env";

async function main() {
  const env = getServerEnv();
  const databaseUrl = getMigrationDatabaseUrl();
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(databaseUrl).hostname)) {
    throw new Error("Foundation verification only runs against the local project database.");
  }
  const origin = env.BETTER_AUTH_URL;
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(origin).hostname)) {
    throw new Error("Foundation verification only runs against a local app.");
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const { rows: [counts] } = await pool.query(`SELECT
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM categories) AS categories,
      (SELECT count(*)::int FROM warehouses) AS warehouses,
      (SELECT count(*)::int FROM customers) AS customers,
      (SELECT count(*)::int FROM stock_levels) AS balances,
      (SELECT count(DISTINCT app_role)::int FROM "user") AS roles,
      (SELECT count(*)::int FROM stock_levels WHERE quantity < 0) AS negative_stock`);
    assert.deepEqual(counts, { products: 400, categories: 12, warehouses: 3, customers: 120, balances: 1200, roles: 5, negative_stock: 0 });
    console.info("Local seed validation passed: catalogue, warehouse balances, customers, five roles, nonnegative stock.");
  } finally {
    await pool.end();
  }

  const anonymous = await fetch(`${origin}/en/dashboard`, { redirect: "manual" });
  assert.equal(anonymous.status, 307);
  assert.ok(anonymous.headers.get("location")?.endsWith("/en/login"));

  const roles = [
    ["admin@atlas.demo", "Amine"], ["sales@atlas.demo", "Salma"],
    ["warehouse@atlas.demo", "Youssef"], ["finance@atlas.demo", "Nadia"],
    ["viewer@atlas.demo", "Lina"],
  ];
  for (const [email, name] of roles) {
    const login = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, password: env.DEMO_PASSWORD }),
    });
    assert.equal(login.status, 200, `Login failed for ${name}`);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.ok(cookie, "Session cookie missing");
    const dashboard = await fetch(`${origin}/en/dashboard`, { headers: { Cookie: cookie } });
    assert.equal(dashboard.status, 200);
    const html = await dashboard.text();
    assert.match(html, new RegExp(`Good morning, ${name}`));
    assert.match(html, /Awesome Chair/);
    if (name === "Youssef") {
      assert.doesNotMatch(html, /class="align-right money-cell"/);
      assert.doesNotMatch(html, />Finance<\/span>/);
    }
    const french = await fetch(`${origin}/fr/dashboard`, { headers: { Cookie: cookie } });
    assert.match(await french.text(), new RegExp(`Bonjour, ${name}`));
    const copilot = await fetch(`${origin}/en/copilot`, { headers: { Cookie: cookie } });
    assert.match(await copilot.text(), /No model requests are sent/);
    const logout = await fetch(`${origin}/api/auth/sign-out`, {
      method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(logout.status, 200);
    const afterLogout = await fetch(`${origin}/en/dashboard`, { headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal(afterLogout.status, 307);
    console.info(`${name}: login, seeded dashboard, FR locale, inactive copilot, and server-side logout checks passed.`);
  }
}

main().catch(() => {
  console.error("Foundation verification failed. Check the local app/database, seed data, and role behavior; no session or credential values are logged.");
  process.exitCode = 1;
});
