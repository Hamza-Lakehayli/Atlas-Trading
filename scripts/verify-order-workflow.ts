import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/server/db";
import { auditLogs, categories, customers, idempotencyKeys, invoices, organizations, payments, products, salesOrderLines, salesOrders, stockLevels, stockMovements, users, warehouses } from "../src/server/db/schema";
import { getMigrationDatabaseUrl } from "../src/lib/env";
import { OrderDomainError, cancelOrder, confirmOrder, createDraftOrder, issueInvoice, recordPayment, shipOrder, type ServiceContext, updateDraftOrder } from "../src/server/services/orders";
import { getSalesOrderDetail, listSalesOrders } from "../src/server/queries/orders";

function assertLocalDatabase() {
  const url = new URL(getMigrationDatabaseUrl());
  if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
    throw new Error("Order integration verification only runs against the isolated local PostgreSQL database.");
  }
}

async function expectCode(operation: Promise<unknown>, code: OrderDomainError["code"]) {
  try {
    await operation;
  } catch (error) {
    assert.ok(error instanceof OrderDomainError);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`Expected ${code} domain error`);
}

async function main() {
  assertLocalDatabase();
  const db = getDb();
  const testToken = crypto.randomUUID();
  const [org] = await db.insert(organizations).values({ name: `__local_order_test_${testToken}` }).returning();
  let productId: string | undefined;
  let customerId: string | undefined;
  try {
    const actors = await db.insert(users).values([
      { id: `workflow-admin-${testToken}`, name: "Local admin test", email: `workflow-admin-${testToken}@atlas.invalid`, emailVerified: true, appRole: "admin", organizationId: org.id, locale: "en" },
      { id: `workflow-warehouse-${testToken}`, name: "Local warehouse test", email: `workflow-warehouse-${testToken}@atlas.invalid`, emailVerified: true, appRole: "warehouse", organizationId: org.id, locale: "en" },
      { id: `workflow-accountant-${testToken}`, name: "Local accountant test", email: `workflow-accountant-${testToken}@atlas.invalid`, emailVerified: true, appRole: "accountant", organizationId: org.id, locale: "en" },
    ]).returning();
    const [adminActor, warehouseActor, accountantActor] = actors;
    const [category] = await db.insert(categories).values({ organizationId: org.id, name: "Workflow test" }).returning();
    const [warehouse] = await db.insert(warehouses).values({ organizationId: org.id, name: "Workflow test", city: "Casablanca" }).returning();
    const [customer] = await db.insert(customers).values({ organizationId: org.id, name: "Workflow test customer", segment: "Retail", city: "Casablanca", paymentTermsDays: 30 }).returning();
    customerId = customer.id;
    const [product] = await db.insert(products).values({
      organizationId: org.id,
      categoryId: category.id,
      sku: `TEST-${testToken.slice(0, 8)}`,
      name: "Workflow test product",
      unitCostMinor: 400,
      unitPriceMinor: 1000,
      reorderPoint: 1,
    }).returning();
    productId = product.id;
    await db.insert(stockLevels).values({ organizationId: org.id, productId: product.id, warehouseId: warehouse.id, quantity: 5, averageUnitCostMinor: 400 });

    const context: ServiceContext = { actorId: adminActor.id, organizationId: org.id, role: "admin" };
    const warehouseContext: ServiceContext = { actorId: warehouseActor.id, organizationId: org.id, role: "warehouse" };
    const accountantContext: ServiceContext = { actorId: accountantActor.id, organizationId: org.id, role: "accountant" };
    const key = () => crypto.randomUUID();
    await expectCode(createDraftOrder(warehouseContext, {
      customerId: customer.id, warehouseId: warehouse.id,
      lines: [{ productId: product.id, quantity: 1 }], idempotencyKey: key(),
    }), "FORBIDDEN");

    const shortStock = await createDraftOrder(context, {
      customerId: customer.id, warehouseId: warehouse.id,
      lines: [{ productId: product.id, quantity: 6 }], idempotencyKey: key(),
    });
    await confirmOrder(context, { orderId: shortStock.resourceId, idempotencyKey: key() });
    await expectCode(shipOrder(warehouseContext, { orderId: shortStock.resourceId, idempotencyKey: key() }), "INSUFFICIENT_STOCK");
    const [unchanged] = await db.select({ quantity: stockLevels.quantity }).from(stockLevels).where(eq(stockLevels.productId, product.id));
    assert.equal(unchanged.quantity, 5, "failed shipment must roll back stock");
    await cancelOrder(context, { orderId: shortStock.resourceId, idempotencyKey: key() });

    const editableDraft = await createDraftOrder(context, {
      customerId: customer.id, warehouseId: warehouse.id,
      lines: [{ productId: product.id, quantity: 1 }], idempotencyKey: key(),
    });
    const editKey = key();
    const editInput = {
      orderId: editableDraft.resourceId,
      customerId: customer.id,
      warehouseId: warehouse.id,
      lines: [{ productId: product.id, quantity: 3 }],
      idempotencyKey: editKey,
    };
    await updateDraftOrder(context, editInput);
    const replayEdit = await updateDraftOrder(context, editInput);
    assert.equal(replayEdit.replayed, true);
    const [editedLine] = await db.select({ quantity: salesOrderLines.quantity }).from(salesOrderLines).where(eq(salesOrderLines.orderId, editableDraft.resourceId));
    assert.equal(editedLine.quantity, 3);
    await confirmOrder(context, { orderId: editableDraft.resourceId, idempotencyKey: key() });
    await expectCode(updateDraftOrder(context, { ...editInput, idempotencyKey: key(), lines: [{ productId: product.id, quantity: 4 }] }), "INVALID_TRANSITION");

    const createKey = key();
    const createInput = { customerId: customer.id, warehouseId: warehouse.id, lines: [{ productId: product.id, quantity: 2 }], idempotencyKey: createKey };
    const draft = await createDraftOrder(context, createInput);
    const replayDraft = await createDraftOrder(context, createInput);
    assert.equal(replayDraft.resourceId, draft.resourceId);
    assert.equal(replayDraft.replayed, true);

    const confirmKey = key();
    await confirmOrder(context, { orderId: draft.resourceId, idempotencyKey: confirmKey });
    const replayConfirm = await confirmOrder(context, { orderId: draft.resourceId, idempotencyKey: confirmKey });
    assert.equal(replayConfirm.replayed, true);

    const shipKey = key();
    const shipResults = await Promise.all([
      shipOrder(warehouseContext, { orderId: draft.resourceId, idempotencyKey: shipKey }),
      shipOrder(warehouseContext, { orderId: draft.resourceId, idempotencyKey: shipKey }),
    ]);
    assert.equal(shipResults.filter((result) => result.replayed).length, 1);
    const [afterShip] = await db.select({ quantity: stockLevels.quantity }).from(stockLevels).where(eq(stockLevels.productId, product.id));
    assert.equal(afterShip.quantity, 3);
    const movements = await db.select().from(stockMovements).where(and(
      eq(stockMovements.organizationId, org.id), eq(stockMovements.referenceId, draft.resourceId),
    ));
    assert.equal(movements.length, 1);
    assert.equal(movements[0].quantity, -2);
    const warehouseOrder = await getSalesOrderDetail({ organizationId: org.id, role: "warehouse", orderId: draft.resourceId });
    assert.ok(warehouseOrder);
    assert.equal(Object.hasOwn(warehouseOrder.lines[0], "unitPriceMinor"), false);
    assert.equal(warehouseOrder.invoice, null);
    const warehouseList = await listSalesOrders({ organizationId: org.id, role: "warehouse" });
    assert.equal(warehouseList[0].totalMinor, null);
    await assert.rejects(listSalesOrders({ organizationId: org.id, role: "viewer" }), /FORBIDDEN/);
    await expectCode(issueInvoice(warehouseContext, { orderId: draft.resourceId, idempotencyKey: key() }), "FORBIDDEN");

    const invoiceKey = key();
    const invoiceResult = await issueInvoice(accountantContext, { orderId: draft.resourceId, idempotencyKey: invoiceKey });
    const replayInvoice = await issueInvoice(accountantContext, { orderId: draft.resourceId, idempotencyKey: invoiceKey });
    assert.equal(replayInvoice.resourceId, invoiceResult.resourceId);
    assert.equal((await db.select().from(invoices).where(eq(invoices.orderId, draft.resourceId))).length, 1);
    const warehouseInvoiceDetail = await getSalesOrderDetail({ organizationId: org.id, role: "warehouse", orderId: draft.resourceId });
    assert.equal(warehouseInvoiceDetail?.invoice, null);
    assert.equal(Object.hasOwn(warehouseInvoiceDetail!.lines[0], "unitPriceMinor"), false);
    const accountantDetail = await getSalesOrderDetail({ organizationId: org.id, role: "accountant", orderId: draft.resourceId });
    assert.ok(accountantDetail?.invoice);
    assert.equal(accountantDetail.invoice.totalMinor, 2000);

    const partialKey = key();
    const partialInput = { orderId: draft.resourceId, idempotencyKey: partialKey, amountMinor: 500, method: "bank_transfer" as const };
    const partialResults = await Promise.all([
      recordPayment(accountantContext, partialInput),
      recordPayment(accountantContext, partialInput),
    ]);
    assert.equal(partialResults.filter((result) => result.replayed).length, 1);
    assert.equal((await db.select().from(payments).where(eq(payments.invoiceId, invoiceResult.resourceId))).length, 1);
    await expectCode(recordPayment(accountantContext, { orderId: draft.resourceId, idempotencyKey: key(), amountMinor: 1501, method: "cash" }), "CONFLICT");
    const settlement = await recordPayment(accountantContext, { orderId: draft.resourceId, idempotencyKey: key(), amountMinor: 1500, method: "cash" });
    assert.ok(settlement.resourceId);
    const [finalOrder] = await db.select({ status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, draft.resourceId));
    const [finalInvoice] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.orderId, draft.resourceId));
    const [finalStock] = await db.select({ quantity: stockLevels.quantity }).from(stockLevels).where(eq(stockLevels.productId, product.id));
    assert.equal(finalOrder.status, "paid");
    assert.equal(finalInvoice.status, "paid");
    assert.equal(finalStock.quantity, 3);
    assert.equal((await db.select().from(auditLogs).where(eq(auditLogs.organizationId, org.id))).length, 15);
    console.info("Order workflow passed: editable drafts, transition guards, atomic stock failure, concurrent idempotency, partial settlement, audit, and final paid state.");
  } finally {
    // Remove only rows belonging to this unique temporary test organization.
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, org.id));
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.organizationId, org.id));
    await db.delete(payments).where(eq(payments.organizationId, org.id));
    await db.delete(invoices).where(eq(invoices.organizationId, org.id));
    await db.delete(stockMovements).where(eq(stockMovements.organizationId, org.id));
    await db.delete(salesOrderLines).where(eq(salesOrderLines.organizationId, org.id));
    await db.delete(salesOrders).where(eq(salesOrders.organizationId, org.id));
    await db.delete(stockLevels).where(eq(stockLevels.organizationId, org.id));
    if (productId) await db.delete(products).where(eq(products.id, productId));
    await db.delete(warehouses).where(eq(warehouses.organizationId, org.id));
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(categories).where(eq(categories.organizationId, org.id));
    await db.delete(users).where(eq(users.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

main().catch((error: unknown) => {
  const safeDetail = error instanceof OrderDomainError
    ? `${error.code}: ${error.message}`
    : error instanceof Error ? `${error.name}: ${error.message}` : "unknown verification error";
  console.error(`Local order workflow verification failed (${safeDetail}). Test-only organization cleanup ran; no credentials are logged.`);
  process.exitCode = 1;
});
