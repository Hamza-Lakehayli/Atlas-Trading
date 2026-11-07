import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { businessDate } from "../src/lib/dates/business-date";
import { getMigrationDatabaseUrl, getServerEnv } from "../src/lib/env";
import { parseQuoteFilters } from "../src/lib/quotes/filters";
import { getDb } from "../src/server/db";
import {
  auditLogs,
  categories,
  customers,
  idempotencyKeys,
  organizations,
  products,
  quoteLines,
  quotes,
  salesOrderLines,
  salesOrders,
  users,
  warehouses,
} from "../src/server/db/schema";
import { getQuoteDetail, listQuotes } from "../src/server/queries/quotes";
import { type ServiceContext } from "../src/server/services/context";
import { acceptQuote, convertAcceptedQuoteToOrder, createDraftQuote, QuoteDomainError, rejectQuote, sendQuote, updateDraftQuote } from "../src/server/services/quotes";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function expectCode(operation: Promise<unknown>, code: QuoteDomainError["code"]) {
  try {
    await operation;
  } catch (error) {
    assert.ok(error instanceof QuoteDomainError);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`Expected ${code} domain error`);
}

async function signedInCookie(origin: string, email: string, password: string) {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `Demo sign-in failed for ${email}`);
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function main() {
  const env = getServerEnv();
  const databaseUrl = getMigrationDatabaseUrl();
  const origin = env.BETTER_AUTH_URL;
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(databaseUrl).hostname)
    || !new Set(["127.0.0.1", "localhost"]).has(new URL(origin).hostname)) {
    throw new Error("Quote verification only runs against the isolated local app and PostgreSQL database.");
  }

  const db = getDb();
  const token = crypto.randomUUID();
  const [organization] = await db.insert(organizations).values({ name: `__local_quote_test_${token}` }).returning();
  try {
    const actorId = `quote-admin-${token}`;
    const warehouseId = `quote-warehouse-${token}`;
    const [admin, warehouseActor] = await db.insert(users).values([
      { id: actorId, name: "Local quote test", email: `quote-admin-${token}@atlas.invalid`, emailVerified: true, appRole: "admin", organizationId: organization.id, locale: "en" },
      { id: warehouseId, name: "Local warehouse test", email: `quote-warehouse-${token}@atlas.invalid`, emailVerified: true, appRole: "warehouse", organizationId: organization.id, locale: "en" },
    ]).returning();
    const [category] = await db.insert(categories).values({ organizationId: organization.id, name: `Quote test ${token}` }).returning();
    const [warehouse] = await db.insert(warehouses).values({ organizationId: organization.id, name: "Quote test warehouse", city: "Casablanca" }).returning();
    const [customer] = await db.insert(customers).values({ organizationId: organization.id, name: "Quote test customer", segment: "Retail", city: "Casablanca" }).returning();
    const productsCreated = await db.insert(products).values([
      { organizationId: organization.id, categoryId: category.id, sku: `QT-A-${token.slice(0, 8)}`, name: "Quoted product A", unitCostMinor: 400, unitPriceMinor: 1000 },
      { organizationId: organization.id, categoryId: category.id, sku: `QT-B-${token.slice(0, 8)}`, name: "Quoted product B", unitCostMinor: 800, unitPriceMinor: 2500 },
    ]).returning();
    const [productA, productB] = productsCreated;
    const context: ServiceContext = { actorId: admin.id, organizationId: organization.id, role: "admin" };
    const warehouseContext: ServiceContext = { actorId: warehouseActor.id, organizationId: organization.id, role: "warehouse" };
    const key = () => crypto.randomUUID();
    const today = businessDate(new Date());
    const future = addDays(today, 14);
    await expectCode(createDraftQuote(warehouseContext, {
      customerId: customer.id, warehouseId: warehouse.id, validUntil: future,
      lines: [{ productId: productA.id, quantity: 1 }], idempotencyKey: key(),
    }), "FORBIDDEN");

    const createInput = {
      customerId: customer.id,
      warehouseId: warehouse.id,
      validUntil: future,
      lines: [{ productId: productA.id, quantity: 2 }, { productId: productB.id, quantity: 1 }],
      idempotencyKey: key(),
    };
    const created = await createDraftQuote(context, createInput);
    const replayCreate = await createDraftQuote(context, createInput);
    assert.equal(replayCreate.resourceId, created.resourceId);
    assert.equal(replayCreate.replayed, true);
    const replayAfterValidity = await createDraftQuote({ ...context, now: () => new Date(`${addDays(today, 20)}T12:00:00Z`) }, createInput);
    assert.equal(replayAfterValidity.resourceId, created.resourceId);
    assert.equal(replayAfterValidity.replayed, true);
    await expectCode(createDraftQuote(context, { ...createInput, lines: [{ productId: productA.id, quantity: 1 }] }), "CONFLICT");

    const editInput = {
      quoteId: created.resourceId,
      customerId: customer.id,
      warehouseId: warehouse.id,
      validUntil: future,
      lines: [{ productId: productA.id, quantity: 3 }, { productId: productB.id, quantity: 1 }],
      idempotencyKey: key(),
    };
    await updateDraftQuote(context, editInput);
    assert.equal((await updateDraftQuote(context, editInput)).replayed, true);
    const beforeIssue = await getQuoteDetail({ organizationId: organization.id, role: "admin", quoteId: created.resourceId });
    assert.ok(beforeIssue);
    assert.equal(beforeIssue.totalMinor, 5500);
    assert.equal(beforeIssue.lines.length, 2);

    const sendInput = { quoteId: created.resourceId, idempotencyKey: key() };
    await sendQuote(context, sendInput);
    assert.equal((await sendQuote(context, sendInput)).replayed, true);
    await expectCode(updateDraftQuote(context, { ...editInput, idempotencyKey: key() }), "INVALID_TRANSITION");
    const acceptInput = { quoteId: created.resourceId, idempotencyKey: key() };
    await acceptQuote(context, acceptInput);
    await expectCode(rejectQuote(context, { quoteId: created.resourceId, idempotencyKey: key() }), "INVALID_TRANSITION");

    await db.update(products).set({ unitPriceMinor: 9_000_000 }).where(eq(products.id, productA.id));
    const convertInput = { quoteId: created.resourceId, idempotencyKey: key() };
    const conversionAfterExpiry: ServiceContext = { ...context, now: () => new Date(`${addDays(today, 20)}T12:00:00Z`) };
    const [converted, duplicateConversion] = await Promise.all([
      convertAcceptedQuoteToOrder(conversionAfterExpiry, convertInput),
      convertAcceptedQuoteToOrder(conversionAfterExpiry, convertInput),
    ]);
    assert.equal(duplicateConversion.resourceId, converted.resourceId);
    assert.equal([converted, duplicateConversion].filter((result) => result.replayed).length, 1);
    const orderLines = await db.select().from(salesOrderLines).where(and(
      eq(salesOrderLines.orderId, converted.resourceId), eq(salesOrderLines.organizationId, organization.id),
    ));
    assert.deepEqual(orderLines.map((line) => line.unitPriceMinor).sort((a, b) => a - b), [1_000, 2_500]);
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, converted.resourceId));
    assert.equal(order.status, "draft");
    assert.equal(order.sourceQuoteId, created.resourceId);
    await expectCode(convertAcceptedQuoteToOrder(context, { quoteId: created.resourceId, idempotencyKey: key() }), "INVALID_TRANSITION");
    const afterConversion = await getQuoteDetail({ organizationId: organization.id, role: "admin", quoteId: created.resourceId });
    assert.equal(afterConversion?.quote.status, "converted");
    assert.equal(afterConversion?.order?.id, converted.resourceId);

    const rejectDraft = await createDraftQuote(context, {
      customerId: customer.id,
      warehouseId: warehouse.id,
      validUntil: future,
      lines: [{ productId: productB.id, quantity: 1 }],
      idempotencyKey: key(),
    });
    await sendQuote(context, { quoteId: rejectDraft.resourceId, idempotencyKey: key() });
    await rejectQuote(context, { quoteId: rejectDraft.resourceId, idempotencyKey: key() });
    const rejected = await getQuoteDetail({ organizationId: organization.id, role: "admin", quoteId: rejectDraft.resourceId });
    assert.equal(rejected?.quote.status, "rejected");

    const unavailableProductQuote = await createDraftQuote(context, {
      customerId: customer.id,
      warehouseId: warehouse.id,
      validUntil: future,
      lines: [{ productId: productB.id, quantity: 1 }],
      idempotencyKey: key(),
    });
    await sendQuote(context, { quoteId: unavailableProductQuote.resourceId, idempotencyKey: key() });
    await acceptQuote(context, { quoteId: unavailableProductQuote.resourceId, idempotencyKey: key() });
    await db.update(products).set({ active: false }).where(eq(products.id, productB.id));
    const failedConversionKey = key();
    await expectCode(convertAcceptedQuoteToOrder(context, { quoteId: unavailableProductQuote.resourceId, idempotencyKey: failedConversionKey }), "CONFLICT");
    const stillAccepted = await getQuoteDetail({ organizationId: organization.id, role: "admin", quoteId: unavailableProductQuote.resourceId });
    assert.equal(stillAccepted?.quote.status, "accepted", "failed conversion must roll back quote status");
    assert.equal((await db.select().from(salesOrders).where(and(eq(salesOrders.organizationId, organization.id), eq(salesOrders.sourceQuoteId, unavailableProductQuote.resourceId)))).length, 0);
    assert.equal((await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, organization.id), eq(auditLogs.entityId, unavailableProductQuote.resourceId), eq(auditLogs.action, "quote.converted")))).length, 0);
    assert.equal((await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, organization.id), eq(idempotencyKeys.key, failedConversionKey)))).length, 0);
    await db.update(products).set({ active: true }).where(eq(products.id, productB.id));

    const expiredDraft = await createDraftQuote(context, {
      customerId: customer.id,
      warehouseId: warehouse.id,
      validUntil: addDays(today, 3),
      lines: [{ productId: productB.id, quantity: 1 }],
      idempotencyKey: key(),
    });
    const expiredContext: ServiceContext = { ...context, now: () => new Date(`${addDays(today, 5)}T12:00:00Z`) };
    await expectCode(sendQuote(expiredContext, { quoteId: expiredDraft.resourceId, idempotencyKey: key() }), "INVALID_TRANSITION");
    const notSent = await getQuoteDetail({ organizationId: organization.id, role: "admin", quoteId: expiredDraft.resourceId });
    assert.equal(notSent?.quote.status, "draft", "failed expired send must roll back the quote state");

    const parsedFilters = parseQuoteFilters({ status: "converted", page: "1" });
    assert.ok(parsedFilters.success);
    const convertedPage = await listQuotes({ organizationId: organization.id, role: "admin", filters: parsedFilters.data });
    assert.equal(convertedPage.total, 1);
    const accountantPage = await listQuotes({ organizationId: organization.id, role: "accountant", filters: parsedFilters.data });
    assert.equal(accountantPage.total, 1);
    await assert.rejects(getQuoteDetail({ organizationId: organization.id, role: "warehouse", quoteId: created.resourceId }), /FORBIDDEN/);
    await assert.rejects(listQuotes({ organizationId: organization.id, role: "warehouse", filters: parsedFilters.data }), /FORBIDDEN/);
    const foreign = await listQuotes({ organizationId: crypto.randomUUID(), role: "admin", filters: parsedFilters.data });
    assert.equal(foreign.total, 0);
    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, organization.id));
    assert.ok(auditRows.some((row) => row.action === "quote.converted"));
    assert.ok(auditRows.some((row) => row.action === "order.created_from_quote"));
    assert.equal(await getQuoteDetail({ organizationId: crypto.randomUUID(), role: "admin", quoteId: created.resourceId }), null);
    console.info("Quote PostgreSQL workflow passed: draft edits, validity, immutable prices, send/accept/reject, idempotent conversion, permissions, audit, and organization scope.");

    const salesCookie = await signedInCookie(origin, "sales@atlas.demo", env.DEMO_PASSWORD);
    const listing = await fetch(`${origin}/en/sales/quotes`, { headers: { Cookie: salesCookie } });
    assert.equal(listing.status, 200);
    assert.match(await listing.text(), /Sales quotes/);
    const malformedFilters = await fetch(`${origin}/en/sales/quotes?status=unknown`, { headers: { Cookie: salesCookie } });
    assert.equal(malformedFilters.status, 200);
    assert.match(await malformedFilters.text(), /These quote filters aren.t valid/);
    const french = await fetch(`${origin}/fr/sales/quotes`, { headers: { Cookie: salesCookie } });
    assert.equal(french.status, 200);
    assert.match(await french.text(), /Devis commerciaux/);
    const warehouseCookie = await signedInCookie(origin, "warehouse@atlas.demo", env.DEMO_PASSWORD);
    const forbidden = await fetch(`${origin}/en/sales/quotes`, { headers: { Cookie: warehouseCookie } });
    assert.equal(forbidden.status, 404);
    console.info("Quote browser routes passed: list, malformed-filter handling, French locale, and warehouse access denial.");
  } finally {
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, organization.id));
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.organizationId, organization.id));
    await db.delete(salesOrderLines).where(eq(salesOrderLines.organizationId, organization.id));
    await db.delete(salesOrders).where(eq(salesOrders.organizationId, organization.id));
    await db.delete(quoteLines).where(eq(quoteLines.organizationId, organization.id));
    await db.delete(quotes).where(eq(quotes.organizationId, organization.id));
    await db.delete(products).where(eq(products.organizationId, organization.id));
    await db.delete(warehouses).where(eq(warehouses.organizationId, organization.id));
    await db.delete(customers).where(eq(customers.organizationId, organization.id));
    await db.delete(categories).where(eq(categories.organizationId, organization.id));
    await db.delete(users).where(eq(users.organizationId, organization.id));
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  }

  const [seedOrganization] = await db.select().from(organizations).where(eq(organizations.name, "Atlas Trading Co.")).limit(1);
  const [salesUser] = await db.select().from(users).where(eq(users.email, "sales@atlas.demo")).limit(1);
  const [seedCustomer] = seedOrganization
    ? await db.select().from(customers).where(eq(customers.organizationId, seedOrganization.id)).limit(1)
    : [];
  const [seedWarehouse] = seedOrganization
    ? await db.select().from(warehouses).where(eq(warehouses.organizationId, seedOrganization.id)).limit(1)
    : [];
  const [seedProduct] = seedOrganization
    ? await db.select().from(products).where(and(eq(products.organizationId, seedOrganization.id), eq(products.active, true))).limit(1)
    : [];
  assert.ok(seedOrganization && salesUser && seedCustomer && seedWarehouse && seedProduct, "Seed local demo records before browser quote verification");
  const browserIdempotencyKey = crypto.randomUUID();
  const browserQuote = await createDraftQuote({ actorId: salesUser.id, organizationId: seedOrganization.id, role: "sales_manager" }, {
    customerId: seedCustomer.id,
    warehouseId: seedWarehouse.id,
    validUntil: addDays(businessDate(new Date()), 30),
    lines: [{ productId: seedProduct.id, quantity: 1 }],
    idempotencyKey: browserIdempotencyKey,
  });
  let browserOrderId: string | undefined;
  try {
    const salesCookie = await signedInCookie(origin, "sales@atlas.demo", env.DEMO_PASSWORD);
    const englishDetail = await fetch(`${origin}/en/sales/quotes/${browserQuote.resourceId}?q=Altenwerth&status=draft&page=2&error=CONFLICT`, { headers: { Cookie: salesCookie } });
    assert.equal(englishDetail.status, 200);
    const englishHtml = await englishDetail.text();
    assert.match(englishHtml, /QUOTE RECORD/);
    assert.match(englishHtml, /Send quote/);
    assert.match(englishHtml, /Quote lines/);
    assert.match(englishHtml, /href="\/en\/sales\/quotes\?q=Altenwerth&amp;status=draft&amp;page=2"/);
    const frenchDetail = await fetch(`${origin}/fr/sales/quotes/${browserQuote.resourceId}`, { headers: { Cookie: salesCookie } });
    assert.equal(frenchDetail.status, 200);
    assert.match(await frenchDetail.text(), /FICHE DE DEVIS/);
    const accountantCookie = await signedInCookie(origin, "finance@atlas.demo", env.DEMO_PASSWORD);
    const accountantDetail = await fetch(`${origin}/en/sales/quotes/${browserQuote.resourceId}`, { headers: { Cookie: accountantCookie } });
    assert.equal(accountantDetail.status, 200);
    const accountantHtml = await accountantDetail.text();
    assert.match(accountantHtml, /Quote lines/);
    assert.doesNotMatch(accountantHtml, /class="quote-edit-panel"|class="quote-action-form"/);
    const browserContext: ServiceContext = { actorId: salesUser.id, organizationId: seedOrganization.id, role: "sales_manager" };
    await sendQuote(browserContext, { quoteId: browserQuote.resourceId, idempotencyKey: crypto.randomUUID() });
    await acceptQuote(browserContext, { quoteId: browserQuote.resourceId, idempotencyKey: crypto.randomUUID() });
    const browserOrder = await convertAcceptedQuoteToOrder(browserContext, { quoteId: browserQuote.resourceId, idempotencyKey: crypto.randomUUID() });
    browserOrderId = browserOrder.resourceId;
    const orderDetail = await fetch(`${origin}/en/sales/orders/${browserOrderId}`, { headers: { Cookie: salesCookie } });
    assert.equal(orderDetail.status, 200);
    const orderHtml = await orderDetail.text();
    assert.match(orderHtml, /Order lines/);
    assert.match(orderHtml, /Awesome Chair/);
    console.info("Quote browser detail passed: draft, FR/EN direct routes, lifecycle actions, and converted order detail.");
  } finally {
    const resourceIds = browserOrderId ? [browserQuote.resourceId, browserOrderId] : [browserQuote.resourceId];
    await db.delete(auditLogs).where(and(eq(auditLogs.organizationId, seedOrganization.id), inArray(auditLogs.entityId, resourceIds)));
    await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, seedOrganization.id), inArray(idempotencyKeys.resourceId, resourceIds)));
    if (browserOrderId) {
      await db.delete(salesOrderLines).where(and(eq(salesOrderLines.organizationId, seedOrganization.id), eq(salesOrderLines.orderId, browserOrderId)));
      await db.delete(salesOrders).where(and(eq(salesOrders.id, browserOrderId), eq(salesOrders.organizationId, seedOrganization.id)));
    }
    await db.delete(quoteLines).where(and(eq(quoteLines.quoteId, browserQuote.resourceId), eq(quoteLines.organizationId, seedOrganization.id)));
    await db.delete(quotes).where(and(eq(quotes.id, browserQuote.resourceId), eq(quotes.organizationId, seedOrganization.id)));
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof QuoteDomainError
    ? `${error.code}: ${error.message}`
    : error instanceof Error ? `${error.name}: ${error.message}` : "unknown verification error";
  console.error(`Quote verification failed (${detail}). Test-only organization cleanup ran; no credentials are logged.`);
  process.exitCode = 1;
});
