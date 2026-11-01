import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import {
  auditLogs,
  customers,
  idempotencyKeys,
  invoices,
  payments,
  products,
  salesOrderLines,
  salesOrders,
  stockLevels,
  stockMovements,
  warehouses,
} from "@/server/db/schema";
import { can, type AppRole } from "@/server/auth/permissions";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ServiceContext = {
  actorId: string;
  organizationId: string;
  role: AppRole;
  now?: () => Date;
};

export class OrderDomainError extends Error {
  constructor(readonly code: "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INSUFFICIENT_STOCK" | "INVALID_TRANSITION", message: string) {
    super(message);
    this.name = "OrderDomainError";
  }
}

const uuid = z.uuid();
const maxMoneyMinor = 2_147_483_647;
const lineSchema = z.object({ productId: uuid, quantity: z.number().int().positive().max(999) });
const createDraftSchema = z.object({
  customerId: uuid,
  warehouseId: uuid,
  lines: z.array(lineSchema).min(1).max(50),
  idempotencyKey: uuid,
});
const mutationSchema = z.object({ orderId: uuid, idempotencyKey: uuid });
const paymentSchema = mutationSchema.extend({
  amountMinor: z.number().int().positive(),
  method: z.enum(["bank_transfer", "cash", "check", "other"]),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new OrderDomainError("VALIDATION_ERROR", "Check the submitted order details and try again.");
  return result.data;
}

function requirePermission(context: ServiceContext, permission: string) {
  if (!can(context.role, permission)) throw new OrderDomainError("FORBIDDEN", "You do not have permission to perform this action.");
}

function timestamp(context: ServiceContext) {
  return (context.now ?? (() => new Date()))();
}

async function runIdempotent(
  context: ServiceContext,
  operation: string,
  key: string,
  payload: unknown,
  work: (tx: DatabaseTransaction) => Promise<string>,
) {
  const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return db.transaction(async (tx) => {
    const [claim] = await tx.insert(idempotencyKeys).values({
      organizationId: context.organizationId,
      actorId: context.actorId,
      operation,
      key,
      requestHash,
    }).onConflictDoNothing().returning({ id: idempotencyKeys.id });

    if (!claim) {
      const [prior] = await tx.select().from(idempotencyKeys).where(and(
        eq(idempotencyKeys.organizationId, context.organizationId),
        eq(idempotencyKeys.actorId, context.actorId),
        eq(idempotencyKeys.operation, operation),
        eq(idempotencyKeys.key, key),
      )).limit(1);
      if (!prior || prior.requestHash !== requestHash) {
        throw new OrderDomainError("CONFLICT", "This request key was already used for a different operation.");
      }
      if (!prior.resourceId) throw new OrderDomainError("CONFLICT", "The earlier request did not complete; retry with a new request.");
      return { resourceId: prior.resourceId, replayed: true };
    }

    const resourceId = await work(tx);
    await tx.update(idempotencyKeys).set({ resourceId }).where(eq(idempotencyKeys.id, claim.id));
    return { resourceId, replayed: false };
  });
}

async function writeAudit(
  tx: DatabaseTransaction,
  context: ServiceContext,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await tx.insert(auditLogs).values({
    organizationId: context.organizationId,
    actorId: context.actorId,
    action,
    entityType,
    entityId,
    before,
    after,
    at: timestamp(context),
  });
}

async function lockedOrder(tx: DatabaseTransaction, context: ServiceContext, orderId: string) {
  const [order] = await tx.select().from(salesOrders).where(and(
    eq(salesOrders.id, orderId),
    eq(salesOrders.organizationId, context.organizationId),
  )).for("update").limit(1);
  if (!order) throw new OrderDomainError("NOT_FOUND", "Order not found.");
  return order;
}

export async function createDraftOrder(context: ServiceContext, input: unknown) {
  requirePermission(context, "orders:write");
  const data = parse(createDraftSchema, input);
  const normalizedLines = [...data.lines.reduce((map, line) => map.set(line.productId, (map.get(line.productId) ?? 0) + line.quantity), new Map<string, number>())]
    .map(([productId, quantity]) => ({ productId, quantity }));
  if (normalizedLines.some((line) => line.quantity > 999)) throw new OrderDomainError("VALIDATION_ERROR", "A product quantity cannot exceed 999.");
  const payload = { customerId: data.customerId, warehouseId: data.warehouseId, lines: normalizedLines };

  return runIdempotent(context, "orders.create", data.idempotencyKey, payload, async (tx) => {
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(and(
      eq(customers.id, data.customerId), eq(customers.organizationId, context.organizationId),
    )).limit(1);
    const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(
      eq(warehouses.id, data.warehouseId), eq(warehouses.organizationId, context.organizationId),
    )).limit(1);
    if (!customer || !warehouse) throw new OrderDomainError("VALIDATION_ERROR", "Choose a valid customer and warehouse.");

    const productIds = normalizedLines.map((line) => line.productId);
    const productRows = await tx.select().from(products).where(and(
      eq(products.organizationId, context.organizationId),
      eq(products.active, true),
      inArray(products.id, productIds),
    ));
    if (productRows.length !== productIds.length) throw new OrderDomainError("VALIDATION_ERROR", "One or more products are unavailable.");
    const byId = new Map(productRows.map((product) => [product.id, product]));
    const now = timestamp(context);
    const id = crypto.randomUUID();
    const orderNumber = `SO-${now.getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
    const [order] = await tx.insert(salesOrders).values({
      id,
      organizationId: context.organizationId,
      orderNumber,
      customerId: data.customerId,
      warehouseId: data.warehouseId,
      status: "draft",
      orderDate: now,
      createdBy: context.actorId,
    }).returning();
    await tx.insert(salesOrderLines).values(normalizedLines.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        organizationId: context.organizationId,
        orderId: order.id,
        productId: product.id,
        quantity: line.quantity,
        unitPriceMinor: product.unitPriceMinor,
      };
    }));
    await writeAudit(tx, context, "order.created", "sales_order", order.id, null, { orderNumber, status: "draft", lineCount: normalizedLines.length });
    return order.id;
  });
}

export async function updateDraftOrder(context: ServiceContext, input: unknown) {
  requirePermission(context, "orders:write");
  const data = parse(createDraftSchema.extend({ orderId: uuid }), input);
  const normalizedLines = [...data.lines.reduce((map, line) => map.set(line.productId, (map.get(line.productId) ?? 0) + line.quantity), new Map<string, number>())]
    .map(([productId, quantity]) => ({ productId, quantity }));
  if (normalizedLines.some((line) => line.quantity > 999)) throw new OrderDomainError("VALIDATION_ERROR", "A product quantity cannot exceed 999.");
  const payload = { orderId: data.orderId, customerId: data.customerId, warehouseId: data.warehouseId, lines: normalizedLines };

  return runIdempotent(context, "orders.update_draft", data.idempotencyKey, payload, async (tx) => {
    const order = await lockedOrder(tx, context, data.orderId);
    if (order.status !== "draft") throw new OrderDomainError("INVALID_TRANSITION", "Only draft orders can be edited.");
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(and(
      eq(customers.id, data.customerId), eq(customers.organizationId, context.organizationId),
    )).limit(1);
    const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(
      eq(warehouses.id, data.warehouseId), eq(warehouses.organizationId, context.organizationId),
    )).limit(1);
    if (!customer || !warehouse) throw new OrderDomainError("VALIDATION_ERROR", "Choose a valid customer and warehouse.");
    const productIds = normalizedLines.map((line) => line.productId);
    const productRows = await tx.select().from(products).where(and(
      eq(products.organizationId, context.organizationId), eq(products.active, true), inArray(products.id, productIds),
    ));
    if (productRows.length !== productIds.length) throw new OrderDomainError("VALIDATION_ERROR", "One or more products are unavailable.");
    const oldLines = await tx.select({ productId: salesOrderLines.productId, quantity: salesOrderLines.quantity })
      .from(salesOrderLines).where(and(eq(salesOrderLines.orderId, order.id), eq(salesOrderLines.organizationId, context.organizationId)));
    const productById = new Map(productRows.map((product) => [product.id, product]));
    await tx.delete(salesOrderLines).where(and(eq(salesOrderLines.orderId, order.id), eq(salesOrderLines.organizationId, context.organizationId)));
    await tx.insert(salesOrderLines).values(normalizedLines.map((line) => ({
      organizationId: context.organizationId,
      orderId: order.id,
      productId: line.productId,
      quantity: line.quantity,
      unitPriceMinor: productById.get(line.productId)!.unitPriceMinor,
    })));
    const now = timestamp(context);
    await tx.update(salesOrders).set({ customerId: data.customerId, warehouseId: data.warehouseId, updatedAt: now }).where(eq(salesOrders.id, order.id));
    await writeAudit(tx, context, "order.updated", "sales_order", order.id,
      { customerId: order.customerId, warehouseId: order.warehouseId, lines: oldLines },
      { customerId: data.customerId, warehouseId: data.warehouseId, lines: normalizedLines });
    return order.id;
  });
}

export async function confirmOrder(context: ServiceContext, input: unknown) {
  requirePermission(context, "orders:write");
  const data = parse(mutationSchema, input);
  return runIdempotent(context, "orders.confirm", data.idempotencyKey, { orderId: data.orderId }, async (tx) => {
    const order = await lockedOrder(tx, context, data.orderId);
    if (order.status !== "draft") throw new OrderDomainError("INVALID_TRANSITION", "Only draft orders can be confirmed.");
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(and(
      eq(customers.id, order.customerId), eq(customers.organizationId, context.organizationId),
    )).limit(1);
    const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(
      eq(warehouses.id, order.warehouseId), eq(warehouses.organizationId, context.organizationId),
    )).limit(1);
    const lines = await tx.select({ productId: salesOrderLines.productId, active: products.active })
      .from(salesOrderLines).innerJoin(products, and(
        eq(products.id, salesOrderLines.productId), eq(products.organizationId, salesOrderLines.organizationId),
      )).where(and(
        eq(salesOrderLines.orderId, order.id), eq(salesOrderLines.organizationId, context.organizationId),
      ));
    if (!customer || !warehouse || !lines.length || lines.some((line) => !line.active)) {
      throw new OrderDomainError("CONFLICT", "The customer, warehouse, or product lines are no longer valid.");
    }
    const now = timestamp(context);
    await tx.update(salesOrders).set({ status: "confirmed", confirmedAt: now, updatedAt: now }).where(eq(salesOrders.id, order.id));
    await writeAudit(tx, context, "order.confirmed", "sales_order", order.id, { status: order.status }, { status: "confirmed", confirmedAt: now });
    return order.id;
  });
}

export async function shipOrder(context: ServiceContext, input: unknown) {
  requirePermission(context, "orders:ship");
  const data = parse(mutationSchema, input);
  return runIdempotent(context, "orders.ship", data.idempotencyKey, { orderId: data.orderId }, async (tx) => {
    const order = await lockedOrder(tx, context, data.orderId);
    if (order.status !== "confirmed") throw new OrderDomainError("INVALID_TRANSITION", "Only confirmed orders can be shipped.");
    const lines = await tx.select().from(salesOrderLines).where(and(
      eq(salesOrderLines.orderId, order.id), eq(salesOrderLines.organizationId, context.organizationId),
    )).orderBy(asc(salesOrderLines.productId));
    if (!lines.length) throw new OrderDomainError("CONFLICT", "This order has no lines to ship.");
    const levels = await tx.select().from(stockLevels).where(and(
      eq(stockLevels.organizationId, context.organizationId),
      eq(stockLevels.warehouseId, order.warehouseId),
      inArray(stockLevels.productId, lines.map((line) => line.productId)),
    )).orderBy(asc(stockLevels.productId)).for("update");
    const byProduct = new Map(levels.map((level) => [level.productId, level]));
    for (const line of lines) {
      const level = byProduct.get(line.productId);
      if (!level || level.quantity < line.quantity) {
        const [product] = await tx.select({ name: products.name }).from(products).where(and(
          eq(products.id, line.productId), eq(products.organizationId, context.organizationId),
        )).limit(1);
        throw new OrderDomainError("INSUFFICIENT_STOCK", `Not enough stock to ship ${product?.name ?? "a product"}.`);
      }
    }
    const now = timestamp(context);
    for (const line of lines) {
      const level = byProduct.get(line.productId)!;
      await tx.update(stockLevels).set({
        quantity: sql`${stockLevels.quantity} - ${line.quantity}`,
        updatedAt: now,
      }).where(and(eq(stockLevels.id, level.id), sql`${stockLevels.quantity} >= ${line.quantity}`));
      await tx.update(salesOrderLines).set({ unitCostAtSaleMinor: level.averageUnitCostMinor }).where(eq(salesOrderLines.id, line.id));
      await tx.insert(stockMovements).values({
        organizationId: context.organizationId,
        productId: line.productId,
        warehouseId: order.warehouseId,
        type: "shipment",
        quantity: -line.quantity,
        unitCostMinor: level.averageUnitCostMinor,
        referenceType: "sales_order",
        referenceId: order.id,
        createdBy: context.actorId,
        createdAt: now,
      });
      await writeAudit(tx, context, "stock.shipped", "stock_level", level.id,
        { productId: line.productId, warehouseId: order.warehouseId, quantity: level.quantity },
        { productId: line.productId, warehouseId: order.warehouseId, quantity: level.quantity - line.quantity, referenceOrderId: order.id });
    }
    await tx.update(salesOrders).set({ status: "shipped", shippedAt: now, updatedAt: now }).where(eq(salesOrders.id, order.id));
    await writeAudit(tx, context, "order.shipped", "sales_order", order.id, { status: order.status }, { status: "shipped", shippedAt: now });
    return order.id;
  });
}

export async function issueInvoice(context: ServiceContext, input: unknown) {
  requirePermission(context, "orders:invoice");
  const data = parse(mutationSchema, input);
  return runIdempotent(context, "orders.invoice", data.idempotencyKey, { orderId: data.orderId }, async (tx) => {
    const order = await lockedOrder(tx, context, data.orderId);
    if (order.status !== "shipped") throw new OrderDomainError("INVALID_TRANSITION", "Only shipped orders can be invoiced.");
    const lines = await tx.select().from(salesOrderLines).where(and(
      eq(salesOrderLines.orderId, order.id), eq(salesOrderLines.organizationId, context.organizationId),
    ));
    if (!lines.length || lines.some((line) => line.unitCostAtSaleMinor === null)) throw new OrderDomainError("CONFLICT", "Shipment cost snapshots are missing; no invoice was created.");
    const totalMinor = lines.reduce((total, line) => total + line.quantity * line.unitPriceMinor, 0);
    const cogsMinor = lines.reduce((total, line) => total + line.quantity * (line.unitCostAtSaleMinor ?? 0), 0);
    if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0 || totalMinor > maxMoneyMinor || !Number.isSafeInteger(cogsMinor) || cogsMinor > maxMoneyMinor) {
      throw new OrderDomainError("VALIDATION_ERROR", "Order totals are outside the supported range.");
    }
    const [customer] = await tx.select({ paymentTermsDays: customers.paymentTermsDays }).from(customers).where(and(
      eq(customers.id, order.customerId), eq(customers.organizationId, context.organizationId),
    )).limit(1);
    if (!customer) throw new OrderDomainError("NOT_FOUND", "Customer not found.");
    const now = timestamp(context);
    const id = crypto.randomUUID();
    const invoiceNumber = `INV-${now.getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
    await tx.insert(invoices).values({
      id,
      organizationId: context.organizationId,
      orderId: order.id,
      number: invoiceNumber,
      issuedAt: now,
      dueDate: new Date(now.getTime() + customer.paymentTermsDays * 86_400_000),
      status: "unpaid",
      totalMinor,
      cogsMinor,
      createdAt: now,
    });
    await tx.update(salesOrders).set({ status: "invoiced", invoicedAt: now, updatedAt: now }).where(eq(salesOrders.id, order.id));
    await writeAudit(tx, context, "invoice.issued", "invoice", id, null, { orderId: order.id, number: invoiceNumber, totalMinor, cogsMinor });
    await writeAudit(tx, context, "order.invoiced", "sales_order", order.id, { status: order.status }, { status: "invoiced", invoicedAt: now, invoiceId: id });
    return id;
  });
}

export async function recordPayment(context: ServiceContext, input: unknown) {
  requirePermission(context, "payments:record");
  const data = parse(paymentSchema, input);
  return runIdempotent(context, "invoices.payment", data.idempotencyKey, {
    orderId: data.orderId,
    amountMinor: data.amountMinor,
    method: data.method,
  }, async (tx) => {
    const order = await lockedOrder(tx, context, data.orderId);
    if (order.status !== "invoiced") throw new OrderDomainError("INVALID_TRANSITION", "Payments can only be recorded for invoiced orders.");
    const [invoice] = await tx.select().from(invoices).where(and(
      eq(invoices.orderId, order.id), eq(invoices.organizationId, context.organizationId),
    )).for("update").limit(1);
    if (!invoice) throw new OrderDomainError("NOT_FOUND", "Invoice not found.");
    const [{ paidMinor }] = await tx.select({ paidMinor: sql<number>`COALESCE(SUM(${payments.amountMinor}), 0)::int` })
      .from(payments).where(and(eq(payments.invoiceId, invoice.id), eq(payments.organizationId, context.organizationId)));
    const outstanding = invoice.totalMinor - Number(paidMinor);
    if (data.amountMinor > outstanding) throw new OrderDomainError("CONFLICT", "Payment exceeds the outstanding invoice balance.");
    const now = timestamp(context);
    const [payment] = await tx.insert(payments).values({
      organizationId: context.organizationId,
      invoiceId: invoice.id,
      amountMinor: data.amountMinor,
      paidAt: now,
      method: data.method,
      recordedBy: context.actorId,
      createdAt: now,
    }).returning({ id: payments.id });
    const settled = data.amountMinor === outstanding;
    const nextInvoiceStatus = settled ? "paid" : "partial";
    await tx.update(invoices).set({ status: nextInvoiceStatus }).where(eq(invoices.id, invoice.id));
    if (settled) await tx.update(salesOrders).set({ status: "paid", paidAt: now, updatedAt: now }).where(eq(salesOrders.id, order.id));
    await writeAudit(tx, context, "payment.recorded", "payment", payment.id, null, { invoiceId: invoice.id, amountMinor: data.amountMinor, method: data.method });
    if (settled) await writeAudit(tx, context, "order.paid", "sales_order", order.id, { status: order.status }, { status: "paid", paidAt: now });
    return payment.id;
  });
}

export async function cancelOrder(context: ServiceContext, input: unknown) {
  requirePermission(context, "orders:write");
  const data = parse(mutationSchema, input);
  return runIdempotent(context, "orders.cancel", data.idempotencyKey, { orderId: data.orderId }, async (tx) => {
    const order = await lockedOrder(tx, context, data.orderId);
    if (order.status !== "draft" && order.status !== "confirmed") throw new OrderDomainError("INVALID_TRANSITION", "Only draft or confirmed orders can be cancelled.");
    const now = timestamp(context);
    await tx.update(salesOrders).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(salesOrders.id, order.id));
    await writeAudit(tx, context, "order.cancelled", "sales_order", order.id, { status: order.status }, { status: "cancelled", cancelledAt: now });
    return order.id;
  });
}
