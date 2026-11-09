import { and, asc, count, desc, eq, gte, lt, sql, type SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { addCalendarDays, businessDateStart } from "@/lib/dates/business-date";
import { dashboardBuckets, dashboardComparisonRange, type DashboardFilters, type DashboardRange } from "@/lib/dashboard/filters";
import { can, type AppRole } from "@/server/auth/permissions";
import { getDb } from "@/server/db";
import { categories, customers, invoices, payments, products, quoteLines, quotes, salesOrderLines, salesOrders, warehouses } from "@/server/db/schema";
import { withQueryTrace } from "@/server/observability/query-trace";

type AnalyticsContext = { organizationId: string; role: AppRole; filters: DashboardFilters };
type RangeBounds = { from: Date; to: Date; fromDate: string; toDate: string };

function requirePermission(role: AppRole, permission: string) {
  if (!can(role, permission)) throw new Error("FORBIDDEN");
}

function bounds(range: DashboardRange): RangeBounds {
  return {
    from: businessDateStart(range.from),
    to: businessDateStart(addCalendarDays(range.to, 1)),
    fromDate: range.from,
    toDate: range.to,
  };
}

function dateFilter(column: typeof invoices.issuedAt | typeof salesOrders.confirmedAt | typeof quotes.createdAt, range: RangeBounds) {
  return and(gte(column, range.from), lt(column, range.to));
}

function invoiceLineFilters(input: AnalyticsContext, range: RangeBounds) {
  const clauses = [
    eq(invoices.organizationId, input.organizationId),
    dateFilter(invoices.issuedAt, range),
  ];
  if (input.filters.warehouseId !== "all") clauses.push(eq(salesOrders.warehouseId, input.filters.warehouseId));
  if (input.filters.categoryId !== "all") clauses.push(eq(products.categoryId, input.filters.categoryId));
  if (input.filters.segment !== "all") clauses.push(eq(customers.segment, input.filters.segment));
  return and(...clauses);
}

function quoteLineFilters(input: AnalyticsContext, range: RangeBounds) {
  const clauses = [eq(quotes.organizationId, input.organizationId), dateFilter(quotes.createdAt, range)];
  if (input.filters.warehouseId !== "all") clauses.push(eq(quotes.warehouseId, input.filters.warehouseId));
  if (input.filters.categoryId !== "all") clauses.push(eq(products.categoryId, input.filters.categoryId));
  if (input.filters.segment !== "all") clauses.push(eq(customers.segment, input.filters.segment));
  return and(...clauses);
}

function countOrderFilters(input: AnalyticsContext, range: RangeBounds) {
  const clauses = [eq(salesOrders.organizationId, input.organizationId), dateFilter(salesOrders.confirmedAt, range)];
  if (input.filters.warehouseId !== "all") clauses.push(eq(salesOrders.warehouseId, input.filters.warehouseId));
  if (input.filters.categoryId !== "all") clauses.push(eq(products.categoryId, input.filters.categoryId));
  if (input.filters.segment !== "all") clauses.push(eq(customers.segment, input.filters.segment));
  return and(...clauses);
}

function rangeTrace(range: RangeBounds) {
  return { from: range.fromDate, to: range.toDate };
}

function revenueAmount() {
  return sql<string>`coalesce(sum(${salesOrderLines.quantity}::numeric * ${salesOrderLines.unitPriceMinor}), 0)::numeric`;
}

function costAmount() {
  return sql<string>`coalesce(sum(${salesOrderLines.quantity}::numeric * coalesce(${salesOrderLines.unitCostAtSaleMinor}, 0)), 0)::text`;
}

function asSafeNumber(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number)) throw new Error("ANALYTICS_TOTAL_OUT_OF_RANGE");
  return number;
}

