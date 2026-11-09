import assert from "node:assert/strict";
import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { addCalendarDays, businessDate, businessDateStart } from "../src/lib/dates/business-date";
import { getMigrationDatabaseUrl, getServerEnv } from "../src/lib/env";
import { parseInvoiceFilters } from "../src/lib/invoices/filters";
import { parseDashboardFilters } from "../src/lib/dashboard/filters";
import { getDb, getPool } from "../src/server/db";
import {
  auditLogs,
  categories,
  customers,
  idempotencyKeys,
  invoices,
  organizations,
  payments,
  products,
  salesOrderLines,
  salesOrders,
  stockLevels,
  stockMovements,
  users,
  warehouses,
} from "../src/server/db/schema";
import { getInvoiceDetail, listInvoices } from "../src/server/queries/invoices";
import { getCategoryRevenue, getConfirmedOrderTrend, getQuoteFunnel, getReceivablesAging, getReceivablesTrend, getRevenueTrend, getTopRevenue } from "../src/server/queries/dashboard";
import { type ServiceContext } from "../src/server/services/context";
import { OrderDomainError, confirmOrder, createDraftOrder, issueInvoice, recordPayment, shipOrder } from "../src/server/services/orders";

function addDays(date: string, days: number) {
  return addCalendarDays(date, days);
}

