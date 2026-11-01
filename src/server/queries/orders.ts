import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { customers, invoices, payments, products, salesOrderLines, salesOrders, warehouses } from "@/server/db/schema";
import { can, type AppRole } from "@/server/auth/permissions";
import { withQueryTrace } from "@/server/observability/query-trace";

type OrderLineResult = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPriceMinor?: number;
  unitCostAtSaleMinor?: number | null;
};

function assertPermission(role: AppRole, permission: string) {
  if (!can(role, permission)) throw new Error("FORBIDDEN");
}

export async function listSalesOrders(input: { organizationId: string; role: AppRole }) {
  assertPermission(input.role, "orders:read");
  const query = db.select({
    id: salesOrders.id,
    orderNumber: salesOrders.orderNumber,
    customerName: customers.name,
    status: salesOrders.status,
    orderDate: salesOrders.orderDate,
    itemCount: sql<number>`count(${salesOrderLines.id})::int`,
    totalMinor: can(input.role, "dashboard:finance:read")
      ? sql<number>`coalesce(sum(${salesOrderLines.quantity} * ${salesOrderLines.unitPriceMinor}), 0)::int`
      : sql<null>`NULL`,
  }).from(salesOrders)
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .leftJoin(salesOrderLines, and(eq(salesOrderLines.orderId, salesOrders.id), eq(salesOrderLines.organizationId, salesOrders.organizationId)))
    .where(eq(salesOrders.organizationId, input.organizationId))
    .groupBy(salesOrders.id, customers.name)
    .orderBy(sql`${salesOrders.orderDate} DESC`)
    .limit(100);
  return withQueryTrace({
    name: "sales.orders.list",
    source: "sales_orders + customers + sales_order_lines",
    permission: "orders:read",
    sqlTemplate: query.toSQL().sql,
    filters: { organizationId: input.organizationId },
  }, () => query);
}

export async function getOrderCreationOptions(input: { organizationId: string; role: AppRole }) {
  assertPermission(input.role, "orders:write");
  const customerQuery = db.select({ id: customers.id, name: customers.name }).from(customers)
    .where(eq(customers.organizationId, input.organizationId)).orderBy(asc(customers.name)).limit(200);
  const warehouseQuery = db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
    .where(eq(warehouses.organizationId, input.organizationId)).orderBy(asc(warehouses.name));
  const showPrices = can(input.role, "dashboard:finance:read");
  const productQuery = showPrices
    ? db.select({ id: products.id, sku: products.sku, name: products.name, unitPriceMinor: products.unitPriceMinor })
      .from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.active, true)))
      .orderBy(asc(products.name)).limit(400)
    : db.select({ id: products.id, sku: products.sku, name: products.name })
      .from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.active, true)))
      .orderBy(asc(products.name)).limit(400);
  const [customerRows, warehouseRows, productRows] = await Promise.all([
    withQueryTrace({ name: "sales.orders.options.customers", source: "customers", permission: "orders:write", sqlTemplate: customerQuery.toSQL().sql, filters: { organizationId: input.organizationId } }, () => customerQuery),
    withQueryTrace({ name: "sales.orders.options.warehouses", source: "warehouses", permission: "orders:write", sqlTemplate: warehouseQuery.toSQL().sql, filters: { organizationId: input.organizationId } }, () => warehouseQuery),
    withQueryTrace({ name: "sales.orders.options.products", source: "products", permission: "orders:write", sqlTemplate: productQuery.toSQL().sql, filters: { organizationId: input.organizationId, active: true } }, () => productQuery),
  ]);
  return { customers: customerRows, warehouses: warehouseRows, products: productRows };
}

