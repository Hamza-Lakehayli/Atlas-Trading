import { and, asc, count, desc, eq, ilike, max, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { customers, salesOrders } from "@/server/db/schema";
import { can, type AppRole } from "@/server/auth/permissions";
import type { CustomerFilters } from "@/lib/customers/filters";
import { withQueryTrace } from "@/server/observability/query-trace";

const pageSize = 25;

function assertCustomerRead(role: AppRole) {
  if (!can(role, "customers:read")) throw new Error("FORBIDDEN");
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function customerConditions(input: { organizationId: string; filters: CustomerFilters }) {
  const conditions = [eq(customers.organizationId, input.organizationId)];
  if (input.filters.segment !== "all") conditions.push(eq(customers.segment, input.filters.segment));
  if (input.filters.q) {
    const pattern = `%${escapeLike(input.filters.q)}%`;
    conditions.push(or(ilike(customers.name, pattern), ilike(customers.city, pattern))!);
  }
  return and(...conditions);
}

export async function listCustomers(input: { organizationId: string; role: AppRole; filters: CustomerFilters }) {
  assertCustomerRead(input.role);
  const db = getDb();
  const where = customerConditions(input);
  const countQuery = db.select({ total: count() }).from(customers).where(where);
  const rowsQuery = db.select({
    id: customers.id,
    name: customers.name,
    segment: customers.segment,
    city: customers.city,
    paymentTermsDays: customers.paymentTermsDays,
    createdAt: customers.createdAt,
    orderCount: sql<number>`count(${salesOrders.id})::int`,
    lastOrderAt: max(salesOrders.orderDate),
  }).from(customers)
    .leftJoin(salesOrders, and(eq(salesOrders.customerId, customers.id), eq(salesOrders.organizationId, customers.organizationId)))
    .where(where)
    .groupBy(customers.id)
    .orderBy(asc(customers.name), asc(customers.id))
    .limit(pageSize)
    .offset((input.filters.page - 1) * pageSize);

  const traceFilters = {
    organizationId: input.organizationId,
    segment: input.filters.segment,
    page: input.filters.page,
    hasSearch: Boolean(input.filters.q),
  };
  const [[summary], rows] = await Promise.all([
    withQueryTrace({ name: "sales.customers.count", source: "customers", permission: "customers:read", sqlTemplate: countQuery.toSQL().sql, filters: traceFilters }, () => countQuery),
    withQueryTrace({ name: "sales.customers.list", source: "customers + sales_orders", permission: "customers:read", sqlTemplate: rowsQuery.toSQL().sql, filters: traceFilters }, () => rowsQuery),
  ]);
  const total = Number(summary?.total ?? 0);
  return { rows, total, page: input.filters.page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getCustomerDetail(input: { organizationId: string; role: AppRole; customerId: string }) {
  assertCustomerRead(input.role);
  const db = getDb();
  const customerQuery = db.select({
    id: customers.id,
    name: customers.name,
    segment: customers.segment,
    city: customers.city,
    paymentTermsDays: customers.paymentTermsDays,
    createdAt: customers.createdAt,
  }).from(customers).where(and(
    eq(customers.id, input.customerId), eq(customers.organizationId, input.organizationId),
  )).limit(1);
  const [customer] = await withQueryTrace({
    name: "sales.customers.detail",
    source: "customers",
    permission: "customers:read",
    sqlTemplate: customerQuery.toSQL().sql,
    filters: { organizationId: input.organizationId },
  }, () => customerQuery);
  if (!customer) return null;

  const countQuery = db.select({ total: count() }).from(salesOrders).where(and(
    eq(salesOrders.customerId, customer.id), eq(salesOrders.organizationId, input.organizationId),
  ));
  const ordersQuery = db.select({
    id: salesOrders.id,
    orderNumber: salesOrders.orderNumber,
    status: salesOrders.status,
    orderDate: salesOrders.orderDate,
  }).from(salesOrders).where(and(
    eq(salesOrders.customerId, customer.id), eq(salesOrders.organizationId, input.organizationId),
  )).orderBy(desc(salesOrders.orderDate), desc(salesOrders.id)).limit(10);
  const [[summary], orders] = await Promise.all([
    withQueryTrace({ name: "sales.customers.detail.order_count", source: "sales_orders", permission: "customers:read", sqlTemplate: countQuery.toSQL().sql, filters: { organizationId: input.organizationId, customerId: customer.id } }, () => countQuery),
    withQueryTrace({ name: "sales.customers.detail.orders", source: "sales_orders", permission: "customers:read", sqlTemplate: ordersQuery.toSQL().sql, filters: { organizationId: input.organizationId, customerId: customer.id } }, () => ordersQuery),
  ]);
  return { customer, orderCount: Number(summary?.total ?? 0), orders };
}
