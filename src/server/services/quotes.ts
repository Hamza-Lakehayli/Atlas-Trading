import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db";
import { auditLogs, customers, idempotencyKeys, products, quoteLines, quotes, salesOrderLines, salesOrders, warehouses } from "@/server/db/schema";
import { can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/services/context";
import { businessDate } from "@/lib/dates/business-date";

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class QuoteDomainError extends Error {
  constructor(readonly code: "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID_TRANSITION", message: string) {
    super(message);
    this.name = "QuoteDomainError";
  }
}

const uuid = z.uuid();
const maxMoneyMinor = 2_147_483_647;
const validDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const lineSchema = z.object({ productId: uuid, quantity: z.number().int().positive().max(999) });
const quoteDraftSchema = z.object({
  customerId: uuid,
  warehouseId: uuid,
  validUntil: validDate,
  lines: z.array(lineSchema).min(1).max(50),
  idempotencyKey: uuid,
});
const mutationSchema = z.object({ quoteId: uuid, idempotencyKey: uuid });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new QuoteDomainError("VALIDATION_ERROR", "Check the quote details and try again.");
  return parsed.data;
}

function requirePermission(context: ServiceContext, permission: string) {
  if (!can(context.role, permission)) throw new QuoteDomainError("FORBIDDEN", "Your role cannot perform that quote action.");
}

function now(context: ServiceContext) {
  return (context.now ?? (() => new Date()))();
}

function assertValidOnDate(validUntil: string, value: Date) {
  if (validUntil < businessDate(value)) {
    throw new QuoteDomainError("INVALID_TRANSITION", "This quote has expired and can no longer be sent, accepted, or converted.");
  }
}

function normalizeLines(lines: Array<z.infer<typeof lineSchema>>) {
  const quantities = new Map<string, number>();
  for (const line of lines) quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
  const normalized = [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
  if (normalized.some((line) => line.quantity > 999)) throw new QuoteDomainError("VALIDATION_ERROR", "A product quantity cannot exceed 999.");
  return normalized;
}

async function runIdempotent(
  context: ServiceContext,
  operation: string,
  key: string,
  payload: unknown,
  work: (tx: DatabaseTransaction) => Promise<string>,
) {
  const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const db = getDb();
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
      if (!prior || prior.requestHash !== requestHash || !prior.resourceId) {
        throw new QuoteDomainError("CONFLICT", "This request key was already used for a different quote action.");
      }
      return { resourceId: prior.resourceId, replayed: true };
    }

    const resourceId = await work(tx);
    await tx.update(idempotencyKeys).set({ resourceId }).where(eq(idempotencyKeys.id, claim.id));
    return { resourceId, replayed: false };
  });
}

async function audit(tx: DatabaseTransaction, context: ServiceContext, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  await tx.insert(auditLogs).values({
    organizationId: context.organizationId,
    actorId: context.actorId,
    action,
    entityType,
    entityId,
    before,
    after,
    at: now(context),
  });
}

async function activeProducts(tx: DatabaseTransaction, context: ServiceContext, lines: Array<{ productId: string; quantity: number }>) {
  const ids = lines.map((line) => line.productId);
  const rows = await tx.select().from(products).where(and(
    eq(products.organizationId, context.organizationId),
    eq(products.active, true),
    inArray(products.id, ids),
  ));
  if (rows.length !== ids.length) throw new QuoteDomainError("VALIDATION_ERROR", "One or more products are unavailable.");
  return new Map(rows.map((product) => [product.id, product]));
}

function totalOf(lines: Array<{ quantity: number; unitPriceMinor: number }>) {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total > maxMoneyMinor) {
    throw new QuoteDomainError("VALIDATION_ERROR", "Quote totals are outside the supported range.");
  }
  return total;
}