export async function getDashboardFilterOptions(input: { organizationId: string; role: AppRole }) {
  requirePermission(input.role, "dashboard:sales:read");
  const db = getDb();
  const warehouseQuery = db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
    .where(eq(warehouses.organizationId, input.organizationId)).orderBy(asc(warehouses.name), asc(warehouses.id));
  const categoryQuery = db.select({ id: categories.id, name: categories.name }).from(categories)
    .where(eq(categories.organizationId, input.organizationId)).orderBy(asc(categories.name), asc(categories.id));
  const filters = { organizationId: input.organizationId };
  const [warehouseRows, categoryRows] = await Promise.all([
    withQueryTrace({ name: "dashboard.filters.warehouses", source: "warehouses", permission: "dashboard:sales:read", sqlTemplate: warehouseQuery.toSQL().sql, filters }, () => warehouseQuery),
    withQueryTrace({ name: "dashboard.filters.categories", source: "categories", permission: "dashboard:sales:read", sqlTemplate: categoryQuery.toSQL().sql, filters }, () => categoryQuery),
  ]);
  return { warehouses: warehouseRows, categories: categoryRows };
}

function granularityUnit(granularity: DashboardFilters["granularity"]) {
  return granularity === "daily" ? "day" : granularity === "weekly" ? "week" : "month";
}

