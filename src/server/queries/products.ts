import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/server/db";
import { categories, products, stockLevels } from "@/server/db/schema";
import { can, type AppRole } from "@/server/auth/permissions";
import { withQueryTrace } from "@/server/observability/query-trace";

export async function listProducts(input: { organizationId: string; role: AppRole }) {
  if (!can(input.role, "inventory:read")) throw new Error("FORBIDDEN");
  const showPrices = can(input.role, "dashboard:finance:read");
  const query = db.select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      category: categories.name,
      unitPriceMinor: showPrices ? products.unitPriceMinor : sql<null>`NULL`,
      quantityOnHand: sql<number>`coalesce(sum(${stockLevels.quantity}), 0)::int`,
      reorderPoint: products.reorderPoint,
    }).from(products)
      .innerJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.organizationId, products.organizationId)))
      .leftJoin(stockLevels, and(eq(products.id, stockLevels.productId), eq(stockLevels.organizationId, products.organizationId)))
      .where(and(eq(products.organizationId, input.organizationId), eq(products.active, true)))
      .groupBy(products.id, categories.name)
      .orderBy(asc(products.name))
      .limit(15);
  const rows = await withQueryTrace({
    name: "inventory.products.list",
    source: "products + categories + stock_levels",
    permission: "inventory:read",
    sqlTemplate: query.toSQL().sql,
    filters: { organizationId: input.organizationId, active: true },
  }, () => query);
  const summaryStatement = sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE COALESCE(stock.total_quantity, 0) <= p.reorder_point)::int AS low_stock
      FROM products p
      LEFT JOIN (
        SELECT product_id, SUM(quantity) AS total_quantity
        FROM stock_levels
        WHERE organization_id = ${input.organizationId}
        GROUP BY product_id
      ) stock ON stock.product_id = p.id
      WHERE p.organization_id = ${input.organizationId} AND p.active = true
    `;
  const summaryResult = await withQueryTrace({
    name: "inventory.products.summary",
    source: "products + stock_levels",
    permission: "inventory:read",
    sqlTemplate: new PgDialect().sqlToQuery(summaryStatement).sql,
    filters: { organizationId: input.organizationId, active: true },
  }, () => db.execute(summaryStatement));
  const summary = summaryResult.rows[0] as { total: number; low_stock: number } | undefined;
  return { rows, total: Number(summary?.total ?? 0), lowStock: Number(summary?.low_stock ?? 0), showPrices };
}
