import { faker } from "@faker-js/faker";
import { and, eq } from "drizzle-orm";
import { db, pool } from "./index";
import { categories, customers, organizations, products, stockLevels, stockMovements, users, warehouses } from "./schema";
import { auth } from "@/server/auth/auth";
import { appRoles, type AppRole } from "@/server/auth/permissions";
import { getMigrationDatabaseUrl, getServerEnv } from "@/lib/env";

const seed = 20261031;
faker.seed(seed);

const categoryNames = [
  "Dry goods", "Beverages", "Cleaning", "Paper products", "Personal care", "Canned food",
  "Kitchen", "Packaging", "Dairy", "Snacks", "Pantry", "Office supplies",
];
const warehouseRows = [
  { name: "Casablanca Central", city: "Casablanca" },
  { name: "Tangier Port", city: "Tangier" },
  { name: "Marrakech South", city: "Marrakech" },
];
const demoUsers: Array<{ name: string; email: string; appRole: AppRole; locale: string }> = [
  { name: "Amine El Idrissi", email: "admin@atlas.demo", appRole: "admin", locale: "en" },
  { name: "Salma Benali", email: "sales@atlas.demo", appRole: "sales_manager", locale: "fr" },
  { name: "Youssef Karim", email: "warehouse@atlas.demo", appRole: "warehouse", locale: "en" },
  { name: "Nadia Alaoui", email: "finance@atlas.demo", appRole: "accountant", locale: "fr" },
  { name: "Lina Mansour", email: "viewer@atlas.demo", appRole: "viewer", locale: "en" },
];

async function ensureDemoUser(organizationId: string, user: (typeof demoUsers)[number], password: string) {
  const context = await auth.$context;
  const existing = await context.internalAdapter.findUserByEmail(user.email);
  if (existing) {
    await db.update(users).set({ appRole: user.appRole, organizationId, locale: user.locale }).where(eq(users.id, existing.user.id));
    return;
  }

  const created = await context.internalAdapter.createUser({
    email: user.email,
    name: user.name,
    emailVerified: true,
    appRole: user.appRole,
    organizationId,
    locale: user.locale,
  }, { method: "seed" });
  const hashedPassword = await context.password.hash(password);
  await context.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: hashedPassword,
  });
}