export async function getSalesOrderDetail(input: { organizationId: string; role: AppRole; orderId: string }) {
  assertPermission(input.role, "orders:read");
  const orderQuery = db.select({
    id: salesOrders.id,
    orderNumber: salesOrders.orderNumber,
    status: salesOrders.status,
    orderDate: salesOrders.orderDate,
    promisedDate: salesOrders.promisedDate,
    confirmedAt: salesOrders.confirmedAt,
    shippedAt: salesOrders.shippedAt,
    invoicedAt: salesOrders.invoicedAt,
    paidAt: salesOrders.paidAt,
    cancelledAt: salesOrders.cancelledAt,
    customerId: customers.id,
    customerName: customers.name,
    warehouseId: warehouses.id,
    warehouseName: warehouses.name,
  }).from(salesOrders)
    .innerJoin(customers, and(eq(customers.id, salesOrders.customerId), eq(customers.organizationId, salesOrders.organizationId)))
    .innerJoin(warehouses, and(eq(warehouses.id, salesOrders.warehouseId), eq(warehouses.organizationId, salesOrders.organizationId)))
    .where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.organizationId, input.organizationId)))
    .limit(1);
  const [orderRow] = await withQueryTrace({
    name: "sales.orders.detail",
    source: "sales_orders + customers + warehouses",
    permission: "orders:read",
    sqlTemplate: orderQuery.toSQL().sql,
    filters: { organizationId: input.organizationId },
  }, () => orderQuery);
  if (!orderRow) return null;

  const financial = can(input.role, "dashboard:finance:read");
  const lineQuery = financial
    ? db.select({
        id: salesOrderLines.id,
        productId: salesOrderLines.productId,
        sku: products.sku,
        productName: products.name,
        quantity: salesOrderLines.quantity,
        unitPriceMinor: salesOrderLines.unitPriceMinor,
        unitCostAtSaleMinor: salesOrderLines.unitCostAtSaleMinor,
      }).from(salesOrderLines).innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
        .where(and(eq(salesOrderLines.orderId, orderRow.id), eq(salesOrderLines.organizationId, input.organizationId)))
    : db.select({
        id: salesOrderLines.id,
        productId: salesOrderLines.productId,
        sku: products.sku,
        productName: products.name,
        quantity: salesOrderLines.quantity,
      }).from(salesOrderLines).innerJoin(products, and(eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId)))
        .where(and(eq(salesOrderLines.orderId, orderRow.id), eq(salesOrderLines.organizationId, input.organizationId)));
  const lines: OrderLineResult[] = await withQueryTrace({
    name: "sales.orders.detail.lines",
    source: "sales_order_lines + products",
    permission: "orders:read",
    sqlTemplate: lineQuery.toSQL().sql,
    filters: { organizationId: input.organizationId, orderId: orderRow.id, financial },
  }, () => lineQuery);

  let invoice = null;
  if (financial && can(input.role, "invoices:read")) {
    const invoiceQuery = db.select().from(invoices).where(and(
      eq(invoices.orderId, orderRow.id), eq(invoices.organizationId, input.organizationId),
    )).limit(1);
    const [invoiceRow] = await withQueryTrace({
      name: "sales.orders.detail.invoice",
      source: "invoices",
      permission: "invoices:read",
      sqlTemplate: invoiceQuery.toSQL().sql,
      filters: { organizationId: input.organizationId, orderId: orderRow.id },
    }, () => invoiceQuery);
    if (invoiceRow) {
      const paymentQuery = db.select({
        totalMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int`,
        count: count(payments.id),
      }).from(payments).where(and(
        eq(payments.invoiceId, invoiceRow.id), eq(payments.organizationId, input.organizationId),
      ));
      const [paymentSummary] = await withQueryTrace({
        name: "sales.orders.detail.payment_summary",
        source: "payments",
        permission: "payments:read",
        sqlTemplate: paymentQuery.toSQL().sql,
        filters: { organizationId: input.organizationId, invoiceId: invoiceRow.id },
      }, () => paymentQuery);
      invoice = { ...invoiceRow, paidMinor: Number(paymentSummary?.totalMinor ?? 0), paymentCount: paymentSummary?.count ?? 0 };
    }
  }
  return {
    order: orderRow,
    lines,
    invoice,
    canConfirm: can(input.role, "orders:write"),
    canShip: can(input.role, "orders:ship"),
    canInvoice: can(input.role, "orders:invoice"),
    canPay: can(input.role, "payments:record"),
    canCancel: can(input.role, "orders:write"),
    financial,
  };
}