function bucketLabel(column: SQLWrapper, granularity: DashboardFilters["granularity"]) {
  const unit = granularityUnit(granularity);
  return sql<string>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${column} AT TIME ZONE 'Africa/Casablanca'), 'YYYY-MM-DD')`;
}

async function queryRevenueSeries(input: AnalyticsContext, range: DashboardRange) {
  const db = getDb();
  const dateRange = bounds(range);
  const bucket = bucketLabel(invoices.issuedAt, input.filters.granularity);
  const query = db.select({
    bucket,
    revenueMinor: revenueAmount(),
    cogsMinor: costAmount(),
    invoiceCount: sql<number>`count(distinct ${invoices.id})::int`,
    invoicedOrderCount: sql<number>`count(distinct ${salesOrders.id})::int`,
  }).from(invoices)
    .innerJoin(salesOrders, and(eq(salesOrders.id, invoices.orderId), eq(salesOrders.organizationId, invoices.organizationId)))
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .innerJoin(salesOrderLines, and(eq(salesOrderLines.orderId, salesOrders.id), eq(salesOrderLines.organizationId, salesOrders.organizationId)))
    .innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
    .where(invoiceLineFilters(input, dateRange))
    .groupBy(bucket)
    .orderBy(asc(bucket));
  return withQueryTrace({
    name: "dashboard.sales.revenue_trend",
    source: "invoices + sales_orders + customers + sales_order_lines + products",
    permission: "dashboard:finance:read",
    sqlTemplate: query.toSQL().sql,
    filters: { organizationId: input.organizationId, ...rangeTrace(dateRange), warehouse: input.filters.warehouseId, category: input.filters.categoryId, segment: input.filters.segment, granularity: input.filters.granularity },
  }, () => query);
}

export async function getRevenueTrend(input: AnalyticsContext) {
  requirePermission(input.role, "dashboard:finance:read");
  const comparison = dashboardComparisonRange(input.filters);
  const [current, previous] = await Promise.all([
    queryRevenueSeries(input, { from: input.filters.from, to: input.filters.to }),
    comparison ? queryRevenueSeries(input, comparison) : Promise.resolve([]),
  ]);
  const fill = (rows: typeof current, range: DashboardRange) => {
    const byBucket = new Map(rows.map((row) => [row.bucket, row]));
    return dashboardBuckets(range, input.filters.granularity).map((bucket) => {
      const row = byBucket.get(bucket);
      return {
        bucket,
        revenueMinor: asSafeNumber(row?.revenueMinor),
        cogsMinor: asSafeNumber(row?.cogsMinor),
        invoiceCount: Number(row?.invoiceCount ?? 0),
        invoicedOrderCount: Number(row?.invoicedOrderCount ?? 0),
      };
    });
  };
  return {
    current: fill(current, { from: input.filters.from, to: input.filters.to }),
    previous: comparison ? fill(previous, comparison) : [],
    previousRange: comparison,
  };
}

async function queryConfirmedOrderTrend(input: AnalyticsContext, range: DashboardRange) {
  const db = getDb();
  const dateRange = bounds(range);
  const bucket = bucketLabel(salesOrders.confirmedAt, input.filters.granularity);
  const query = db.select({ bucket, count: sql<number>`count(distinct ${salesOrders.id})::int` }).from(salesOrders)
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .innerJoin(salesOrderLines, and(eq(salesOrderLines.orderId, salesOrders.id), eq(salesOrderLines.organizationId, salesOrders.organizationId)))
    .innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
    .where(countOrderFilters(input, dateRange))
    .groupBy(bucket)
    .orderBy(asc(bucket));
  return withQueryTrace({
    name: "dashboard.sales.confirmed_order_trend",
    source: "sales_orders + customers + sales_order_lines + products",
    permission: "dashboard:sales:read",
    sqlTemplate: query.toSQL().sql,
    filters: { organizationId: input.organizationId, ...rangeTrace(dateRange), warehouse: input.filters.warehouseId, category: input.filters.categoryId, segment: input.filters.segment, granularity: input.filters.granularity },
  }, () => query);
}

export async function getConfirmedOrderTrend(input: AnalyticsContext) {
  requirePermission(input.role, "dashboard:sales:read");
  const comparison = dashboardComparisonRange(input.filters);
  const [current, previous] = await Promise.all([
    queryConfirmedOrderTrend(input, { from: input.filters.from, to: input.filters.to }),
    comparison ? queryConfirmedOrderTrend(input, comparison) : Promise.resolve([]),
  ]);
  const fill = (rows: typeof current, range: DashboardRange) => {
    const byBucket = new Map(rows.map((row) => [row.bucket, row.count]));
    return dashboardBuckets(range, input.filters.granularity).map((bucket) => ({ bucket, count: Number(byBucket.get(bucket) ?? 0) }));
  };
  return {
    current: fill(current, { from: input.filters.from, to: input.filters.to }),
    previous: comparison ? fill(previous, comparison) : [],
    previousRange: comparison,
  };
}

export async function getCategoryRevenue(input: AnalyticsContext) {
  requirePermission(input.role, "dashboard:finance:read");
  const db = getDb();
  const dateRange = bounds({ from: input.filters.from, to: input.filters.to });
  const month = sql<string>`to_char(date_trunc('month', ${invoices.issuedAt} AT TIME ZONE 'Africa/Casablanca'), 'YYYY-MM')`;
  const query = db.select({
    month,
    categoryId: categories.id,
    categoryName: categories.name,
    revenueMinor: revenueAmount(),
  }).from(invoices)
    .innerJoin(salesOrders, and(eq(salesOrders.id, invoices.orderId), eq(salesOrders.organizationId, invoices.organizationId)))
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .innerJoin(salesOrderLines, and(eq(salesOrderLines.orderId, salesOrders.id), eq(salesOrderLines.organizationId, salesOrders.organizationId)))
    .innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
    .innerJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.organizationId, products.organizationId)))
    .where(invoiceLineFilters(input, dateRange))
    .groupBy(month, categories.id, categories.name)
    .orderBy(asc(month), asc(categories.name));
  const rows = await withQueryTrace({
    name: "dashboard.sales.category_revenue",
    source: "invoices + sales_order_lines + products + categories",
    permission: "dashboard:finance:read",
    sqlTemplate: query.toSQL().sql,
    filters: { organizationId: input.organizationId, ...rangeTrace(dateRange), warehouse: input.filters.warehouseId, category: input.filters.categoryId, segment: input.filters.segment },
  }, () => query);
  return rows.map((row) => ({ ...row, revenueMinor: asSafeNumber(row.revenueMinor) }));
}

async function topRevenueByCustomer(input: AnalyticsContext) {
  const db = getDb();
  const dateRange = bounds({ from: input.filters.from, to: input.filters.to });
  const query = db.select({ id: customers.id, name: customers.name, revenueMinor: revenueAmount() }).from(invoices)
    .innerJoin(salesOrders, and(eq(salesOrders.id, invoices.orderId), eq(salesOrders.organizationId, invoices.organizationId)))
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .innerJoin(salesOrderLines, and(eq(salesOrderLines.orderId, salesOrders.id), eq(salesOrderLines.organizationId, salesOrders.organizationId)))
    .innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
    .where(invoiceLineFilters(input, dateRange))
    .groupBy(customers.id, customers.name)
    .orderBy(desc(revenueAmount()), asc(customers.name), asc(customers.id))
    .limit(10);
  return withQueryTrace({
    name: "dashboard.sales.top_customers",
    source: "invoices + sales_orders + customers + sales_order_lines + products",
    permission: "dashboard:finance:read",
    sqlTemplate: query.toSQL().sql,
    filters: { organizationId: input.organizationId, ...rangeTrace(dateRange), warehouse: input.filters.warehouseId, category: input.filters.categoryId, segment: input.filters.segment },
  }, () => query);
}

async function topRevenueByProduct(input: AnalyticsContext) {
  const db = getDb();
  const dateRange = bounds({ from: input.filters.from, to: input.filters.to });
  const query = db.select({
    id: products.id,
    sku: products.sku,
    name: products.name,
    revenueMinor: revenueAmount(),
  }).from(invoices)
    .innerJoin(salesOrders, and(eq(salesOrders.id, invoices.orderId), eq(salesOrders.organizationId, invoices.organizationId)))
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .innerJoin(salesOrderLines, and(eq(salesOrderLines.orderId, salesOrders.id), eq(salesOrderLines.organizationId, salesOrders.organizationId)))
    .innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
    .where(invoiceLineFilters(input, dateRange))
    .groupBy(products.id, products.sku, products.name)
    .orderBy(desc(revenueAmount()), asc(products.sku), asc(products.id))
    .limit(10);
  return withQueryTrace({
    name: "dashboard.sales.top_products",
    source: "invoices + sales_order_lines + products",
    permission: "dashboard:finance:read",
    sqlTemplate: query.toSQL().sql,
    filters: { organizationId: input.organizationId, ...rangeTrace(dateRange), warehouse: input.filters.warehouseId, category: input.filters.categoryId, segment: input.filters.segment },
  }, () => query);
}

export async function getTopRevenue(input: AnalyticsContext) {
  requirePermission(input.role, "dashboard:finance:read");
  const [customersRows, productsRows] = await Promise.all([topRevenueByCustomer(input), topRevenueByProduct(input)]);
  return {
    customers: customersRows.map((row) => ({ ...row, revenueMinor: asSafeNumber(row.revenueMinor) })),
    products: productsRows.map((row) => ({ ...row, revenueMinor: asSafeNumber(row.revenueMinor) })),
  };
}

export async function getQuoteFunnel(input: AnalyticsContext) {
  requirePermission(input.role, "dashboard:finance:read");
  requirePermission(input.role, "quotes:read");
  const db = getDb();
  const dateRange = bounds({ from: input.filters.from, to: input.filters.to });
  const query = db.select({
    created: sql<number>`count(distinct ${quotes.id})::int`,
    sent: sql<number>`count(distinct ${quotes.id}) filter (where ${quotes.sentAt} is not null)::int`,
    accepted: sql<number>`count(distinct ${quotes.id}) filter (where ${quotes.acceptedAt} is not null)::int`,
    converted: sql<number>`count(distinct ${salesOrders.id})::int`,
    invoiced: sql<number>`count(distinct ${invoices.id})::int`,
    paid: sql<number>`count(distinct ${salesOrders.id}) filter (where ${salesOrders.status} = 'paid')::int`,
  }).from(quotes)
    .innerJoin(customers, and(eq(customers.id, quotes.customerId), eq(customers.organizationId, quotes.organizationId)))
    .leftJoin(quoteLines, and(eq(quoteLines.quoteId, quotes.id), eq(quoteLines.organizationId, quotes.organizationId)))
    .leftJoin(products, and(eq(products.id, quoteLines.productId), eq(products.organizationId, quoteLines.organizationId)))
    .leftJoin(salesOrders, and(eq(salesOrders.sourceQuoteId, quotes.id), eq(salesOrders.organizationId, quotes.organizationId)))
    .leftJoin(invoices, and(eq(invoices.orderId, salesOrders.id), eq(invoices.organizationId, salesOrders.organizationId)))
    .where(quoteLineFilters(input, dateRange));
  const [row] = await withQueryTrace({
    name: "dashboard.sales.quote_funnel",
    source: "quotes + quote_lines + sales_orders + invoices",
    permission: "dashboard:finance:read",
    sqlTemplate: query.toSQL().sql,
    filters: { organizationId: input.organizationId, ...rangeTrace(dateRange), warehouse: input.filters.warehouseId, category: input.filters.categoryId, segment: input.filters.segment, cohort: true },
  }, () => query);
  return {
    stages: [
      { key: "created", count: Number(row?.created ?? 0) },
      { key: "sent", count: Number(row?.sent ?? 0) },
      { key: "accepted", count: Number(row?.accepted ?? 0) },
      { key: "converted", count: Number(row?.converted ?? 0) },
      { key: "invoiced", count: Number(row?.invoiced ?? 0) },
      { key: "paid", count: Number(row?.paid ?? 0) },
    ],
  };
}

export async function getReceivablesAging(input: AnalyticsContext) {
  requirePermission(input.role, "dashboard:finance:read");
  requirePermission(input.role, "payments:read");
  const db = getDb();
  const asOf = input.filters.to;
  const asOfEnd = businessDateStart(addCalendarDays(asOf, 1));
  const paymentTotals = db.select({
    invoiceId: payments.invoiceId,
    paidMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int`.as("paid_minor"),
  }).from(payments).where(and(
    eq(payments.organizationId, input.organizationId), lt(payments.paidAt, asOfEnd),
  )).groupBy(payments.invoiceId).as("dashboard_payment_totals");
  const daysPastDue = sql`${asOf}::date - (${invoices.dueDate} AT TIME ZONE 'Africa/Casablanca')::date`;
  const bucket = sql<string>`case when ${daysPastDue} <= 0 then 'not_due' when ${daysPastDue} <= 30 then '1-30' when ${daysPastDue} <= 60 then '31-60' when ${daysPastDue} <= 90 then '61-90' else '91-plus' end`;
  const balance = sql<string>`greatest(${invoices.totalMinor} - coalesce(${paymentTotals.paidMinor}, 0), 0)::numeric`;
  const clauses = [
    eq(invoices.organizationId, input.organizationId),
    lt(invoices.issuedAt, asOfEnd),
    sql`${balance} > 0`,
  ];
  if (input.filters.segment !== "all") clauses.push(eq(customers.segment, input.filters.segment));
  const query = db.select({
    bucket,
    balanceMinor: sql<string>`coalesce(sum(${balance}), 0)::text`,
    invoiceCount: count(invoices.id),
  }).from(invoices)
    .innerJoin(salesOrders, and(eq(salesOrders.id, invoices.orderId), eq(salesOrders.organizationId, invoices.organizationId)))
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .leftJoin(paymentTotals, eq(paymentTotals.invoiceId, invoices.id))
    .where(and(...clauses))
    .groupBy(sql.raw("1"));
  const rows = await withQueryTrace({
    name: "dashboard.finance.ar_aging",
    source: "invoices + payments + sales_orders + customers",
    permission: "dashboard:finance:read",
    sqlTemplate: query.toSQL().sql,
    filters: { organizationId: input.organizationId, asOf, segment: input.filters.segment, categoryUnsupported: input.filters.categoryId !== "all", warehouseUnsupported: input.filters.warehouseId !== "all" },
  }, () => query);
  const totals = new Map(rows.map((row) => [row.bucket, { balanceMinor: asSafeNumber(row.balanceMinor), invoiceCount: Number(row.invoiceCount) }]));
  const orderedBuckets = ["not_due", "1-30", "31-60", "61-90", "91-plus"] as const;
  return {
    asOf,
    rows: orderedBuckets.map((key) => ({ key, ...(totals.get(key) ?? { balanceMinor: 0, invoiceCount: 0 }) })),
    unsupported: { category: input.filters.categoryId !== "all", warehouse: input.filters.warehouseId !== "all" },
  };
}