async function main() {
  const env = getServerEnv();
  getMigrationDatabaseUrl();
  if (env.DEMO_MODE !== "true") throw new Error("Seeding demo users requires DEMO_MODE=true.");

  const [existingOrg] = await db.select().from(organizations).where(eq(organizations.name, "Atlas Trading Co.")).limit(1);
  const [organization] = existingOrg
    ? [existingOrg]
    : await db.insert(organizations).values({ name: "Atlas Trading Co." }).returning();

  for (const name of categoryNames) {
    await db.insert(categories).values({ organizationId: organization.id, name }).onConflictDoNothing();
  }
  for (const warehouse of warehouseRows) {
    await db.insert(warehouses).values({ organizationId: organization.id, ...warehouse }).onConflictDoNothing();
  }

  const categoryRows = await db.select().from(categories).where(eq(categories.organizationId, organization.id));
  const warehouseList = await db.select().from(warehouses).where(eq(warehouses.organizationId, organization.id));
  const existingProducts = await db.select({ sku: products.sku }).from(products).where(eq(products.organizationId, organization.id));
  const existingSkus = new Set(existingProducts.map((product) => product.sku));
  const newProducts = [];
  for (let index = 0; index < 400; index += 1) {
    const sku = `AT-${String(index + 1).padStart(4, "0")}`;
    if (existingSkus.has(sku)) continue;
    const category = categoryRows[index % categoryRows.length];
    const cost = faker.number.int({ min: 1200, max: 145000 });
    const product = {
      organizationId: organization.id,
      categoryId: category.id,
      sku,
      name: `${faker.commerce.productAdjective()} ${faker.commerce.product()}`,
      unitCostMinor: cost,
      unitPriceMinor: Math.round(cost * faker.number.float({ min: 1.18, max: 1.52, fractionDigits: 2 })),
      reorderPoint: faker.number.int({ min: 8, max: 36 }),
      active: true,
    };
    newProducts.push(product);
  }
  for (let offset = 0; offset < newProducts.length; offset += 100) {
    await db.insert(products).values(newProducts.slice(offset, offset + 100)).onConflictDoNothing();
  }

  const allProducts = await db.select().from(products).where(eq(products.organizationId, organization.id));
  const costByProduct = new Map(allProducts.map((product) => [product.id, product.unitCostMinor]));
  const openingStock = [];
  for (const product of allProducts) {
    for (const warehouse of warehouseList) {
      const lowStockAnomaly = Number(product.sku.slice(-2)) % 13 === 0;
      openingStock.push({
        organizationId: organization.id,
        productId: product.id,
        warehouseId: warehouse.id,
        quantity: lowStockAnomaly ? 0 : faker.number.int({ min: 18, max: 420 }),
        averageUnitCostMinor: costByProduct.get(product.id) ?? 0,
      });
    }
  }
  for (let offset = 0; offset < openingStock.length; offset += 200) {
    await db.insert(stockLevels).values(openingStock.slice(offset, offset + 200)).onConflictDoNothing();
  }

  if (warehouseList.length) {
    const existingOpening = await db.select({ productId: stockMovements.productId, warehouseId: stockMovements.warehouseId }).from(stockMovements).where(and(
      eq(stockMovements.organizationId, organization.id),
      eq(stockMovements.referenceType, "opening_balance"),
      eq(stockMovements.referenceId, organization.id),
    ));
    const openingBalanceKeys = new Set(existingOpening.map((movement) => `${movement.productId}:${movement.warehouseId}`));
    const missingOpening = await db.select().from(stockLevels).where(and(
      eq(stockLevels.organizationId, organization.id),
    ));
    for (let offset = 0; offset < missingOpening.length; offset += 200) {
      const rows = missingOpening.slice(offset, offset + 200).filter((level) => level.quantity > 0 && !openingBalanceKeys.has(`${level.productId}:${level.warehouseId}`));
      if (rows.length) await db.insert(stockMovements).values(rows.map((level) => ({
        organizationId: organization.id,
        productId: level.productId,
        warehouseId: level.warehouseId,
        type: "receipt" as const,
        quantity: level.quantity,
        unitCostMinor: level.averageUnitCostMinor,
        referenceType: "opening_balance",
        referenceId: organization.id,
        createdBy: null,
      }))).onConflictDoNothing();
    }
  }

  const existingCustomers = await db.select({ id: customers.id }).from(customers).where(eq(customers.organizationId, organization.id));
  if (existingCustomers.length < 120) {
    const missingCustomers = [];
    for (let index = existingCustomers.length; index < 120; index += 1) {
      missingCustomers.push({
        organizationId: organization.id,
        name: faker.company.name(),
        segment: ["Retail", "Hospitality", "Wholesale"][index % 3],
        city: ["Casablanca", "Tangier", "Marrakech", "Rabat", "Fes"][index % 5],
      });
    }
    await db.insert(customers).values(missingCustomers).onConflictDoNothing();
  }

  for (const role of appRoles) {
    const user = demoUsers.find((candidate) => candidate.appRole === role);
    if (user) await ensureDemoUser(organization.id, user, env.DEMO_PASSWORD);
  }

  const customerCount = (await db.select({ id: customers.id }).from(customers).where(eq(customers.organizationId, organization.id))).length;
  console.info(`Seed complete: ${allProducts.length} products, ${categoryRows.length} categories, ${warehouseList.length} warehouses, ${customerCount} customers, ${demoUsers.length} demo roles (seed ${seed}).`);
}

main().catch(() => {
  console.error("Seed failed. Confirm DEMO_MODE=true, matching PostgreSQL URLs, applied migrations, and demo settings. Run npm run db:check. No credentials are logged.");
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
