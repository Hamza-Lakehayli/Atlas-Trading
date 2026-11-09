import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { CalendarDays, CircleHelp, PackageCheck } from "lucide-react";
import { QuoteFunnelWidget, ReceivablesAgingWidget, RevenueTrendWidget } from "@/components/dashboard/analytics-widgets";
import { CategoryRevenueWidget } from "@/components/dashboard/category-revenue-widget";
import { TopRevenueWidget } from "@/components/dashboard/top-revenue-widget";
import { WidgetErrorBoundary } from "@/components/dashboard/widget-error-boundary";
import { ProductTable } from "@/components/inventory/product-table";
import { addCalendarDays, businessDate } from "@/lib/dates/business-date";
import { dashboardComparisonRange, dashboardFilterHref, dashboardSupportsDso, parseDashboardFilters, type DashboardFilters } from "@/lib/dashboard/filters";
import { dashboardInvoiceHref } from "@/lib/dashboard/drilldowns";
import { calculateDso } from "@/lib/dashboard/metrics";
import { can, isAppRole, type AppRole } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getCategoryRevenue, getConfirmedOrderTrend, getDashboardFilterOptions, getQuoteFunnel, getReceivablesAging, getReceivablesTrend, getRevenueTrend, getTopRevenue } from "@/server/queries/dashboard";
import { listProducts } from "@/server/queries/products";
import { withRequestTrace } from "@/server/observability/query-trace";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function sumRows<T extends object>(rows: T[], key: keyof T) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function delta(current: number, previous: number) {
  return previous === 0 ? null : (current - previous) / Math.abs(previous) * 100;
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const range = Math.max(1, Math.max(...values) - min);
  const path = values.map((value, index) => {
    const x = index / (values.length - 1) * 100;
    const y = 22 - (value - min) / range * 18;
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <svg className="metric-sparkline" viewBox="0 0 100 24" role="img" aria-label={label}><path d={path} /></svg>;
}

function Metric({ label, value, exactValue, change, comparison, note, href, locale, sparkline = [], sparklineLabel = label, canDrillDown }: {
  label: string; value: string; exactValue?: string; change: number | null; comparison: boolean; note: string; href: string; locale: string; sparkline?: number[];
  sparklineLabel?: string; canDrillDown: boolean;
}) {
  const direction = change === null ? "neutral" : change >= 0 ? "up" : "down";
  const formattedChange = change === null ? "—" : `${change > 0 ? "+" : ""}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(change)}%`;
  const content = <>
    <span className="executive-metric-label">{label}</span><strong title={exactValue ?? value}>{value}</strong>
    <span className={`executive-metric-change metric-change-${direction}`}><i aria-hidden="true">{direction === "up" ? "↗" : direction === "down" ? "↘" : "—"}</i> {formattedChange} {comparison && <small>vs prior period</small>}</span>
    <span className="executive-metric-detail">{note}</span><Sparkline values={sparkline} label={sparklineLabel} />
  </>;
  return canDrillDown
    ? <Link href={href} className="executive-metric">{content}</Link>
    : <article className="executive-metric">{content}</article>;
}

type WidgetLoaderProps = { organizationId: string; role: AppRole; filters: DashboardFilters; locale: string; labels: Record<string, string>; canDrillDown: boolean };

async function CategoryRevenueLoader(props: WidgetLoaderProps) {
  const rows = await getCategoryRevenue(props);
  return <CategoryRevenueWidget rows={rows} filters={props.filters} locale={props.locale} labels={props.labels} canDrillDown={props.canDrillDown} />;
}

async function TopRevenueLoader(props: WidgetLoaderProps) {
  const data = await getTopRevenue(props);
  return <TopRevenueWidget data={data} filters={props.filters} locale={props.locale} labels={props.labels} canDrillDown={props.canDrillDown} />;
}

async function QuoteFunnelLoader(props: WidgetLoaderProps) {
  const data = await getQuoteFunnel(props);
  return <QuoteFunnelWidget data={data} filters={props.filters} locale={props.locale} labels={props.labels} canDrillDown={props.canDrillDown} />;
}

function WidgetAvailability({ ready, children }: { ready: boolean; children: ReactNode }) {
  if (!ready) throw new Error("DASHBOARD_WIDGET_UNAVAILABLE");
  return children;
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const session = await requireSession(locale);
  const role = session.user.appRole;
  const organizationId = session.user.organizationId;
  if (!isAppRole(role) || !organizationId || !can(role, "dashboard:sales:read")) notFound();
  const t = await getTranslations("dashboard");
  const referenceDate = businessDate();
  const parsed = parseDashboardFilters(await searchParams, referenceDate);
  const filters: DashboardFilters | null = parsed.success ? parsed.data : null;
  const options = await getDashboardFilterOptions({ organizationId, role });
  const hasFinance = can(role, "dashboard:finance:read");
  const canViewReceivables = hasFinance && can(role, "payments:read");
  const canDrillToInvoices = can(role, "invoices:read") && can(role, "payments:read");
  const canDrillToQuotes = can(role, "quotes:read");
  const canDrillToOrders = can(role, "orders:read");
  const comparisonRange = filters ? dashboardComparisonRange(filters) : null;
  const products = can(role, "inventory:read")
    ? await withRequestTrace(() => listProducts({ organizationId, role }))
    : null;
  const previousReceivablesPromise = filters && hasFinance && comparisonRange
    && canViewReceivables
    ? Promise.allSettled([getReceivablesTrend({ organizationId, role, filters: { ...filters, ...comparisonRange, compare: "none" } })])
    : Promise.resolve(null);
  const [financeResults, previousReceivablesResults] = await Promise.all([
    filters && hasFinance ? Promise.allSettled([
      getRevenueTrend({ organizationId, role, filters }),
      canViewReceivables ? getReceivablesAging({ organizationId, role, filters }) : Promise.resolve(null),
      canViewReceivables ? getReceivablesTrend({ organizationId, role, filters }) : Promise.resolve(null),
    ]) : Promise.resolve(null),
    previousReceivablesPromise,
  ]);
  const ordersResults = filters ? await Promise.allSettled([getConfirmedOrderTrend({ organizationId, role, filters })]) : null;
  const trend = financeResults?.[0]?.status === "fulfilled" ? financeResults[0].value : null;
  const aging = financeResults?.[1]?.status === "fulfilled" ? financeResults[1].value : null;
  const receivablesTrend = financeResults?.[2]?.status === "fulfilled" ? financeResults[2].value : null;
  const previousReceivablesTrend = previousReceivablesResults?.[0]?.status === "fulfilled" ? previousReceivablesResults[0].value : null;
  const ordersTrend = ordersResults?.[0]?.status === "fulfilled" ? ordersResults[0].value : null;
  const currentRevenue = trend ? sumRows(trend.current, "revenueMinor") : 0;
  const previousRevenue = trend ? sumRows(trend.previous, "revenueMinor") : 0;
  const currentCogs = trend ? sumRows(trend.current, "cogsMinor") : 0;
  const previousCogs = trend ? sumRows(trend.previous, "cogsMinor") : 0;
  const currentInvoicedOrders = trend ? sumRows(trend.current, "invoicedOrderCount") : 0;
  const previousInvoicedOrders = trend ? sumRows(trend.previous, "invoicedOrderCount") : 0;
  const currentOrders = ordersTrend ? sumRows(ordersTrend.current, "count") : 0;
  const previousOrders = ordersTrend ? sumRows(ordersTrend.previous, "count") : 0;
  const margin = currentRevenue ? (currentRevenue - currentCogs) / currentRevenue * 100 : null;
  const previousMargin = previousRevenue ? (previousRevenue - previousCogs) / previousRevenue * 100 : 0;
  const averageOrder = currentInvoicedOrders ? currentRevenue / currentInvoicedOrders : 0;
  const previousAverageOrder = previousInvoicedOrders ? previousRevenue / previousInvoicedOrders : 0;
  const receivables = aging?.rows.reduce((total, row) => total + row.balanceMinor, 0) ?? 0;
  const previousReceivables = previousReceivablesTrend?.at(-1)?.balanceMinor ?? null;
  const overdue = aging?.rows.filter((row) => row.key !== "not_due").reduce((total, row) => total + row.balanceMinor, 0) ?? 0;
  const days = filters ? Math.max(1, (Date.parse(`${filters.to}T00:00:00Z`) - Date.parse(`${filters.from}T00:00:00Z`)) / 86_400_000 + 1) : 0;
  const dsoScopeSupported = filters ? dashboardSupportsDso(filters) : false;
  const dso = trend && aging && filters ? calculateDso({ filters, receivablesMinor: receivables, revenueMinor: currentRevenue, periodDays: days }) : null;
  const previousDays = comparisonRange ? Math.max(1, (Date.parse(`${comparisonRange.to}T00:00:00Z`) - Date.parse(`${comparisonRange.from}T00:00:00Z`)) / 86_400_000 + 1) : 0;
  const previousDso = filters && previousReceivables !== null ? calculateDso({ filters, receivablesMinor: previousReceivables, revenueMinor: previousRevenue, periodDays: previousDays }) : null;
  const revenueSparkline = trend?.current.map((row) => row.revenueMinor) ?? [];
  const marginSparkline = trend?.current.map((row) => row.revenueMinor ? (row.revenueMinor - row.cogsMinor) / row.revenueMinor * 100 : 0) ?? [];
  const ordersSparkline = ordersTrend?.current.map((row) => row.count) ?? [];
  const averageOrderSparkline = trend?.current.map((row) => row.invoicedOrderCount ? row.revenueMinor / row.invoicedOrderCount : 0) ?? [];
  const receivablesSparkline = receivablesTrend?.map((row) => row.balanceMinor) ?? [];
  const dsoSparkline = dso !== null ? receivablesSparkline.map((balance) => balance / currentRevenue * days) : [];
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "MAD", maximumFractionDigits: 0, notation: "compact" }).format(minor / 100);
  const exactMoney = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "MAD", maximumFractionDigits: 2 }).format(minor / 100);
  const comparisonText = comparisonRange ? `${comparisonRange.from} — ${comparisonRange.to}` : t("noComparison");
  const invoiceHref = filters ? dashboardInvoiceHref(locale, filters) : `/${locale}/sales/invoices`;
  const receivablesHref = filters ? `/${locale}/sales/invoices?asOf=${filters.to}${filters.segment !== "all" ? `&segment=${filters.segment}` : ""}` : `/${locale}/sales/invoices`;
  const receivablesFilterNote = filters
    ? [filters.warehouseId !== "all" ? t("warehouseNotApplied") : "", filters.categoryId !== "all" ? t("categoryNotApplied") : ""].filter(Boolean).join(" ")
    : "";
  const orderQuery = new URLSearchParams();
  if (filters) {
    orderQuery.set("from", filters.from);
    orderQuery.set("to", filters.to);
    orderQuery.set("dateBasis", "confirmedAt");
    if (filters.warehouseId !== "all") orderQuery.set("warehouseId", filters.warehouseId);
    if (filters.categoryId !== "all") orderQuery.set("categoryId", filters.categoryId);
    if (filters.segment !== "all") orderQuery.set("segment", filters.segment);
  }
  const orderHref = `/${locale}/sales/orders${orderQuery.size ? `?${orderQuery}` : ""}`;
  const chartLabels = {
    revenueTrend: t("revenueTrend"), issuedInvoiceBasis: t("issuedInvoiceBasis"), openInvoices: t("openInvoices"),
    currentPeriod: t("currentPeriod"), comparisonPeriod: t("comparisonPeriod"), averagePerBucket: t("averagePerBucket"),
    periodColumn: t("periodColumn"), revenue: t("revenue"), cogs: t("cogs"), invoices: t("invoices"), viewData: t("viewData"),
    categoryRevenue: t("categoryRevenue"), categoryRevenueDescription: t("categoryRevenueDescription"), noChartData: t("noChartData"),
    topAccountsProducts: t("topAccountsProducts"), topAccountsProductsDescription: t("topAccountsProductsDescription"), topCustomers: t("topCustomers"), topProducts: t("topProducts"),
    quoteFunnel: t("quoteFunnel"), quoteFunnelDescription: t("quoteFunnelDescription"), openQuotes: t("openQuotes"), stage: t("stage"), count: t("count"),
    funnel_created: t("funnel.created"), funnel_sent: t("funnel.sent"), funnel_accepted: t("funnel.accepted"), funnel_converted: t("funnel.converted"), funnel_invoiced: t("funnel.invoiced"), funnel_paid: t("funnel.paid"),
    receivablesAging: t("receivablesAging"), receivablesAgingDescription: t("receivablesAgingDescription"), openReceivables: t("openReceivables"),
    warehouseNotApplied: t("warehouseNotApplied"), categoryNotApplied: t("categoryNotApplied"), agingBucket: t("agingBucket"), outstanding: t("outstanding"),
    aging_not_due: t("aging.not_due"), "aging_1-30": t("aging.1-30"), aging_31_60: t("aging.31-60"), aging_61_90: t("aging.61-90"), "aging_91-plus": t("aging.91-plus"),
  };

  return <div className="dashboard-page executive-dashboard">
    <section className="welcome-row">
      <div><p className="page-kicker">{new Intl.DateTimeFormat(locale, { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Casablanca" }).format(new Date())} <span>·</span> {t("city")}</p><h1>{t("title", { name: session.user.name.split(" ")[0] })}</h1><p className="page-subtitle">{t("subtitle")}</p></div>
      <div className="dashboard-period-summary"><CalendarDays size={15} /><span>{filters ? `${filters.from} — ${filters.to}` : t("invalidFilters")}</span></div>
    </section>

    <section className="dashboard-filter-panel" aria-label={t("filters")}>
      {filters && <form action={`/${locale}/dashboard`} method="get" className="dashboard-filter-form">
        <label><span>{t("from")}</span><input type="date" name="from" required defaultValue={filters.from} /></label>
        <label><span>{t("to")}</span><input type="date" name="to" required defaultValue={filters.to} /></label>
        <label><span>{t("compare")}</span><select name="compare" defaultValue={filters.compare}><option value="previous_period">{t("previousPeriod")}</option><option value="previous_year">{t("previousYear")}</option><option value="none">{t("noComparison")}</option></select></label>
        <label><span>{t("warehouse")}</span><select name="warehouseId" defaultValue={filters.warehouseId}><option value="all">{t("allWarehouses")}</option>{options.warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label><span>{t("category")}</span><select name="categoryId" defaultValue={filters.categoryId}><option value="all">{t("allCategories")}</option>{options.categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label><span>{t("segment")}</span><select name="segment" defaultValue={filters.segment}><option value="all">{t("allSegments")}</option><option value="Retail">{t("segments.Retail")}</option><option value="Hospitality">{t("segments.Hospitality")}</option><option value="Wholesale">{t("segments.Wholesale")}</option></select></label>
        <label><span>{t("granularity")}</span><select name="granularity" defaultValue={filters.granularity}><option value="daily">{t("daily")}</option><option value="weekly">{t("weekly")}</option><option value="monthly">{t("monthly")}</option></select></label>
        <button type="submit" className="dashboard-filter-submit">{t("applyFilters")}</button>
      </form>}
      {filters && <nav className="dashboard-presets" aria-label={t("datePresets")}>
        {[7, 30].map((days) => <Link key={days} href={dashboardFilterHref(locale, filters, { from: addCalendarDays(referenceDate, -(days - 1)), to: referenceDate })}>{t(days === 7 ? "last7Days" : "last30Days")}</Link>)}
        <Link href={dashboardFilterHref(locale, filters, { from: `${referenceDate.slice(0, 4)}-${String(Math.floor((Number(referenceDate.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`, to: referenceDate })}>{t("quarterToDate")}</Link>
        <Link href={dashboardFilterHref(locale, filters, { from: `${referenceDate.slice(0, 4)}-01-01`, to: referenceDate })}>{t("yearToDate")}</Link>
      </nav>}
      {!parsed.success && <div className="dashboard-filter-error" role="alert"><span>{t("invalidFiltersHelp")}</span><Link href={`/${locale}/dashboard`}>{t("clearFilters")}</Link></div>}
    </section>

    {filters && hasFinance && <>
      <section className={`executive-metric-grid${canViewReceivables ? "" : " executive-metric-grid-limited"}`} aria-label={t("executiveMetrics")}>
        <Metric label={t("revenue")} value={trend ? money(currentRevenue) : t("unavailable")} exactValue={trend ? exactMoney(currentRevenue) : undefined} change={trend ? delta(currentRevenue, previousRevenue) : null} comparison={Boolean(comparisonRange && trend)} note={t("issuedInvoiceBasis")} href={invoiceHref} locale={locale} sparkline={revenueSparkline} canDrillDown={canDrillToInvoices} />
        <Metric label={t("grossMargin")} value={!trend || margin === null ? t("unavailable") : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(margin)}%`} change={!trend || margin === null || !previousRevenue ? null : margin - previousMargin} comparison={Boolean(comparisonRange && trend)} note={t("grossMarginHelp")} href={invoiceHref} locale={locale} sparkline={marginSparkline} canDrillDown={canDrillToInvoices} />
        <Metric label={t("confirmedOrders")} value={ordersTrend ? currentOrders.toLocaleString(locale) : t("unavailable")} change={ordersTrend ? delta(currentOrders, previousOrders) : null} comparison={Boolean(comparisonRange && ordersTrend)} note={t("ordersPeriodHelp")} href={orderHref} locale={locale} sparkline={ordersSparkline} canDrillDown={canDrillToOrders} />
        <Metric label={t("averageOrderValue")} value={!trend || !currentInvoicedOrders ? t("unavailable") : money(averageOrder)} exactValue={trend && currentInvoicedOrders ? exactMoney(averageOrder) : undefined} change={trend ? delta(averageOrder, previousAverageOrder) : null} comparison={Boolean(comparisonRange && trend)} note={t("aovHelp")} href={invoiceHref} locale={locale} sparkline={averageOrderSparkline} canDrillDown={canDrillToInvoices} />
        {canViewReceivables && <>
          <Metric label={t("receivables")} value={aging ? money(receivables) : t("unavailable")} exactValue={aging ? exactMoney(receivables) : undefined} change={comparisonRange && previousReceivables !== null && aging ? delta(receivables, previousReceivables) : null} comparison={Boolean(comparisonRange && previousReceivables !== null && aging)} note={`${aging ? t("overdueShare", { percent: new Intl.NumberFormat(locale, { maximumFractionDigits: 0, style: "percent" }).format(receivables ? overdue / receivables : 0) }) : t("widgetUnavailable")}${receivablesFilterNote ? ` ${receivablesFilterNote}` : ""}`} href={receivablesHref} locale={locale} sparkline={aging ? receivablesSparkline : []} canDrillDown={canDrillToInvoices} />
        <Metric label={t("dso")} value={dso === null ? t("unavailable") : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(dso)} ${t("days")}`} change={dso !== null && previousDso !== null ? delta(dso, previousDso) : null} comparison={Boolean(comparisonRange && dso !== null && previousDso !== null)} note={`${!dsoScopeSupported ? receivablesFilterNote : dso === null && (!trend || !aging) ? t("widgetUnavailable") : t("dsoHelp")}`} href={receivablesHref} locale={locale} sparkline={dsoSparkline} canDrillDown={canDrillToInvoices} />
        </>}
      </section>
      <p className="dashboard-comparison-caption">{t("comparisonRange", { range: comparisonText })}</p>
      <div className="dashboard-chart-grid">
        <WidgetErrorBoundary retryLabel={t("retryWidget")}><Suspense fallback={<div className="analytics-widget-skeleton" aria-label={t("loadingWidget")} />}><WidgetAvailability ready={Boolean(trend)}><RevenueTrendWidget data={trend ?? { current: [], previous: [], previousRange: null }} filters={filters} locale={locale} labels={chartLabels} canDrillDown={canDrillToInvoices} /></WidgetAvailability></Suspense></WidgetErrorBoundary>
        <WidgetErrorBoundary retryLabel={t("retryWidget")}><Suspense fallback={<div className="analytics-widget-skeleton" aria-label={t("loadingWidget")} />}><CategoryRevenueLoader organizationId={organizationId} role={role} filters={filters} locale={locale} labels={chartLabels} canDrillDown={canDrillToInvoices} /></Suspense></WidgetErrorBoundary>
        <WidgetErrorBoundary retryLabel={t("retryWidget")}><Suspense fallback={<div className="analytics-widget-skeleton" aria-label={t("loadingWidget")} />}><TopRevenueLoader organizationId={organizationId} role={role} filters={filters} locale={locale} labels={chartLabels} canDrillDown={canDrillToInvoices} /></Suspense></WidgetErrorBoundary>
        {canDrillToQuotes && <WidgetErrorBoundary retryLabel={t("retryWidget")}><Suspense fallback={<div className="analytics-widget-skeleton" aria-label={t("loadingWidget")} />}><QuoteFunnelLoader organizationId={organizationId} role={role} filters={filters} locale={locale} labels={chartLabels} canDrillDown={canDrillToQuotes} /></Suspense></WidgetErrorBoundary>}
        {canViewReceivables && <WidgetErrorBoundary retryLabel={t("retryWidget")}><Suspense fallback={<div className="analytics-widget-skeleton" aria-label={t("loadingWidget")} />}><WidgetAvailability ready={Boolean(aging)}><ReceivablesAgingWidget data={aging ?? { asOf: filters.to, rows: [], unsupported: { category: false, warehouse: false } }} filters={filters} locale={locale} labels={chartLabels} canDrillDown={canDrillToInvoices} /></WidgetAvailability></Suspense></WidgetErrorBoundary>}
      </div>
    </>}

    {!hasFinance && <section className="dashboard-access-note"><CircleHelp size={15} /><span>{t("financeWidgetsRestricted")}</span></section>}

    {products && <section className="catalog-section dashboard-catalog-section">
      <div className="section-heading"><div><div className="section-title-line"><h2>{t("products")}</h2><span className="table-count">{products.total.toString().padStart(3, "0")}</span></div><p>{t("productsDescription")}</p></div><span className="dashboard-stock-summary"><PackageCheck size={14} /> {products.lowStock.toLocaleString(locale)} {t("lowStockMetric")}</span></div>
      <ProductTable products={products.rows} locale={locale} showPrices={products.showPrices} />
    </section>}
    <footer className="page-note"><span>ATLAS / {t("executiveOverview")}</span><span>{t("comparisonRange", { range: comparisonText })}</span></footer>
  </div>;
}