function atBusinessNoon(date: string) {
  return new Date(businessDateStart(date).getTime() + 12 * 60 * 60 * 1000);
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

async function signedInCookie(origin: string, email: string, password: string) {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `Demo sign-in failed for ${email}`);
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function signOut(origin: string, cookie: string) {
  const response = await fetch(`${origin}/api/auth/sign-out`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 200);
}

async function main() {
  const env = getServerEnv();
  const migrationUrl = getMigrationDatabaseUrl();
  const origin = env.BETTER_AUTH_URL;
  if (!new Set(["127.0.0.1", "localhost"]).has(new URL(migrationUrl).hostname)
    || !new Set(["127.0.0.1", "localhost"]).has(new URL(origin).hostname)) {
    throw new Error("Invoice verification only runs against the isolated local app and PostgreSQL database.");
  }

  const db = getDb();
  const token = crypto.randomUUID();
  const [organization] = await db.insert(organizations).values({ name: `__local_invoice_test_${token}` }).returning();
  try {
    const [admin, warehouseActor, accountant] = await db.insert(users).values([
      { id: `invoice-admin-${token}`, name: "Local invoice admin", email: `invoice-admin-${token}@atlas.invalid`, emailVerified: true, appRole: "admin", organizationId: organization.id, locale: "en" },
      { id: `invoice-warehouse-${token}`, name: "Local invoice warehouse", email: `invoice-warehouse-${token}@atlas.invalid`, emailVerified: true, appRole: "warehouse", organizationId: organization.id, locale: "en" },
      { id: `invoice-accountant-${token}`, name: "Local invoice accountant", email: `invoice-accountant-${token}@atlas.invalid`, emailVerified: true, appRole: "accountant", organizationId: organization.id, locale: "en" },
    ]).returning();
    const [category] = await db.insert(categories).values({ organizationId: organization.id, name: `Invoice test ${token}` }).returning();
    const [otherCategory] = await db.insert(categories).values({ organizationId: organization.id, name: `Invoice other category ${token}` }).returning();
    const [warehouse] = await db.insert(warehouses).values({ organizationId: organization.id, name: `Invoice warehouse ${token}`, city: "Casablanca" }).returning();
    const [customer] = await db.insert(customers).values({ organizationId: organization.id, name: "Invoice test customer", segment: "Retail", city: "Casablanca", paymentTermsDays: 30 }).returning();
    const [product] = await db.insert(products).values({
      organizationId: organization.id,
      categoryId: category.id,
      sku: `INV-${token.slice(0, 8)}`,
      name: "Invoice test product",
      unitCostMinor: 4_000,
      unitPriceMinor: 10_000,
      active: true,
    }).returning();
    const [otherCategoryProduct] = await db.insert(products).values({
      organizationId: organization.id,
      categoryId: otherCategory.id,
      sku: `INV2-${token.slice(0, 8)}`,
      name: "Invoice other category product",
      unitCostMinor: 2_000,
      unitPriceMinor: 6_000,
      active: true,
    }).returning();
    await db.insert(stockLevels).values({ organizationId: organization.id, productId: product.id, warehouseId: warehouse.id, quantity: 20, averageUnitCostMinor: 4_000 });
    await db.insert(stockLevels).values({ organizationId: organization.id, productId: otherCategoryProduct.id, warehouseId: warehouse.id, quantity: 20, averageUnitCostMinor: 2_000 });

    let clock = atBusinessNoon(addDays(businessDate(), -70));
    const context = (user: typeof admin, role: ServiceContext["role"]): ServiceContext => ({
      actorId: user.id,
      organizationId: organization.id,
      role,
      now: () => new Date(clock),
    });
    const adminContext = context(admin, "admin");
    const warehouseContext = context(warehouseActor, "warehouse");
    const accountantContext = context(accountant, "accountant");
    const noFilters = parseInvoiceFilters({});
    assert.ok(noFilters.success);
    await assert.rejects(listInvoices({ organizationId: organization.id, role: "warehouse", filters: noFilters.data }), /FORBIDDEN/);

    const draft = await createDraftOrder(adminContext, {
      customerId: customer.id,
      warehouseId: warehouse.id,
      lines: [{ productId: product.id, quantity: 2 }, { productId: otherCategoryProduct.id, quantity: 1 }],
      idempotencyKey: crypto.randomUUID(),
    });
    clock = atBusinessNoon(addDays(businessDate(clock), 1));
    await confirmOrder(adminContext, { orderId: draft.resourceId, idempotencyKey: crypto.randomUUID() });
    clock = atBusinessNoon(addDays(businessDate(clock), 1));
    await shipOrder(warehouseContext, { orderId: draft.resourceId, idempotencyKey: crypto.randomUUID() });
    const issuedDate = businessDate(clock);
    const issued = await issueInvoice(accountantContext, { orderId: draft.resourceId, idempotencyKey: crypto.randomUUID() });

    clock = atBusinessNoon(addDays(issuedDate, 35));
    await recordPayment(accountantContext, { orderId: draft.resourceId, idempotencyKey: crypto.randomUUID(), amountMinor: 5_000, method: "bank_transfer" });
    clock = atBusinessNoon(addDays(issuedDate, 65));
    await recordPayment(accountantContext, { orderId: draft.resourceId, idempotencyKey: crypto.randomUUID(), amountMinor: 5_000, method: "cash" });
    clock = atBusinessNoon(addDays(issuedDate, 75));
    await recordPayment(accountantContext, { orderId: draft.resourceId, idempotencyKey: crypto.randomUUID(), amountMinor: 16_000, method: "check" });

    const overdueFilters = parseInvoiceFilters({
      status: "overdue", aging: "1-30", from: issuedDate, to: issuedDate, asOf: addDays(issuedDate, 40),
      warehouseId: warehouse.id, categoryId: category.id, customerId: customer.id, productId: product.id, segment: "Retail",
      sort: "dueDate", direction: "asc",
    });
    assert.ok(overdueFilters.success);
    const earlySnapshot = await listInvoices({ organizationId: organization.id, role: "accountant", filters: overdueFilters.data });
    assert.equal(earlySnapshot.total, 1);
    assert.equal(earlySnapshot.rows[0].totalMinor, 26_000, "Invoice list keeps the complete issued amount");
    assert.equal(earlySnapshot.rows[0].matchingLineRevenueMinor, 20_000, "Category/product filter exposes only matching invoice lines");
    assert.equal(earlySnapshot.matchingLineRevenueMinor, 20_000, "Filtered line subtotal reconciles independently of pagination");
    assert.equal(earlySnapshot.rows[0].paidMinor, 5_000);
    assert.equal(earlySnapshot.rows[0].outstandingMinor, 21_000, "Receivable remains the full invoice balance, not the matching-line subtotal");
    assert.equal(earlySnapshot.rows[0].status, "partial");
    assert.equal(earlySnapshot.rows[0].agingBucket, "1-30");
    const earlyDetail = await getInvoiceDetail({ organizationId: organization.id, role: "accountant", invoiceId: issued.resourceId, asOf: addDays(issuedDate, 40) });
    assert.ok(earlyDetail);
    assert.equal(earlyDetail.payments.length, 1);
    assert.equal(earlyDetail.paidMinor, 5_000);
    assert.equal(earlyDetail.outstandingMinor, 21_000);

    const analyticsFilters = parseDashboardFilters({
      from: addDays(issuedDate, -2), to: addDays(issuedDate, 40), compare: "none",
      warehouseId: warehouse.id, categoryId: category.id, segment: "Retail", granularity: "daily",
    });
    assert.ok(analyticsFilters.success);
    const analyticsContext = { organizationId: organization.id, role: "accountant" as const, filters: analyticsFilters.data };
    const [revenueTrend, orderTrend, categoryRevenue, topRevenue, quoteFunnel, aging, receivablesTrend] = await Promise.all([
      getRevenueTrend(analyticsContext),
      getConfirmedOrderTrend(analyticsContext),
      getCategoryRevenue(analyticsContext),
      getTopRevenue(analyticsContext),
      getQuoteFunnel(analyticsContext),
      getReceivablesAging(analyticsContext),
      getReceivablesTrend(analyticsContext),
    ]);
    assert.equal(revenueTrend.current.reduce((sum, row) => sum + row.revenueMinor, 0), 20_000);
    assert.equal(revenueTrend.current.reduce((sum, row) => sum + row.cogsMinor, 0), 8_000);
    assert.equal(orderTrend.current.reduce((sum, row) => sum + row.count, 0), 1);
    assert.equal(categoryRevenue.reduce((sum, row) => sum + row.revenueMinor, 0), 20_000);
    assert.equal(topRevenue.customers[0]?.revenueMinor, 20_000);
    assert.equal(topRevenue.products[0]?.revenueMinor, 20_000);
    assert.deepEqual(quoteFunnel.stages.map((stage) => stage.count), [0, 0, 0, 0, 0, 0]);
    assert.equal(aging.rows.find((row) => row.key === "1-30")?.balanceMinor, 21_000);
    assert.equal(receivablesTrend[0]?.balanceMinor, 0);
    assert.equal(receivablesTrend.at(-1)?.balanceMinor, 21_000);
    assert.ok(receivablesTrend.some((row) => row.balanceMinor === 26_000));

    const rankingAmounts = [900, 1_000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 90, 80, 70, 60, 50, 40, 30, 20, 19, 18, 17, 16, 15, 14, 13];
    const rankingCustomers = await db.insert(customers).values(rankingAmounts.map((_, index) => ({
      organizationId: organization.id,
      name: `Dashboard ranking customer ${String(index).padStart(2, "0")}`,
      segment: "Retail" as const,
      city: "Casablanca",
      paymentTermsDays: 30,
    }))).returning();
    const rankingProducts = await db.insert(products).values(rankingAmounts.map((amount, index) => ({
      organizationId: organization.id,
      categoryId: category.id,
      sku: `DASH-RANK-${String(index).padStart(2, "0")}-${token.slice(0, 5)}`,
      name: `Dashboard ranking product ${String(index).padStart(2, "0")}`,
      unitCostMinor: 100,
      unitPriceMinor: amount,
      active: true,
    }))).returning();
    const rankingDate = atBusinessNoon(issuedDate);
    const rankingOrders = await db.insert(salesOrders).values(rankingAmounts.map((_, index) => ({
      organizationId: organization.id,
      orderNumber: `DASH-RANK-${token.slice(0, 5)}-${String(index).padStart(2, "0")}`,
      customerId: rankingCustomers[index].id,
      warehouseId: warehouse.id,
      status: "invoiced",
      orderDate: rankingDate,
      createdBy: admin.id,
      confirmedAt: rankingDate,
      shippedAt: rankingDate,
      invoicedAt: rankingDate,
    }))).returning();
    await db.insert(salesOrderLines).values(rankingAmounts.map((amount, index) => ({
      organizationId: organization.id,
      orderId: rankingOrders[index].id,
      productId: rankingProducts[index].id,
      quantity: 1,
      unitPriceMinor: amount,
      unitCostAtSaleMinor: 100,
    })));
    await db.insert(invoices).values(rankingAmounts.map((amount, index) => ({
      organizationId: organization.id,
      orderId: rankingOrders[index].id,
      number: `DASH-RANK-${token.slice(0, 5)}-${String(index).padStart(2, "0")}`,
      issuedAt: rankingDate,
      dueDate: atBusinessNoon(addDays(issuedDate, 30)),
      status: "unpaid",
      totalMinor: amount,
      cogsMinor: 100,
    })));
    const rankedTotals = await getTopRevenue(analyticsContext);
    assert.equal(rankedTotals.customers.length, 10);
    assert.deepEqual(rankedTotals.customers.slice(1, 5).map((row) => row.revenueMinor), [1_000, 900, 900, 800]);
    assert.equal(rankedTotals.customers[1]?.name, "Dashboard ranking customer 01");
    assert.equal(rankedTotals.customers[2]?.name, "Dashboard ranking customer 00", "Customer revenue ties sort deterministically by name");
    assert.equal(rankedTotals.customers[3]?.name, "Dashboard ranking customer 02");
    assert.equal(rankedTotals.products.length, 10);
    assert.deepEqual(rankedTotals.products.slice(1, 5).map((row) => row.revenueMinor), [1_000, 900, 900, 800]);
    assert.match(rankedTotals.products[1]?.sku ?? "", /DASH-RANK-01/);
    assert.match(rankedTotals.products[2]?.sku ?? "", /DASH-RANK-00/);
    assert.match(rankedTotals.products[3]?.sku ?? "", /DASH-RANK-02/);
    const unscopedDashboardFilters = parseDashboardFilters({
      from: analyticsFilters.data.from, to: analyticsFilters.data.to, compare: "none",
      warehouseId: "all", categoryId: "all", segment: "all", granularity: "daily",
    });
    assert.ok(unscopedDashboardFilters.success);
    const foreignTop = await getTopRevenue({ organizationId: crypto.randomUUID(), role: "admin", filters: unscopedDashboardFilters.data });
    assert.equal(foreignTop.customers.length, 0);
    assert.equal(foreignTop.products.length, 0);
    const lineSummaryFilters = parseInvoiceFilters({
      from: issuedDate, to: issuedDate, asOf: issuedDate, categoryId: category.id, page: "1",
    });
    assert.ok(lineSummaryFilters.success);
    const lineSummaryPage = await listInvoices({ organizationId: organization.id, role: "accountant", filters: lineSummaryFilters.data });
    assert.equal(lineSummaryPage.total, rankingAmounts.length + 1);
    assert.equal(lineSummaryPage.totalPages, 2);
    assert.equal(lineSummaryPage.matchingLineRevenueMinor, 20_000 + rankingAmounts.reduce((sum, amount) => sum + amount, 0), "Matching-line revenue covers every filtered invoice, not only the current page");
    const perInvoiceLineFilters = parseInvoiceFilters({
      from: issuedDate, to: issuedDate, asOf: issuedDate, categoryId: category.id, customerId: customer.id,
    });
    assert.ok(perInvoiceLineFilters.success);
    const perInvoiceLinePage = await listInvoices({ organizationId: organization.id, role: "accountant", filters: perInvoiceLineFilters.data });
    assert.equal(perInvoiceLinePage.total, 1);
    assert.equal(perInvoiceLinePage.rows[0]?.totalMinor, 26_000);
    assert.equal(perInvoiceLinePage.rows[0]?.matchingLineRevenueMinor, 20_000, "Per-invoice matching-line revenue excludes lines outside the selected category");
    await assert.rejects(getRevenueTrend({ ...analyticsContext, role: "warehouse" }), /FORBIDDEN/);

    const laterFilters = parseInvoiceFilters({ status: "overdue", aging: "31-60", asOf: addDays(issuedDate, 70), customerId: customer.id });
    assert.ok(laterFilters.success);
    const laterSnapshot = await listInvoices({ organizationId: organization.id, role: "accountant", filters: laterFilters.data });
    assert.equal(laterSnapshot.total, 1);
    assert.equal(laterSnapshot.rows[0].paidMinor, 10_000);
    assert.equal(laterSnapshot.rows[0].outstandingMinor, 16_000);
    assert.equal(laterSnapshot.rows[0].agingBucket, "31-60");

    const settledFilters = parseInvoiceFilters({ status: "paid", asOf: addDays(issuedDate, 80), customerId: customer.id });
    assert.ok(settledFilters.success);
    const settled = await listInvoices({ organizationId: organization.id, role: "accountant", filters: settledFilters.data });
    assert.equal(settled.total, 1);
    assert.equal(settled.rows[0].outstandingMinor, 0);
    assert.equal(settled.rows[0].status, "paid");

    const foreign = await listInvoices({ organizationId: crypto.randomUUID(), role: "accountant", filters: settledFilters.data });
    assert.equal(foreign.total, 0);
    assert.equal(await getInvoiceDetail({ organizationId: crypto.randomUUID(), role: "accountant", invoiceId: issued.resourceId }), null);
    await assert.rejects(getInvoiceDetail({ organizationId: organization.id, role: "viewer", invoiceId: issued.resourceId }), /FORBIDDEN/);
    await expectCode(recordPayment(accountantContext, { orderId: draft.resourceId, idempotencyKey: crypto.randomUUID(), amountMinor: 1, method: "cash" }), "INVALID_TRANSITION");
    console.info("Invoice and dashboard PostgreSQL checks passed: as-of balances, aging, filter reconciliation, KPI/chart totals, and finance permission enforcement.");
  } finally {
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, organization.id));
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.organizationId, organization.id));
    await db.delete(payments).where(eq(payments.organizationId, organization.id));
    await db.delete(invoices).where(eq(invoices.organizationId, organization.id));
    await db.delete(stockMovements).where(eq(stockMovements.organizationId, organization.id));
    await db.delete(salesOrderLines).where(eq(salesOrderLines.organizationId, organization.id));
    await db.delete(salesOrders).where(eq(salesOrders.organizationId, organization.id));
    await db.delete(stockLevels).where(eq(stockLevels.organizationId, organization.id));
    await db.delete(products).where(eq(products.organizationId, organization.id));
    await db.delete(warehouses).where(eq(warehouses.organizationId, organization.id));
    await db.delete(customers).where(eq(customers.organizationId, organization.id));
    await db.delete(categories).where(eq(categories.organizationId, organization.id));
    await db.delete(users).where(eq(users.organizationId, organization.id));
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  }

  const [demoOrganization] = await db.select().from(organizations).where(eq(organizations.name, "Atlas Trading Co.")).limit(1);
  const [demoAdmin] = await db.select().from(users).where(eq(users.email, "admin@atlas.demo")).limit(1);
  const [demoAccountant] = await db.select().from(users).where(eq(users.email, "finance@atlas.demo")).limit(1);
  const [demoWarehouse] = demoOrganization
    ? await db.select().from(warehouses).where(eq(warehouses.organizationId, demoOrganization.id)).limit(1)
    : [];
  const [demoCustomer] = demoOrganization
    ? await db.select().from(customers).where(eq(customers.organizationId, demoOrganization.id)).limit(1)
    : [];
  const [availableStock] = demoOrganization
    ? await db.select({ level: stockLevels, product: products }).from(stockLevels)
      .innerJoin(products, and(eq(products.id, stockLevels.productId), eq(products.organizationId, stockLevels.organizationId)))
      .where(and(eq(stockLevels.organizationId, demoOrganization.id), ...(demoWarehouse ? [eq(stockLevels.warehouseId, demoWarehouse.id)] : []), eq(products.active, true), gt(stockLevels.quantity, 50)))
      .orderBy(desc(stockLevels.quantity), asc(products.sku)).limit(1)
    : [];
  assert.ok(demoOrganization && demoAdmin && demoAccountant && demoWarehouse && demoCustomer && availableStock, "Seed the local demo before browser invoice verification");
  assert.equal(demoAdmin.organizationId, demoOrganization.id, "Demo admin and organization lookup must identify the same tenant");
  assert.equal(demoAccountant.organizationId, demoOrganization.id, "Demo accountant and organization lookup must identify the same tenant");
  const demoContext: ServiceContext = { actorId: demoAdmin.id, organizationId: demoOrganization.id, role: "admin" };
  const initialQuantity = availableStock.level.quantity;
  const initialCost = availableStock.level.averageUnitCostMinor;
  const order = await createDraftOrder(demoContext, {
    customerId: demoCustomer.id,
    warehouseId: demoWarehouse.id,
    lines: [{ productId: availableStock.product.id, quantity: 1 }],
    idempotencyKey: crypto.randomUUID(),
  });
  let invoiceId: string | undefined;
  let adminCookie: string | undefined;
  let accountantCookie: string | undefined;
  let warehouseCookie: string | undefined;
  let viewerCookie: string | undefined;
  try {
    await confirmOrder(demoContext, { orderId: order.resourceId, idempotencyKey: crypto.randomUUID() });
    await shipOrder(demoContext, { orderId: order.resourceId, idempotencyKey: crypto.randomUUID() });
    const issued = await issueInvoice(demoContext, { orderId: order.resourceId, idempotencyKey: crypto.randomUUID() });
    invoiceId = issued.resourceId;
    assert.ok(await getInvoiceDetail({ organizationId: demoOrganization.id, role: "admin", invoiceId }), "New invoice should be visible to its creating organization");
    adminCookie = await signedInCookie(origin, "admin@atlas.demo", env.DEMO_PASSWORD);
    const sessionResponse = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: adminCookie } });
    const sessionData = await sessionResponse.json() as { user?: { id?: string; organizationId?: string; appRole?: string } };
    assert.equal(sessionData.user?.organizationId, demoOrganization.id, "Signed-in admin session must match the fixture organization");
    const list = await fetch(`${origin}/en/sales/invoices`, { headers: { Cookie: adminCookie } });
    assert.equal(list.status, 200, "English invoice list response");
    const listHtml = await list.text();
    assert.match(listHtml, /Sales invoices/);
    const demoToday = businessDate();
    const lineFilteredList = await fetch(`${origin}/en/sales/invoices?from=${demoToday}&to=${demoToday}&categoryId=${availableStock.product.categoryId}`, { headers: { Cookie: adminCookie } });
    assert.equal(lineFilteredList.status, 200, "Category-filtered invoice ledger response");
    const lineFilteredHtml = await lineFilteredList.text();
    assert.match(lineFilteredHtml, /Matching line revenue/);
    assert.match(lineFilteredHtml, /Row totals remain full invoice amounts/);
    const emptyInvoiceControls = new URLSearchParams({ q: "Atlas", status: "all", from: "", to: "", asOf: "", warehouseId: "", categoryId: "", customerId: "", productId: "", segment: "", sort: "issuedAt", direction: "desc", page: "1" });
    const invoiceFormSubmit = await fetch(`${origin}/en/sales/invoices?${emptyInvoiceControls}`, { headers: { Cookie: adminCookie } });
    assert.equal(invoiceFormSubmit.status, 200, "Native invoice GET filters accept blank optional controls");
    assert.doesNotMatch(await invoiceFormSubmit.text(), /class="customer-filter-error"/);
    const emptyOrderControls = new URLSearchParams({ q: "Atlas", status: "all", dateBasis: "orderDate", from: "", to: "", customerId: "", warehouseId: "", categoryId: "", segment: "", sort: "orderDate", direction: "desc", page: "1" });
    const orderFormSubmit = await fetch(`${origin}/en/sales/orders?${emptyOrderControls}`, { headers: { Cookie: adminCookie } });
    assert.equal(orderFormSubmit.status, 200, "Native order GET filters accept blank optional controls");
    assert.doesNotMatch(await orderFormSubmit.text(), /class="customer-filter-error"/);
    const detail = await fetch(`${origin}/en/sales/invoices/${invoiceId}`, { headers: { Cookie: adminCookie } });
    const detailHtml = await detail.text();
    assert.equal(detail.status, 200, `English invoice detail response: ${detailHtml.slice(0, 500)}`);
    assert.match(detailHtml, /Invoice lines/);
    const french = await fetch(`${origin}/fr/sales/invoices/${invoiceId}`, { headers: { Cookie: adminCookie } });
    assert.equal(french.status, 200, "French invoice detail response");
    assert.match(await french.text(), /Lignes de facture/);
    const dashboard = await fetch(`${origin}/en/dashboard`, { headers: { Cookie: adminCookie } });
    assert.equal(dashboard.status, 200, "Executive dashboard response");
    const dashboardHtml = await dashboard.text();
    for (const heading of ["Revenue over time", "Revenue by category", "Top customers and products", "Quote-to-payment funnel", "Receivables aging"]) {
      assert.ok(dashboardHtml.includes(heading), `Dashboard should render ${heading}`);
    }
    assert.match(dashboardHtml, /sales\/invoices\?[^" ]*customerId=/, "Top Customers must drill down using customerId");
    assert.match(dashboardHtml, /funnelStage=sent/);
    assert.match(dashboardHtml, /funnelStage=paid/);
    const dashboardToday = businessDate();
    const filteredDashboard = await fetch(`${origin}/en/dashboard?from=${addDays(dashboardToday, -30)}&to=${dashboardToday}&segment=Retail&granularity=monthly`, { headers: { Cookie: adminCookie } });
    assert.equal(filteredDashboard.status, 200, "URL-filtered dashboard response");
    assert.match(await filteredDashboard.text(), /Wholesale|Retail/);
    const invalidDashboard = await fetch(`${origin}/en/dashboard?from=2026-12-01&to=2026-01-01`, { headers: { Cookie: adminCookie } });
    assert.equal(invalidDashboard.status, 200, "Invalid dashboard filters should render a recoverable error");
    assert.match(await invalidDashboard.text(), /Dashboard filters are invalid/);
    accountantCookie = await signedInCookie(origin, "finance@atlas.demo", env.DEMO_PASSWORD);
    const accountantDetail = await fetch(`${origin}/en/sales/invoices/${invoiceId}`, { headers: { Cookie: accountantCookie } });
    assert.equal(accountantDetail.status, 200, "Accountant invoice detail response");
    assert.match(await accountantDetail.text(), /Invoice lines/);
    warehouseCookie = await signedInCookie(origin, "warehouse@atlas.demo", env.DEMO_PASSWORD);
    const warehousePage = await fetch(`${origin}/en/sales/invoices`, { headers: { Cookie: warehouseCookie } });
    assert.equal(warehousePage.status, 404, "Warehouse invoice list should remain inaccessible");
    const warehouseDashboard = await fetch(`${origin}/en/dashboard`, { headers: { Cookie: warehouseCookie } });
    assert.equal(warehouseDashboard.status, 200, "Warehouse dashboard should remain available");
    const warehouseDashboardHtml = await warehouseDashboard.text();
    assert.match(warehouseDashboardHtml, /Financial metrics and charts are hidden for this role/);
    assert.doesNotMatch(warehouseDashboardHtml, /class="dashboard-chart-grid"|aria-labelledby="revenue-trend-title"|aria-labelledby="ar-aging-title"/);
    viewerCookie = await signedInCookie(origin, "viewer@atlas.demo", env.DEMO_PASSWORD);
    const viewerDashboard = await fetch(`${origin}/en/dashboard`, { headers: { Cookie: viewerCookie } });
    assert.equal(viewerDashboard.status, 200, "Read-only dashboard role should see its permitted summaries");
    const viewerDashboardHtml = await viewerDashboard.text();
    assert.match(viewerDashboardHtml, /Revenue over time/);
    assert.doesNotMatch(viewerDashboardHtml, /aria-labelledby="(ar-aging-title|quote-funnel-title)"|class="(aging-bars|funnel-stages)"|href="\/en\/sales\/(invoices|quotes|orders)/);
    console.info("Invoice browser routes passed: list/detail, English/French rendering, and Warehouse denial.");
  } finally {
    if (viewerCookie) await signOut(origin, viewerCookie).catch(() => undefined);
    if (warehouseCookie) await signOut(origin, warehouseCookie).catch(() => undefined);
    if (accountantCookie) await signOut(origin, accountantCookie).catch(() => undefined);
    if (adminCookie) await signOut(origin, adminCookie).catch(() => undefined);
    const resourceIds = invoiceId ? [order.resourceId, invoiceId] : [order.resourceId];
    await db.delete(auditLogs).where(and(eq(auditLogs.organizationId, demoOrganization.id), or(
      inArray(auditLogs.entityId, resourceIds),
      sql`${auditLogs.after}->>'referenceOrderId' = ${order.resourceId}`,
    )));
    await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, demoOrganization.id), inArray(idempotencyKeys.resourceId, resourceIds)));
    if (invoiceId) await db.delete(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, demoOrganization.id)));
    await db.delete(salesOrderLines).where(and(eq(salesOrderLines.organizationId, demoOrganization.id), eq(salesOrderLines.orderId, order.resourceId)));
    await db.delete(salesOrders).where(and(eq(salesOrders.id, order.resourceId), eq(salesOrders.organizationId, demoOrganization.id)));
    await db.delete(stockMovements).where(and(eq(stockMovements.organizationId, demoOrganization.id), eq(stockMovements.referenceId, order.resourceId), eq(stockMovements.referenceType, "sales_order")));
    await db.update(stockLevels).set({ quantity: initialQuantity, averageUnitCostMinor: initialCost, updatedAt: availableStock.level.updatedAt }).where(eq(stockLevels.id, availableStock.level.id));
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof OrderDomainError
    ? `${error.code}: ${error.message}`
    : error instanceof Error ? `${error.name}: ${error.message}` : "unknown verification error";
  console.error(`Invoice verification failed (${detail}). Test-only cleanup ran where applicable; no credentials are logged.`);
  process.exitCode = 1;
}).finally(async () => {
  await getPool().end();
});
