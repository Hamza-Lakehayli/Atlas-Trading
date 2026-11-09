import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { addCalendarDays, businessDate, businessDateStart, calendarDayDifference } from "@/lib/dates/business-date";
import type { InvoiceFilters } from "@/lib/invoices/filters";
import { can, type AppRole } from "@/server/auth/permissions";
import { getDb } from "@/server/db";
import { categories, customers, invoices, payments, products, salesOrderLines, salesOrders, warehouses } from "@/server/db/schema";
import { withQueryTrace } from "@/server/observability/query-trace";

const pageSize = 25;

function assertInvoiceRead(role: AppRole) {
  if (!can(role, "invoices:read") || !can(role, "dashboard:finance:read") || !can(role, "payments:read")) {
    throw new Error("FORBIDDEN");
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function asSafeNumber(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number)) throw new Error("INVOICE_TOTAL_OUT_OF_RANGE");
  return number;
}

function dateBounds(filters: InvoiceFilters) {
  const asOfDate = filters.asOf ?? filters.to ?? businessDate();
  return {
    asOfDate,
    asOfEnd: businessDateStart(addCalendarDays(asOfDate, 1)),
    fromStart: filters.from ? businessDateStart(filters.from) : null,
    toEnd: filters.to ? businessDateStart(addCalendarDays(filters.to, 1)) : null,
  };
}

function invoiceConditions(input: {
  organizationId: string;
  filters: InvoiceFilters;
  asOfDate: string;
  fromStart: Date | null;
  toEnd: Date | null;
  paidAsOf: SQL;
}) {
  const conditions = [
    eq(invoices.organizationId, input.organizationId),
    lt(invoices.issuedAt, businessDateStart(addCalendarDays(input.asOfDate, 1))),
  ];
  if (input.fromStart) conditions.push(gte(invoices.issuedAt, input.fromStart));
  if (input.toEnd) conditions.push(lt(invoices.issuedAt, input.toEnd));
  if (input.filters.status === "paid") conditions.push(sql`${invoices.totalMinor} <= ${input.paidAsOf}`);
  if (input.filters.status === "unpaid") conditions.push(sql`${input.paidAsOf} = 0 AND ${invoices.totalMinor} > ${input.paidAsOf}`);
  if (input.filters.status === "partial") conditions.push(sql`${input.paidAsOf} > 0 AND ${invoices.totalMinor} > ${input.paidAsOf}`);
  if (input.filters.status === "overdue") conditions.push(sql`${invoices.totalMinor} > ${input.paidAsOf} AND (${invoices.dueDate} AT TIME ZONE 'Africa/Casablanca')::date < ${input.asOfDate}::date`);
  if (input.filters.warehouseId) conditions.push(eq(salesOrders.warehouseId, input.filters.warehouseId));
  if (input.filters.customerId) conditions.push(eq(salesOrders.customerId, input.filters.customerId));
  if (input.filters.segment) conditions.push(eq(customers.segment, input.filters.segment));
  if (input.filters.q) {
    const pattern = `%${escapeLike(input.filters.q)}%`;
    conditions.push(or(ilike(invoices.number, pattern), ilike(customers.name, pattern), ilike(salesOrders.orderNumber, pattern))!);
  }

  if (input.filters.productId || input.filters.categoryId) {
    const matchingOrderIds = getDb().select({ orderId: salesOrderLines.orderId }).from(salesOrderLines)
      .innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
      .where(and(
        eq(salesOrderLines.organizationId, input.organizationId),
        input.filters.productId ? eq(products.id, input.filters.productId) : undefined,
        input.filters.categoryId ? eq(products.categoryId, input.filters.categoryId) : undefined,
      ));
    conditions.push(inArray(invoices.orderId, matchingOrderIds));
  }

  if (input.filters.aging) {
    const dueLocalDate = sql`(${invoices.dueDate} AT TIME ZONE 'Africa/Casablanca')::date`;
    const daysPastDue = sql`${input.asOfDate}::date - ${dueLocalDate}`;
    const hasBalance = sql`${invoices.totalMinor} > ${input.paidAsOf}`;
    if (input.filters.aging === "not_due") conditions.push(hasBalance, sql`${daysPastDue} <= 0`);
    if (input.filters.aging === "1-30") conditions.push(hasBalance, sql`${daysPastDue} BETWEEN 1 AND 30`);
    if (input.filters.aging === "31-60") conditions.push(hasBalance, sql`${daysPastDue} BETWEEN 31 AND 60`);
    if (input.filters.aging === "61-90") conditions.push(hasBalance, sql`${daysPastDue} BETWEEN 61 AND 90`);
    if (input.filters.aging === "91-plus") conditions.push(hasBalance, sql`${daysPastDue} >= 91`);
  }
  return and(...conditions);
}

