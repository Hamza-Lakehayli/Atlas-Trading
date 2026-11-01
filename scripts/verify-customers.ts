import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getMigrationDatabaseUrl, getServerEnv } from "../src/lib/env";
import { parseCustomerFilters } from "../src/lib/customers/filters";
import { can } from "../src/server/auth/permissions";
import { getDb, getPool } from "../src/server/db";
import { organizations } from "../src/server/db/schema";
import { getCustomerDetail, listCustomers } from "../src/server/queries/customers";

async function signedInCookie(origin: string, email: string, password: string) {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `Demo sign-in failed for ${email}`);
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function main() {
  const env = getServerEnv();
  const databaseUrl = getMigrationDatabaseUrl();
  const origin = env.BETTER_AUTH_URL;
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(databaseUrl).hostname)
    || !new Set(["127.0.0.1", "localhost"]).has(new URL(origin).hostname)) {
    throw new Error("Customer verification only runs against the isolated local app and database.");
  }

  try {
    const db = getDb();
    const [organization] = await db.select().from(organizations).where(eq(organizations.name, "Atlas Trading Co.")).limit(1);
    assert.ok(organization, "Seed the local database before verifying the customer directory");

    const retail = parseCustomerFilters({ segment: "Retail", q: "Casablanca", page: "1" });
    assert.ok(retail.success);
    const page = await listCustomers({ organizationId: organization.id, role: "sales_manager", filters: retail.data });
    assert.ok(page.total > 0, "Expected seeded retail customers in Casablanca");
    assert.ok(page.rows.every((row) => row.segment === "Retail" && row.city.toLowerCase().includes("casablanca")));
    assert.ok(page.rows.length <= page.pageSize);

    const unscoped = await listCustomers({ organizationId: randomUUID(), role: "sales_manager", filters: retail.data });
    assert.equal(unscoped.total, 0);
    await assert.rejects(
      () => listCustomers({ organizationId: organization.id, role: "warehouse", filters: retail.data }),
      /FORBIDDEN/,
    );
    assert.equal(can("sales_manager", "customers:read"), true);
    assert.equal(can("warehouse", "customers:read"), false);

    const allFirstPage = await listCustomers({
      organizationId: organization.id,
      role: "sales_manager",
      filters: { q: "", segment: "all", page: 1 },
    });
    const allSecondPage = await listCustomers({
      organizationId: organization.id,
      role: "sales_manager",
      filters: { q: "", segment: "all", page: 2 },
    });
    assert.equal(allFirstPage.total, 120);
    assert.equal(allFirstPage.totalPages, 5);
    assert.equal(allFirstPage.rows.length, 25);
    assert.equal(allSecondPage.rows.length, 25);
    assert.ok(allSecondPage.rows.every((row) => !allFirstPage.rows.some((firstRow) => firstRow.id === row.id)));
    const [first] = allFirstPage.rows;
    assert.ok(first);
    const detail = await getCustomerDetail({ organizationId: organization.id, role: "sales_manager", customerId: first.id });
    assert.ok(detail);
    assert.equal(detail.customer.id, first.id);
    assert.ok(detail.orders.length <= 10);
    assert.ok(detail.orders.every((order) => !("totalMinor" in order)));
    assert.equal(await getCustomerDetail({ organizationId: randomUUID(), role: "sales_manager", customerId: first.id }), null);
    console.info("Customer queries passed: scoped search/segment/pagination, permission denial, customer detail, and bounded order history.");

    const salesCookie = await signedInCookie(origin, "sales@atlas.demo", env.DEMO_PASSWORD);
    const listing = await fetch(`${origin}/en/sales/customers?segment=Retail&q=Casablanca`, { headers: { Cookie: salesCookie } });
    assert.equal(listing.status, 200);
    const listingHtml = await listing.text();
    assert.match(listingHtml, /Customer ledger/);
    assert.match(listingHtml, /Casablanca/);
    const customerPath = listingHtml.match(/href="(\/en\/sales\/customers\/[0-9a-f-]+\?[^\"]*)"/i)?.[1];
    assert.ok(customerPath, "Customer rows should link to a directly addressable detail route");
    const detailResponse = await fetch(`${origin}${customerPath.replaceAll("&amp;", "&")}`, { headers: { Cookie: salesCookie } });
    assert.equal(detailResponse.status, 200);
    assert.match(await detailResponse.text(), /Order history/);
    const french = await fetch(`${origin}/fr/sales/customers`, { headers: { Cookie: salesCookie } });
    assert.equal(french.status, 200);
    assert.match(await french.text(), /Registre clients/);
    const invalidFilters = await fetch(`${origin}/en/sales/customers?segment=unsupported`, { headers: { Cookie: salesCookie } });
    assert.equal(invalidFilters.status, 200);
    assert.match(await invalidFilters.text(), /These customer filters aren.t valid/);

    const warehouseCookie = await signedInCookie(origin, "warehouse@atlas.demo", env.DEMO_PASSWORD);
    const forbiddenPage = await fetch(`${origin}/en/sales/customers`, { headers: { Cookie: warehouseCookie } });
    assert.equal(forbiddenPage.status, 404);
    console.info("Customer browser routes passed: filtered list, direct detail, French locale, and warehouse access denial.");
  } finally {
    await getPool().end();
  }
}

main().catch(() => {
  console.error("Customer verification failed. Confirm local PostgreSQL is seeded and the local app is running; no credentials or session values are logged.");
  process.exitCode = 1;
});