export async function createDraftQuote(context: ServiceContext, input: unknown) {
  requirePermission(context, "quotes:write");
  const data = parse(quoteDraftSchema, input);
  const lines = normalizeLines(data.lines);
  const payload = { customerId: data.customerId, warehouseId: data.warehouseId, validUntil: data.validUntil, lines };
  return runIdempotent(context, "quotes.create", data.idempotencyKey, payload, async (tx) => {
    assertValidOnDate(data.validUntil, now(context));
    const [[customer], [warehouse]] = await Promise.all([
      tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, data.customerId), eq(customers.organizationId, context.organizationId))).limit(1),
      tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, data.warehouseId), eq(warehouses.organizationId, context.organizationId))).limit(1),
    ]);
    if (!customer || !warehouse) throw new QuoteDomainError("VALIDATION_ERROR", "Choose a valid customer and warehouse.");
    const productsById = await activeProducts(tx, context, lines);
    const lineSnapshots = lines.map((line) => {
      const product = productsById.get(line.productId)!;
      return { ...line, skuSnapshot: product.sku, productNameSnapshot: product.name, unitPriceMinor: product.unitPriceMinor };
    });
    totalOf(lineSnapshots);
    const createdAt = now(context);
    const id = crypto.randomUUID();
    const quoteNumber = `QT-${createdAt.getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
    const [quote] = await tx.insert(quotes).values({
      id,
      organizationId: context.organizationId,
      quoteNumber,
      customerId: data.customerId,
      warehouseId: data.warehouseId,
      validUntil: data.validUntil,
      createdBy: context.actorId,
      createdAt,
      updatedAt: createdAt,
    }).returning();
    await tx.insert(quoteLines).values(lineSnapshots.map((line) => ({
      organizationId: context.organizationId,
      quoteId: quote.id,
      ...line,
      createdAt,
    })));
    await audit(tx, context, "quote.created", "quote", quote.id, null, {
      quoteNumber,
      customerId: data.customerId,
      warehouseId: data.warehouseId,
      validUntil: data.validUntil,
      totalMinor: totalOf(lineSnapshots),
      status: "draft",
    });
    return quote.id;
  });
}

export async function updateDraftQuote(context: ServiceContext, input: unknown) {
  requirePermission(context, "quotes:write");
  const data = parse(quoteDraftSchema.extend({ quoteId: uuid }), input);
  const lines = normalizeLines(data.lines);
  const payload = { quoteId: data.quoteId, customerId: data.customerId, warehouseId: data.warehouseId, validUntil: data.validUntil, lines };
  return runIdempotent(context, "quotes.update_draft", data.idempotencyKey, payload, async (tx) => {
    const [quote] = await tx.select().from(quotes).where(and(
      eq(quotes.id, data.quoteId), eq(quotes.organizationId, context.organizationId),
    )).for("update").limit(1);
    if (!quote) throw new QuoteDomainError("NOT_FOUND", "Quote not found.");
    if (quote.status !== "draft") throw new QuoteDomainError("INVALID_TRANSITION", "Only draft quotes can be edited.");
    assertValidOnDate(data.validUntil, now(context));
    const [[customer], [warehouse]] = await Promise.all([
      tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, data.customerId), eq(customers.organizationId, context.organizationId))).limit(1),
      tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, data.warehouseId), eq(warehouses.organizationId, context.organizationId))).limit(1),
    ]);
    if (!customer || !warehouse) throw new QuoteDomainError("VALIDATION_ERROR", "Choose a valid customer and warehouse.");
    const productsById = await activeProducts(tx, context, lines);
    const lineSnapshots = lines.map((line) => {
      const product = productsById.get(line.productId)!;
      return { ...line, skuSnapshot: product.sku, productNameSnapshot: product.name, unitPriceMinor: product.unitPriceMinor };
    });
    totalOf(lineSnapshots);
    const oldLines = await tx.select({ productId: quoteLines.productId, quantity: quoteLines.quantity, unitPriceMinor: quoteLines.unitPriceMinor })
      .from(quoteLines).where(and(eq(quoteLines.quoteId, quote.id), eq(quoteLines.organizationId, context.organizationId)));
    const updatedAt = now(context);
    await tx.delete(quoteLines).where(and(eq(quoteLines.quoteId, quote.id), eq(quoteLines.organizationId, context.organizationId)));
    await tx.insert(quoteLines).values(lineSnapshots.map((line) => ({ organizationId: context.organizationId, quoteId: quote.id, ...line, createdAt: updatedAt })));
    await tx.update(quotes).set({
      customerId: data.customerId,
      warehouseId: data.warehouseId,
      validUntil: data.validUntil,
      updatedAt,
    }).where(eq(quotes.id, quote.id));
    await audit(tx, context, "quote.updated", "quote", quote.id,
      { customerId: quote.customerId, warehouseId: quote.warehouseId, validUntil: quote.validUntil, lines: oldLines },
      { customerId: data.customerId, warehouseId: data.warehouseId, validUntil: data.validUntil, lines: lineSnapshots });
    return quote.id;
  });
}

async function changeQuoteStatus(context: ServiceContext, input: unknown, operation: string, from: string, to: string, timestampColumn: "sentAt" | "acceptedAt" | "rejectedAt") {
  requirePermission(context, "quotes:write");
  const data = parse(mutationSchema, input);
  return runIdempotent(context, operation, data.idempotencyKey, { quoteId: data.quoteId }, async (tx) => {
    const [quote] = await tx.select().from(quotes).where(and(
      eq(quotes.id, data.quoteId), eq(quotes.organizationId, context.organizationId),
    )).for("update").limit(1);
    if (!quote) throw new QuoteDomainError("NOT_FOUND", "Quote not found.");
    if (quote.status !== from) throw new QuoteDomainError("INVALID_TRANSITION", `A ${quote.status} quote cannot be ${to}.`);
    assertValidOnDate(quote.validUntil, now(context));
    const updatedAt = now(context);
    await tx.update(quotes).set({ status: to, [timestampColumn]: updatedAt, updatedAt }).where(eq(quotes.id, quote.id));
    await audit(tx, context, `quote.${to}`, "quote", quote.id,
      { status: quote.status }, { status: to, at: updatedAt });
    return quote.id;
  });
}

export function sendQuote(context: ServiceContext, input: unknown) {
  return changeQuoteStatus(context, input, "quotes.send", "draft", "sent", "sentAt");
}

export function acceptQuote(context: ServiceContext, input: unknown) {
  return changeQuoteStatus(context, input, "quotes.accept", "sent", "accepted", "acceptedAt");
}

export function rejectQuote(context: ServiceContext, input: unknown) {
  return changeQuoteStatus(context, input, "quotes.reject", "sent", "rejected", "rejectedAt");
}

export async function convertAcceptedQuoteToOrder(context: ServiceContext, input: unknown) {
  requirePermission(context, "quotes:write");
  requirePermission(context, "orders:write");
  const data = parse(mutationSchema, input);
  return runIdempotent(context, "quotes.convert", data.idempotencyKey, { quoteId: data.quoteId }, async (tx) => {
    const [quote] = await tx.select().from(quotes).where(and(
      eq(quotes.id, data.quoteId), eq(quotes.organizationId, context.organizationId),
    )).for("update").limit(1);
    if (!quote) throw new QuoteDomainError("NOT_FOUND", "Quote not found.");
    if (quote.status !== "accepted") throw new QuoteDomainError("INVALID_TRANSITION", "Only accepted quotes can be converted to an order.");
    const lines = await tx.select().from(quoteLines).where(and(
      eq(quoteLines.quoteId, quote.id), eq(quoteLines.organizationId, context.organizationId),
    )).orderBy(asc(quoteLines.productId));
    if (!lines.length) throw new QuoteDomainError("CONFLICT", "The accepted quote has no lines to convert.");
    totalOf(lines);
    const productRows = await tx.select({ id: products.id, active: products.active }).from(products).where(and(
      eq(products.organizationId, context.organizationId),
      inArray(products.id, lines.map((line) => line.productId)),
    ));
    if (productRows.length !== lines.length || productRows.some((product) => !product.active)) {
      throw new QuoteDomainError("CONFLICT", "A quoted product is no longer available. No order was created.");
    }
    const createdAt = now(context);
    const orderId = crypto.randomUUID();
    const orderNumber = `SO-${createdAt.getUTCFullYear()}-${orderId.slice(0, 8).toUpperCase()}`;
    await tx.insert(salesOrders).values({
      id: orderId,
      organizationId: context.organizationId,
      orderNumber,
      customerId: quote.customerId,
      warehouseId: quote.warehouseId,
      sourceQuoteId: quote.id,
      status: "draft",
      orderDate: createdAt,
      createdBy: context.actorId,
      createdAt,
      updatedAt: createdAt,
    });
    await tx.insert(salesOrderLines).values(lines.map((line) => ({
      organizationId: context.organizationId,
      orderId,
      productId: line.productId,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      createdAt,
    })));
    await tx.update(quotes).set({ status: "converted", convertedAt: createdAt, updatedAt: createdAt }).where(eq(quotes.id, quote.id));
    await audit(tx, context, "order.created_from_quote", "sales_order", orderId, null, {
      orderNumber,
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      status: "draft",
      lineCount: lines.length,
    });
    await audit(tx, context, "quote.converted", "quote", quote.id,
      { status: quote.status }, { status: "converted", convertedAt: createdAt, orderId });
    return orderId;
  });
}