function paymentTotalsQuery(organizationId: string, asOfEnd: Date) {
  return getDb().select({
    invoiceId: payments.invoiceId,
    paidMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int`.as("paid_minor"),
  }).from(payments).where(and(
    eq(payments.organizationId, organizationId), lt(payments.paidAt, asOfEnd),
  )).groupBy(payments.invoiceId).as("invoice_payment_totals");
}

function statusAtAsOf(paidMinor: number, outstandingMinor: number) {
  if (outstandingMinor <= 0) return "paid" as const;
  return paidMinor > 0 ? "partial" as const : "unpaid" as const;
}

function agingAtAsOf(dueDate: Date, asOfDate: string, outstandingMinor: number) {
  if (outstandingMinor <= 0) return null;
  const daysPastDue = calendarDayDifference(asOfDate, businessDate(dueDate));
  if (daysPastDue <= 0) return "not_due" as const;
  if (daysPastDue <= 30) return "1-30" as const;
  if (daysPastDue <= 60) return "31-60" as const;
  if (daysPastDue <= 90) return "61-90" as const;
  return "91-plus" as const;
}

export async function listInvoices(input: { organizationId: string; role: AppRole; filters: InvoiceFilters }) {
  assertInvoiceRead(input.role);
  const db = getDb();
  const dates = dateBounds(input.filters);
  const paymentTotals = paymentTotalsQuery(input.organizationId, dates.asOfEnd);
  const paidAsOf = sql`coalesce(${paymentTotals.paidMinor}, 0)`;
  const where = invoiceConditions({
    organizationId: input.organizationId,
    filters: input.filters,
    asOfDate: dates.asOfDate,
    fromStart: dates.fromStart,
    toEnd: dates.toEnd,
    paidAsOf,
  });
  const countQuery = db.select({ total: count() }).from(invoices)
    .innerJoin(salesOrders, and(eq(salesOrders.id, invoices.orderId), eq(salesOrders.organizationId, invoices.organizationId)))
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .leftJoin(paymentTotals, eq(paymentTotals.invoiceId, invoices.id))
    .where(where);
  const hasLineFilter = Boolean(input.filters.productId || input.filters.categoryId);
  const matchingLineRevenueQuery = hasLineFilter
    ? db.select({
        totalMinor: sql<string>`coalesce(sum(${salesOrderLines.quantity}::numeric * ${salesOrderLines.unitPriceMinor}), 0)::text`,
      }).from(invoices)
      .innerJoin(salesOrders, and(eq(salesOrders.id, invoices.orderId), eq(salesOrders.organizationId, invoices.organizationId)))
      .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
      .innerJoin(salesOrderLines, and(eq(salesOrderLines.orderId, salesOrders.id), eq(salesOrderLines.organizationId, salesOrders.organizationId)))
      .innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
      .leftJoin(paymentTotals, eq(paymentTotals.invoiceId, invoices.id))
      .where(and(
        where,
        input.filters.productId ? eq(products.id, input.filters.productId) : undefined,
        input.filters.categoryId ? eq(products.categoryId, input.filters.categoryId) : undefined,
      ))
    : null;
  const matchingLinePerInvoiceQuery = hasLineFilter
    ? db.select({
        totalMinor: sql<number>`coalesce(sum(${salesOrderLines.quantity}::numeric * ${salesOrderLines.unitPriceMinor}), 0)::int`.as("total_minor"),
      }).from(salesOrderLines)
      .innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
      .where(and(
        eq(salesOrderLines.organizationId, input.organizationId),
        eq(salesOrderLines.orderId, invoices.orderId),
        input.filters.productId ? eq(products.id, input.filters.productId) : undefined,
        input.filters.categoryId ? eq(products.categoryId, input.filters.categoryId) : undefined,
      ))
    : null;
  const selection = {
    id: invoices.id,
    number: invoices.number,
    orderId: salesOrders.id,
    orderNumber: salesOrders.orderNumber,
    customerId: customers.id,
    customerName: customers.name,
    warehouseId: warehouses.id,
    warehouseName: warehouses.name,
    segment: customers.segment,
    issuedAt: invoices.issuedAt,
    dueDate: invoices.dueDate,
    totalMinor: invoices.totalMinor,
    cogsMinor: invoices.cogsMinor,
    paidMinor: sql<number>`coalesce(${paymentTotals.paidMinor}, 0)::int`,
    outstandingMinor: sql<number>`greatest(${invoices.totalMinor} - coalesce(${paymentTotals.paidMinor}, 0), 0)::int`,
    lineCount: sql<number>`(select count(*)::int from sales_order_lines sol where sol.organization_id = ${invoices.organizationId} and sol.order_id = ${invoices.orderId})`,
    matchingLineRevenueMinor: matchingLinePerInvoiceQuery
      ? sql<number>`coalesce((${matchingLinePerInvoiceQuery}), 0)::int`.as("matching_line_revenue_minor")
      : sql<null>`NULL`.as("matching_line_revenue_minor"),
  };
  const sortColumn = {
    issuedAt: invoices.issuedAt,
    dueDate: invoices.dueDate,
    invoiceNumber: invoices.number,
    customer: customers.name,
    total: invoices.totalMinor,
  }[input.filters.sort];
  const orderBy = input.filters.direction === "asc"
    ? [asc(sortColumn), asc(invoices.id)]
    : [desc(sortColumn), desc(invoices.id)];
  const rowsQuery = db.select(selection).from(invoices)
    .innerJoin(salesOrders, and(eq(salesOrders.id, invoices.orderId), eq(salesOrders.organizationId, invoices.organizationId)))
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .innerJoin(warehouses, and(eq(warehouses.id, salesOrders.warehouseId), eq(warehouses.organizationId, salesOrders.organizationId)))
    .leftJoin(paymentTotals, eq(paymentTotals.invoiceId, invoices.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((input.filters.page - 1) * pageSize);
  const traceFilters = {
    organizationId: input.organizationId,
    status: input.filters.status,
    page: input.filters.page,
    sort: input.filters.sort,
    direction: input.filters.direction,
    hasSearch: Boolean(input.filters.q),
    hasRange: Boolean(input.filters.from),
    asOf: dates.asOfDate,
  };
  const [countRows, rows, matchingLineSummary] = await Promise.all([
    withQueryTrace({ name: "sales.invoices.count", source: "invoices + orders + customers + payments", permission: "invoices:read", sqlTemplate: countQuery.toSQL().sql, filters: traceFilters }, () => countQuery),
    withQueryTrace({ name: "sales.invoices.list", source: "invoices + orders + customers + warehouses + payments", permission: "invoices:read", sqlTemplate: rowsQuery.toSQL().sql, filters: traceFilters }, () => rowsQuery),
    matchingLineRevenueQuery
      ? withQueryTrace({ name: "sales.invoices.matching_line_total", source: "invoices + sales_orders + customers + sales_order_lines + products + payments", permission: "invoices:read", sqlTemplate: matchingLineRevenueQuery.toSQL().sql, filters: traceFilters }, () => matchingLineRevenueQuery)
      : Promise.resolve(null),
  ]);
  const [summary] = countRows;
  const total = Number(summary?.total ?? 0);
  return {
    rows: rows.map((row) => {
      const paidMinor = Number(row.paidMinor);
      const outstandingMinor = Number(row.outstandingMinor);
      return {
        ...row,
        paidMinor,
        outstandingMinor,
        matchingLineRevenueMinor: row.matchingLineRevenueMinor === null ? null : Number(row.matchingLineRevenueMinor),
        status: statusAtAsOf(paidMinor, outstandingMinor),
        agingBucket: agingAtAsOf(row.dueDate, dates.asOfDate, outstandingMinor),
        overdue: outstandingMinor > 0 && businessDate(row.dueDate) < dates.asOfDate,
      };
    }),
    total,
    page: input.filters.page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    asOf: dates.asOfDate,
    matchingLineRevenueMinor: matchingLineSummary ? asSafeNumber(matchingLineSummary[0]?.totalMinor) : null,
  };
}

export async function getInvoiceDetail(input: { organizationId: string; role: AppRole; invoiceId: string; asOf?: string }) {
  assertInvoiceRead(input.role);
  const db = getDb();
  const asOfDate = input.asOf ?? businessDate();
  const asOfEnd = businessDateStart(addCalendarDays(asOfDate, 1));
  const invoiceQuery = db.select({
    id: invoices.id,
    number: invoices.number,
    status: invoices.status,
    totalMinor: invoices.totalMinor,
    cogsMinor: invoices.cogsMinor,
    issuedAt: invoices.issuedAt,
    dueDate: invoices.dueDate,
    orderId: salesOrders.id,
    orderNumber: salesOrders.orderNumber,
    customerId: customers.id,
    customerName: customers.name,
    customerSegment: customers.segment,
    warehouseId: warehouses.id,
    warehouseName: warehouses.name,
  }).from(invoices)
    .innerJoin(salesOrders, and(eq(salesOrders.id, invoices.orderId), eq(salesOrders.organizationId, invoices.organizationId)))
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .innerJoin(warehouses, and(eq(warehouses.id, salesOrders.warehouseId), eq(warehouses.organizationId, salesOrders.organizationId)))
    .where(and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId)))
    .limit(1);
  const [invoice] = await withQueryTrace({
    name: "sales.invoices.detail",
    source: "invoices + sales_orders + customers + warehouses",
    permission: "invoices:read",
    sqlTemplate: invoiceQuery.toSQL().sql,
    filters: { organizationId: input.organizationId },
  }, () => invoiceQuery);
  if (!invoice) return null;

  const linesQuery = db.select({
    id: salesOrderLines.id,
    productId: products.id,
    sku: products.sku,
    productName: products.name,
    categoryId: products.categoryId,
    categoryName: categories.name,
    quantity: salesOrderLines.quantity,
    unitPriceMinor: salesOrderLines.unitPriceMinor,
    unitCostAtSaleMinor: salesOrderLines.unitCostAtSaleMinor,
  }).from(salesOrderLines)
    .innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
    .innerJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.organizationId, products.organizationId)))
    .where(and(eq(salesOrderLines.orderId, invoice.orderId), eq(salesOrderLines.organizationId, input.organizationId)))
    .orderBy(asc(products.sku), asc(salesOrderLines.id));
  const paymentsQuery = db.select({
    id: payments.id,
    amountMinor: payments.amountMinor,
    paidAt: payments.paidAt,
    method: payments.method,
  }).from(payments).where(and(
    eq(payments.invoiceId, invoice.id),
    eq(payments.organizationId, input.organizationId),
    lt(payments.paidAt, asOfEnd),
  )).orderBy(desc(payments.paidAt), desc(payments.id)).limit(100);
  const paymentSummaryQuery = db.select({
    paidMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int`,
    paymentCount: count(),
  }).from(payments).where(and(
    eq(payments.invoiceId, invoice.id),
    eq(payments.organizationId, input.organizationId),
    lt(payments.paidAt, asOfEnd),
  ));
  const [lines, paymentRows, [paymentSummary]] = await Promise.all([
    withQueryTrace({ name: "sales.invoices.detail.lines", source: "sales_order_lines + products + categories", permission: "invoices:read", sqlTemplate: linesQuery.toSQL().sql, filters: { organizationId: input.organizationId, invoiceId: invoice.id } }, () => linesQuery),
    withQueryTrace({ name: "sales.invoices.detail.payments", source: "payments", permission: "payments:read", sqlTemplate: paymentsQuery.toSQL().sql, filters: { organizationId: input.organizationId, invoiceId: invoice.id, asOf: asOfDate } }, () => paymentsQuery),
    withQueryTrace({ name: "sales.invoices.detail.payment_summary", source: "payments", permission: "payments:read", sqlTemplate: paymentSummaryQuery.toSQL().sql, filters: { organizationId: input.organizationId, invoiceId: invoice.id, asOf: asOfDate } }, () => paymentSummaryQuery),
  ]);
  const paidMinor = Number(paymentSummary?.paidMinor ?? 0);
  const outstandingMinor = Math.max(invoice.totalMinor - paidMinor, 0);
  return {
    invoice,
    lines,
    payments: paymentRows,
    paymentCount: Number(paymentSummary?.paymentCount ?? 0),
    paidMinor,
    outstandingMinor,
    status: statusAtAsOf(paidMinor, outstandingMinor),
    overdue: outstandingMinor > 0 && businessDate(invoice.dueDate) < asOfDate,
    agingBucket: agingAtAsOf(invoice.dueDate, asOfDate, outstandingMinor),
    asOf: asOfDate,
  };
}
