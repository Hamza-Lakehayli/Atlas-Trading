import { and, asc, count, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { businessDate, isDateExpired } from "@/lib/dates/business-date";
import type { QuoteFilters } from "@/lib/quotes/filters";
import { can, type AppRole } from "@/server/auth/permissions";
import { getDb } from "@/server/db";
import { customers, products, quoteLines, quotes, salesOrders, warehouses } from "@/server/db/schema";
import { withQueryTrace } from "@/server/observability/query-trace";

const pageSize = 25;

function assertQuoteRead(role: AppRole) {
  if (!can(role, "quotes:read")) throw new Error("FORBIDDEN");
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function listConditions(input: { organizationId: string; filters: QuoteFilters; today: string }) {
  const conditions = [eq(quotes.organizationId, input.organizationId)];
  if (input.filters.status === "expired") {
    conditions.push(eq(quotes.status, "sent"), lt(quotes.validUntil, input.today));
  } else if (input.filters.status !== "all") {
    conditions.push(eq(quotes.status, input.filters.status));
    if (input.filters.status === "sent") conditions.push(sql`${quotes.validUntil} >= ${input.today}`);
  }
  if (input.filters.q) {
    const pattern = `%${escapeLike(input.filters.q)}%`;
    conditions.push(or(ilike(quotes.quoteNumber, pattern), ilike(customers.name, pattern))!);
  }
  return and(...conditions);
}

export async function listQuotes(input: { organizationId: string; role: AppRole; filters: QuoteFilters }) {
  assertQuoteRead(input.role);
  const db = getDb();
  const today = businessDate();
  const where = listConditions({ ...input, today });
  const countQuery = db.select({ total: count() }).from(quotes)
    .innerJoin(customers, and(eq(customers.id, quotes.customerId), eq(customers.organizationId, quotes.organizationId)))
    .where(where);
  const rowsQuery = db.select({
    id: quotes.id,
    quoteNumber: quotes.quoteNumber,
    status: quotes.status,
    validUntil: quotes.validUntil,
    createdAt: quotes.createdAt,
    customerName: customers.name,
    warehouseName: warehouses.name,
    lineCount: sql<number>`count(${quoteLines.id})::int`,
    totalMinor: sql<number>`coalesce(sum(${quoteLines.quantity} * ${quoteLines.unitPriceMinor}), 0)::int`,
  }).from(quotes)
    .innerJoin(customers, and(eq(customers.id, quotes.customerId), eq(customers.organizationId, quotes.organizationId)))
    .innerJoin(warehouses, and(eq(warehouses.id, quotes.warehouseId), eq(warehouses.organizationId, quotes.organizationId)))
    .leftJoin(quoteLines, and(eq(quoteLines.quoteId, quotes.id), eq(quoteLines.organizationId, quotes.organizationId)))
    .where(where)
    .groupBy(quotes.id, customers.name, warehouses.name)
    .orderBy(desc(quotes.createdAt), desc(quotes.id))
    .limit(pageSize)
    .offset((input.filters.page - 1) * pageSize);
  const filters = { organizationId: input.organizationId, status: input.filters.status, page: input.filters.page, hasSearch: Boolean(input.filters.q) };
  const [[summary], rows] = await Promise.all([
    withQueryTrace({ name: "sales.quotes.count", source: "quotes + customers", permission: "quotes:read", sqlTemplate: countQuery.toSQL().sql, filters }, () => countQuery),
    withQueryTrace({ name: "sales.quotes.list", source: "quotes + customers + quote_lines", permission: "quotes:read", sqlTemplate: rowsQuery.toSQL().sql, filters }, () => rowsQuery),
  ]);
  const total = Number(summary?.total ?? 0);
  return {
    rows: rows.map((row) => ({ ...row, expired: row.status === "sent" && isDateExpired(row.validUntil) })),
    total,
    page: input.filters.page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getQuoteCreationOptions(input: { organizationId: string; role: AppRole }) {
  if (!can(input.role, "quotes:write")) throw new Error("FORBIDDEN");
  const db = getDb();
  const customerQuery = db.select({ id: customers.id, name: customers.name }).from(customers)
    .where(eq(customers.organizationId, input.organizationId)).orderBy(asc(customers.name), asc(customers.id)).limit(200);
  const warehouseQuery = db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
    .where(eq(warehouses.organizationId, input.organizationId)).orderBy(asc(warehouses.name), asc(warehouses.id));
  const productQuery = db.select({ id: products.id, sku: products.sku, name: products.name, unitPriceMinor: products.unitPriceMinor })
    .from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.active, true)))
    .orderBy(asc(products.name), asc(products.id)).limit(400);
  const filters = { organizationId: input.organizationId };
  const [customerRows, warehouseRows, productRows] = await Promise.all([
    withQueryTrace({ name: "sales.quotes.options.customers", source: "customers", permission: "quotes:write", sqlTemplate: customerQuery.toSQL().sql, filters }, () => customerQuery),
    withQueryTrace({ name: "sales.quotes.options.warehouses", source: "warehouses", permission: "quotes:write", sqlTemplate: warehouseQuery.toSQL().sql, filters }, () => warehouseQuery),
    withQueryTrace({ name: "sales.quotes.options.products", source: "products", permission: "quotes:write", sqlTemplate: productQuery.toSQL().sql, filters: { ...filters, active: true } }, () => productQuery),
  ]);
  return { customers: customerRows, warehouses: warehouseRows, products: productRows };
}

export async function getQuoteDetail(input: { organizationId: string; role: AppRole; quoteId: string }) {
  assertQuoteRead(input.role);
  const db = getDb();
  const quoteQuery = db.select({
    id: quotes.id,
    quoteNumber: quotes.quoteNumber,
    status: quotes.status,
    validUntil: quotes.validUntil,
    createdAt: quotes.createdAt,
    updatedAt: quotes.updatedAt,
    sentAt: quotes.sentAt,
    acceptedAt: quotes.acceptedAt,
    rejectedAt: quotes.rejectedAt,
    convertedAt: quotes.convertedAt,
    customerId: customers.id,
    customerName: customers.name,
    warehouseId: warehouses.id,
    warehouseName: warehouses.name,
  }).from(quotes)
    .innerJoin(customers, and(eq(customers.id, quotes.customerId), eq(customers.organizationId, quotes.organizationId)))
    .innerJoin(warehouses, and(eq(warehouses.id, quotes.warehouseId), eq(warehouses.organizationId, quotes.organizationId)))
    .where(and(eq(quotes.id, input.quoteId), eq(quotes.organizationId, input.organizationId)))
    .limit(1);
  const [quote] = await withQueryTrace({
    name: "sales.quotes.detail",
    source: "quotes + customers + warehouses",
    permission: "quotes:read",
    sqlTemplate: quoteQuery.toSQL().sql,
    filters: { organizationId: input.organizationId },
  }, () => quoteQuery);
  if (!quote) return null;

  const linesQuery = db.select({
    id: quoteLines.id,
    productId: quoteLines.productId,
    sku: quoteLines.skuSnapshot,
    productName: quoteLines.productNameSnapshot,
    quantity: quoteLines.quantity,
    unitPriceMinor: quoteLines.unitPriceMinor,
  }).from(quoteLines).where(and(
    eq(quoteLines.quoteId, quote.id), eq(quoteLines.organizationId, input.organizationId),
  )).orderBy(asc(quoteLines.skuSnapshot), asc(quoteLines.id));
  const orderQuery = db.select({
    id: salesOrders.id,
    orderNumber: salesOrders.orderNumber,
    status: salesOrders.status,
  }).from(salesOrders).where(and(
    eq(salesOrders.sourceQuoteId, quote.id), eq(salesOrders.organizationId, input.organizationId),
  )).limit(1);
  const [lines, [order]] = await Promise.all([
    withQueryTrace({ name: "sales.quotes.detail.lines", source: "quote_lines", permission: "quotes:read", sqlTemplate: linesQuery.toSQL().sql, filters: { organizationId: input.organizationId, quoteId: quote.id } }, () => linesQuery),
    withQueryTrace({
      name: "sales.quotes.detail.converted_order",
      source: "sales_orders",
      permission: "quotes:read",
      sqlTemplate: orderQuery.toSQL().sql,
      filters: { organizationId: input.organizationId, quoteId: quote.id },
    }, () => orderQuery),
  ]);
  return { quote, lines, order: order ?? null, totalMinor: lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0), expired: quote.status === "sent" && isDateExpired(quote.validUntil) };
}