export async function getReceivablesTrend(input: AnalyticsContext) {
  requirePermission(input.role, "dashboard:finance:read");
  requirePermission(input.role, "payments:read");
  const statement = sql`
    WITH calendar_days AS (
      SELECT generate_series(${input.filters.from}::date, ${input.filters.to}::date, interval '1 day')::date AS business_day
    ), transactions AS (
      SELECT (invoices.issued_at AT TIME ZONE 'Africa/Casablanca')::date AS business_day,
        invoices.total_minor::bigint AS amount_delta
      FROM invoices
      INNER JOIN sales_orders ON sales_orders.id = invoices.order_id
        AND sales_orders.organization_id = invoices.organization_id
      INNER JOIN customers ON customers.id = sales_orders.customer_id
        AND customers.organization_id = sales_orders.organization_id
      WHERE invoices.organization_id = ${input.organizationId}
        AND (${input.filters.segment === "all"} OR customers.segment = ${input.filters.segment})
      UNION ALL
      SELECT (payments.paid_at AT TIME ZONE 'Africa/Casablanca')::date AS business_day,
        -payments.amount_minor::bigint AS amount_delta
      FROM payments
      INNER JOIN invoices ON invoices.id = payments.invoice_id
        AND invoices.organization_id = payments.organization_id
      INNER JOIN sales_orders ON sales_orders.id = invoices.order_id
        AND sales_orders.organization_id = invoices.organization_id
      INNER JOIN customers ON customers.id = sales_orders.customer_id
        AND customers.organization_id = sales_orders.organization_id
      WHERE payments.organization_id = ${input.organizationId}
        AND (${input.filters.segment === "all"} OR customers.segment = ${input.filters.segment})
    ), opening_balance AS (
      SELECT coalesce(sum(amount_delta), 0)::bigint AS balance_minor
      FROM transactions
      WHERE business_day < ${input.filters.from}::date
    ), daily_changes AS (
      SELECT business_day, sum(amount_delta)::bigint AS amount_delta
      FROM transactions
      WHERE business_day >= ${input.filters.from}::date
        AND business_day <= ${input.filters.to}::date
      GROUP BY business_day
    )
    SELECT
      calendar_days.business_day::text AS bucket,
      greatest(opening_balance.balance_minor + sum(coalesce(daily_changes.amount_delta, 0)) OVER (ORDER BY calendar_days.business_day), 0)::text AS balance_minor
    FROM calendar_days
    CROSS JOIN opening_balance
    LEFT JOIN daily_changes ON daily_changes.business_day = calendar_days.business_day
    ORDER BY calendar_days.business_day
  `;
  const query = new PgDialect().sqlToQuery(statement);
  const filters = {
    organizationId: input.organizationId,
    from: input.filters.from,
    to: input.filters.to,
    segment: input.filters.segment,
    warehouseUnsupported: input.filters.warehouseId !== "all",
    categoryUnsupported: input.filters.categoryId !== "all",
  };
  const result = await withQueryTrace({
    name: "dashboard.finance.receivables_trend",
    source: "calendar_days + invoices + payments + sales_orders + customers",
    permission: "dashboard:finance:read",
    sqlTemplate: query.sql,
    filters,
  }, () => getDb().execute(statement));
  return result.rows.map((row) => ({
    bucket: String(row.bucket).slice(0, 10),
    balanceMinor: asSafeNumber(String(row.balance_minor)),
  }));
}
